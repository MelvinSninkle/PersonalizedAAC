// /api/admin/lab?action=gap-words  (admin only)
//
// The vendor side of gap-fill: which words do real households say that the
// taxonomy doesn't know? Feeds the taxonomy roadmap with demand evidence and
// operates the request queue.
//
// PRIVACY MODEL — two different kinds of data, two different rules:
//   • Everything here today is an EXPLICIT parent request ("request-word" —
//     the parent tapped a specific word to ask us to build it). That's a
//     support queue, not telemetry: single-family rows are shown and
//     fulfilled, because suppressing them would silently kill the request
//     the family made on purpose.
//   • The k-floor (GF-42) marks DEMAND: words requested by ≥ k distinct
//     families get the ⭐ high-demand flag (bulk-build candidates). When the
//     passive Consent-B research ledger ships, ITS aggregation must suppress
//     below-k words entirely — that stricter rule applies to passive data,
//     not to explicit asks.
//
//   GET  ?k=5      → { open:[{word, families, hits, locales, status,
//                      firstAt, hot}], k, delivered, rejected }
//   GET  ?csv=1    → text/csv of the open queue (word, families, hits,
//                      locales, status) for the taxonomy authoring workflow
//   POST {op:'accept'|'reject', word}  → stamp every open row for that word
//   POST {op:'deliver'}                → deliverFulfilled(): every open
//                      request whose word now exists in the taxonomy WITH
//                      default art mints a pending word_suggestions row for
//                      the requesting child (the parent's existing
//                      Add/Dismiss flow is the delivery vehicle) and flips
//                      the request to 'delivered'.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { ensureWordRequests, deliverFulfilled } from '../_lib/word-suggestions.js';
import { BAD_WORDS } from '../_lib/bad-words.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  try {
    await ensureWordRequests(db);

    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      const op = String(b.op || '');
      if (op === 'deliver') {
        const delivered = await deliverFulfilled(db);
        res.status(200).json({ ok: true, delivered });
        return;
      }
      if (op === 'accept' || op === 'reject') {
        const word = String(b.word || '').toLowerCase().slice(0, 60);
        if (!word) { res.status(400).json({ error: 'word required' }); return; }
        const status = op === 'accept' ? 'accepted' : 'rejected';
        await db`UPDATE word_requests SET status = ${status}, updated_at = NOW()
                 WHERE word = ${word} AND status IN ('requested', 'accepted')`;
        res.status(200).json({ ok: true, word, status });
        return;
      }
      res.status(400).json({ error: 'unknown op', op });
      return;
    }

    if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const k = Math.max(1, Math.min(100, parseInt((req.query && req.query.k) || '5', 10) || 5));

    const rows = await db`
      SELECT word,
             COUNT(DISTINCT child_id)::int AS families,
             COALESCE(SUM(hit_count), 0)::int AS hits,
             ARRAY_AGG(DISTINCT COALESCE(locale, 'en-US')) AS locales,
             MIN(created_at) AS first_at,
             -- a word is 'accepted' once any of its rows is
             BOOL_OR(status = 'accepted') AS any_accepted
      FROM word_requests
      WHERE status IN ('requested', 'accepted')
      GROUP BY word
      ORDER BY COUNT(DISTINCT child_id) DESC, SUM(hit_count) DESC NULLS LAST, word ASC
      LIMIT 500`;

    // Belt-and-braces: the request endpoint already refuses profanity, but a
    // curation surface must never render it either.
    const open = rows
      .filter((r) => !r.word.split(' ').some((t) => BAD_WORDS.includes(t)))
      .map((r) => ({
        word: r.word, families: r.families, hits: r.hits,
        locales: r.locales || [], firstAt: r.first_at,
        status: r.any_accepted ? 'accepted' : 'requested',
        hot: r.families >= k,
      }));

    if (String(req.query.csv || '') === '1') {
      const lines = ['word,families,hits,locales,status'];
      for (const r of open) {
        lines.push([r.word, r.families, r.hits, `"${r.locales.join('|')}"`, r.status].join(','));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="gap-words.csv"');
      res.status(200).send(lines.join('\n') + '\n');
      return;
    }

    const delivered = Number((await db`SELECT COUNT(*)::int AS n FROM word_requests WHERE status = 'delivered'`)[0]?.n) || 0;
    const rejected = Number((await db`SELECT COUNT(*)::int AS n FROM word_requests WHERE status = 'rejected'`)[0]?.n) || 0;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, k, open, delivered, rejected });
  } catch (err) {
    res.status(500).json({ error: 'gap-words failed', detail: String(err.message || err) });
  }
}

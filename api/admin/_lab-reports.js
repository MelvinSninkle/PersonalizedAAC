// /api/admin/lab?action=reports  (admin only)
//
// Operational reports for launch: is every board actually in sync, who's
// logging in, and did paying customers get what they paid for. One GET
// returns every section so the reports page renders in a single round trip.
//
//   GET ?days=30 →
//     summary      headline counts for the window
//     boards       one row per board: owner, tiles, last sync heartbeat
//                  (board_pings, written by /api/sync), last student tap
//                  (events), queued/failed render jobs — a healthy board
//                  syncs recently and has an empty queue
//     logins       one row per account: signup + last login (users table,
//                  stamped on every login path)
//     purchases    every purchase in the window (credits + $) with totals
//     fulfillment  per paying/spending account: credits bought vs credits
//                  spent vs renders delivered/queued/failed — 'stuck' or
//                  'failed' rows are customers who paid and are still waiting
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { maxDuration: 60 };

const CAP = 500;   // hard row cap per section — reports are summaries, not dumps

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const db = sql();
  const days = Math.min(365, Math.max(1, parseInt((req.query && req.query.days) || '30', 10) || 30));

  try {
    // Grouped single-scan subqueries; every LEFT JOIN key is one row per board.
    let boards = [];
    try {
      boards = await db`
        SELECT b.child_id,
               u.email AS owner,
               p.last_sync_at, p.user_agent,
               ev.last_tap_at,
               COALESCE(it.n, 0)::int AS items,
               (COALESCE(sj.queued, 0) + COALESCE(tj.queued, 0))::int AS jobs_queued,
               (COALESCE(sj.failed, 0) + COALESCE(tj.failed, 0))::int AS jobs_failed
        FROM (SELECT DISTINCT child_id FROM items WHERE child_id IS NOT NULL) b
        LEFT JOIN users u ON u.child_slug = b.child_id
        LEFT JOIN board_pings p ON p.child_id = b.child_id
        LEFT JOIN (SELECT child_id, max(occurred_at) AS last_tap_at
                   FROM events WHERE role = 'student' GROUP BY child_id) ev ON ev.child_id = b.child_id
        LEFT JOIN (SELECT child_id, count(*)::int AS n FROM items GROUP BY child_id) it ON it.child_id = b.child_id
        LEFT JOIN (SELECT child_id,
                          count(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS queued,
                          count(*) FILTER (WHERE status = 'failed')::int AS failed
                   FROM seed_jobs GROUP BY child_id) sj ON sj.child_id = b.child_id
        LEFT JOIN (SELECT child_id,
                          count(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS queued,
                          count(*) FILTER (WHERE status = 'failed')::int AS failed
                   FROM tile_jobs GROUP BY child_id) tj ON tj.child_id = b.child_id
        ORDER BY p.last_sync_at DESC NULLS LAST, b.child_id
        LIMIT ${CAP}`;
    } catch (_) {
      // board_pings may not exist until the first post-deploy sync — degrade
      // to the same report without heartbeat columns.
      boards = await db`
        SELECT b.child_id, u.email AS owner, NULL AS last_sync_at, NULL AS user_agent,
               ev.last_tap_at, COALESCE(it.n, 0)::int AS items,
               (COALESCE(sj.queued, 0) + COALESCE(tj.queued, 0))::int AS jobs_queued,
               (COALESCE(sj.failed, 0) + COALESCE(tj.failed, 0))::int AS jobs_failed
        FROM (SELECT DISTINCT child_id FROM items WHERE child_id IS NOT NULL) b
        LEFT JOIN users u ON u.child_slug = b.child_id
        LEFT JOIN (SELECT child_id, max(occurred_at) AS last_tap_at
                   FROM events WHERE role = 'student' GROUP BY child_id) ev ON ev.child_id = b.child_id
        LEFT JOIN (SELECT child_id, count(*)::int AS n FROM items GROUP BY child_id) it ON it.child_id = b.child_id
        LEFT JOIN (SELECT child_id,
                          count(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS queued,
                          count(*) FILTER (WHERE status = 'failed')::int AS failed
                   FROM seed_jobs GROUP BY child_id) sj ON sj.child_id = b.child_id
        LEFT JOIN (SELECT child_id,
                          count(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS queued,
                          count(*) FILTER (WHERE status = 'failed')::int AS failed
                   FROM tile_jobs GROUP BY child_id) tj ON tj.child_id = b.child_id
        ORDER BY b.child_id
        LIMIT ${CAP}`;
    }

    const logins = await db`
      SELECT email, role, child_slug, created_at, last_login_at
      FROM users ORDER BY last_login_at DESC NULLS LAST, created_at DESC
      LIMIT ${CAP}`;

    const purchases = await db`
      SELECT p.created_at, COALESCE(u.email, '(deleted account)') AS email,
             p.platform, p.product_id, p.credits, p.amount_cents
      FROM purchases p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.created_at >= NOW() - (${days} || ' days')::interval
      ORDER BY p.created_at DESC LIMIT ${CAP}`;
    const purchaseTotals = (await db`
      SELECT count(*)::int AS n, COALESCE(sum(credits), 0)::int AS credits,
             COALESCE(sum(amount_cents), 0)::int AS cents
      FROM purchases WHERE created_at >= NOW() - (${days} || ' days')::interval`)[0];

    // Fulfillment: wallet motion per account vs renders actually delivered
    // for their board, all within the window. Merged in JS — each source is
    // one grouped scan.
    const [bought, spent, seedJobs, tileJobs, accounts] = await Promise.all([
      db`SELECT user_id, sum(credits)::int AS credits, COALESCE(sum(amount_cents), 0)::int AS cents,
                count(*)::int AS n
         FROM purchases WHERE created_at >= NOW() - (${days} || ' days')::interval
         GROUP BY user_id`,
      db`SELECT user_id, (-sum(delta))::int AS credits, count(*)::int AS n
         FROM credit_ledger
         WHERE delta < 0 AND created_at >= NOW() - (${days} || ' days')::interval
         GROUP BY user_id`,
      db`SELECT child_id,
                count(*) FILTER (WHERE status = 'done')::int AS done,
                count(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS queued,
                count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM seed_jobs WHERE updated_at >= NOW() - (${days} || ' days')::interval
         GROUP BY child_id`,
      db`SELECT child_id,
                count(*) FILTER (WHERE status = 'done')::int AS done,
                count(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS queued,
                count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM tile_jobs WHERE updated_at >= NOW() - (${days} || ' days')::interval
         GROUP BY child_id`,
      db`SELECT id, email, child_slug FROM users LIMIT 5000`,
    ]);
    const boughtBy = new Map(bought.map((r) => [Number(r.user_id), r]));
    const spentBy = new Map(spent.map((r) => [Number(r.user_id), r]));
    const jobsBy = new Map();
    for (const src of [seedJobs, tileJobs]) {
      for (const r of src) {
        const j = jobsBy.get(r.child_id) || { done: 0, queued: 0, failed: 0 };
        j.done += r.done; j.queued += r.queued; j.failed += r.failed;
        jobsBy.set(r.child_id, j);
      }
    }
    const fulfillment = [];
    for (const u of accounts) {
      const b = boughtBy.get(Number(u.id));
      const s = spentBy.get(Number(u.id));
      const j = (u.child_slug && jobsBy.get(u.child_slug)) || { done: 0, queued: 0, failed: 0 };
      if (!b && !s && !j.done && !j.queued && !j.failed) continue;
      const spentCredits = s ? s.credits : 0;
      const status = spentCredits > 0 && j.failed > 0 ? 'failed'
                   : spentCredits > 0 && j.queued > 0 ? 'stuck'
                   : spentCredits > 0 && j.done === 0 ? 'check'
                   : 'ok';
      fulfillment.push({
        email: u.email, childId: u.child_slug || null,
        boughtCredits: b ? b.credits : 0, boughtCents: b ? b.cents : 0, buys: b ? b.n : 0,
        spentCredits, spends: s ? s.n : 0,
        rendersDone: j.done, rendersQueued: j.queued, rendersFailed: j.failed,
        status,
      });
    }
    const rank = { failed: 0, stuck: 1, check: 2, ok: 3 };
    fulfillment.sort((a, b) => (rank[a.status] - rank[b.status])
      || (b.spentCredits - a.spentCredits) || (b.boughtCredits - a.boughtCredits));

    const summary = {
      days,
      boards: boards.length,
      boardsSynced24h: boards.filter((b) => b.last_sync_at && (Date.now() - new Date(b.last_sync_at)) < 864e5).length,
      boardsNeverSynced: boards.filter((b) => !b.last_sync_at).length,
      jobsQueued: boards.reduce((n, b) => n + b.jobs_queued, 0),
      jobsFailed: boards.reduce((n, b) => n + b.jobs_failed, 0),
      accounts: logins.length,
      signupsInWindow: logins.filter((l) => (Date.now() - new Date(l.created_at)) < days * 864e5).length,
      activeInWindow: logins.filter((l) => l.last_login_at && (Date.now() - new Date(l.last_login_at)) < days * 864e5).length,
      purchases: purchaseTotals.n, purchasedCredits: purchaseTotals.credits, purchasedCents: purchaseTotals.cents,
      fulfillmentAttention: fulfillment.filter((f) => f.status !== 'ok').length,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true, summary,
      boards: boards.map((b) => ({
        childId: b.child_id, owner: b.owner || null, items: b.items,
        lastSyncAt: b.last_sync_at || null, userAgent: b.user_agent || null,
        lastTapAt: b.last_tap_at || null,
        jobsQueued: b.jobs_queued, jobsFailed: b.jobs_failed,
      })),
      logins: logins.map((l) => ({
        email: l.email, role: l.role, childId: l.child_slug || null,
        signedUpAt: l.created_at, lastLoginAt: l.last_login_at || null,
      })),
      purchases: purchases.map((p) => ({
        at: p.created_at, email: p.email, platform: p.platform,
        product: p.product_id, credits: p.credits, cents: p.amount_cents,
      })),
      purchaseTotals: { count: purchaseTotals.n, credits: purchaseTotals.credits, cents: purchaseTotals.cents },
      fulfillment: fulfillment.slice(0, CAP),
    });
  } catch (err) {
    res.status(500).json({ error: 'reports failed', detail: String(err.message || err) });
  }
}

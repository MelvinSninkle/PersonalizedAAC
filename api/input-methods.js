// GET /api/input-methods?childId=&days=
// How the child responds in facilitated/self-paced games — tap, verbal,
// object, physical, gesture. PRD §3 mercy bridge: a verbal or physical
// response counts identically to a tap for accuracy, but tracking the mix
// over time tells the parent + SLP whether the child is moving toward
// independent tapping or relying on verbal/object cues.
//
// Query params:
//   childId required
//   days    1..365, default 30
//
// Returns:
//   { totals: { tap, verbal, object, physical, gesture, other },
//     correctBy: { tap: { ok, total }, verbal: {...}, ... },
//     buckets: ["30d ago", ..., "today"],
//     series: [{ method, data: [counts per bucket] }] }
//
// The bucket grid mirrors /api/analytics so the iPad can render a line per
// method over the same X axis as the other charts.
import { checkAuth } from './_lib/auth.js';
import { canAccessChild } from './_lib/access.js';
import { sql } from './_lib/db.js';

const KNOWN = ['tap', 'verbal', 'object', 'physical', 'gesture'];

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || '').slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }

  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  // Daily buckets when days <= 30; otherwise weekly so the chart stays legible.
  const bucketUnit = days <= 30 ? 'day' : 'week';
  const bucketSecs = bucketUnit === 'day' ? 86400 : 86400 * 7;
  const N = Math.ceil(days * 86400 / bucketSecs);

  try {
    const db = sql();
    // Totals + correct-share per method.
    const totalRows = await db`
      SELECT coalesce(input_method, 'other') AS method,
             count(*)::int AS total,
             sum(case when correct then 1 else 0 end)::int AS ok
      FROM game_attempts
      WHERE child_id = ${childId}
        AND occurred_at >= NOW() - (${days} || ' days')::interval
      GROUP BY 1`;
    const totals = {};
    const correctBy = {};
    for (const m of [...KNOWN, 'other']) { totals[m] = 0; correctBy[m] = { ok: 0, total: 0 }; }
    for (const r of totalRows) {
      const m = KNOWN.includes(r.method) ? r.method : 'other';
      totals[m] = (totals[m] || 0) + Number(r.total);
      correctBy[m].ok    += Number(r.ok);
      correctBy[m].total += Number(r.total);
    }

    // Bucketed counts per method for the small-multiples chart.
    const bucketRows = await db`
      SELECT coalesce(input_method, 'other') AS method,
             floor(extract(epoch from (now() - occurred_at)) / ${bucketSecs})::int AS bucket,
             count(*)::int AS n
      FROM game_attempts
      WHERE child_id = ${childId}
        AND occurred_at >= now() - ${N * bucketSecs} * interval '1 second'
      GROUP BY 1, 2`;
    const byMethod = new Map();
    for (const r of bucketRows) {
      const m = KNOWN.includes(r.method) ? r.method : 'other';
      if (!byMethod.has(m)) byMethod.set(m, new Array(N).fill(0));
      const b = Number(r.bucket);
      if (b < 0 || b >= N) continue;
      byMethod.get(m)[N - 1 - b] = Number(r.n);
    }
    const buckets = [];
    for (let i = 0; i < N; i++) {
      const ago = N - 1 - i;
      buckets.push(ago === 0 ? 'now' : ago + (bucketUnit === 'day' ? 'd' : 'w'));
    }
    const series = [...byMethod.entries()].map(([method, data]) => ({ method, data }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ totals, correctBy, buckets, series });
  } catch (err) {
    res.status(500).json({ error: 'Input-methods failed', detail: String(err.message || err) });
  }
}

// GET /api/exposure-schedule?childId=X — read-only list of exposure
// protocols for a child, ordered by what's due soonest (PRD §8 schedule
// panel on the parent dashboard).
//
// Returns: { protocols: [{ skillSlug, stage, targetCount, currentCount,
//                          spacingMode, status, nextDueAt, lastSeenAt,
//                          masteredAt }, ...] }
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
  const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 60));

  try {
    const db = sql();
    if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    const rows = await db`
      SELECT id, skill_slug, stage, target_count, current_count, spacing_mode,
             status, next_due_at, last_seen_at, mastered_at, created_at
      FROM exposure_protocols
      WHERE child_id = ${childId}
      ORDER BY
        CASE WHEN status = 'mastered'     THEN 3
             WHEN status = 'eval_flagged' THEN 2
             ELSE 1 END,
        next_due_at NULLS LAST
      LIMIT ${limit}`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      protocols: rows.map(r => ({
        skillSlug: r.skill_slug,
        stage: Number(r.stage),
        targetCount: Number(r.target_count),
        currentCount: Number(r.current_count),
        spacingMode: r.spacing_mode,
        status: r.status,
        nextDueAt: r.next_due_at,
        lastSeenAt: r.last_seen_at,
        masteredAt: r.mastered_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Read failed', detail: String(err.message || err) });
  }
}

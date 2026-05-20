// GET /api/admin/taxonomy-audit — filterable read of the audit trail.
// Query params (all optional):
//   action  — comma-separated list (e.g. "import,restore")
//   since   — ISO timestamp lower bound
//   until   — ISO timestamp upper bound
//   q       — free-text match against summary / note / row_ids
//   limit   — default 500, max 2000
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const actions = typeof req.query.action === 'string' && req.query.action
    ? req.query.action.split(',').map(s => s.trim()).filter(Boolean)
    : null;
  const since = typeof req.query.since === 'string' && !isNaN(Date.parse(req.query.since)) ? req.query.since : null;
  const until = typeof req.query.until === 'string' && !isNaN(Date.parse(req.query.until)) ? req.query.until : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || '500', 10) || 500));

  try {
    const db = sql();
    // Build filters inline; the Neon SDK's tagged-template binds each ${} safely.
    const like = q ? `%${q}%` : null;
    const rows = await db`
      SELECT id, ts, actor, action, row_ids, summary, note
      FROM taxonomy_audit
      WHERE (${actions === null} OR action = ANY(${actions}))
        AND (${since  === null} OR ts >= ${since}::timestamptz)
        AND (${until  === null} OR ts <= ${until}::timestamptz)
        AND (${like   === null} OR summary ILIKE ${like} OR note ILIKE ${like} OR ${q} = ANY(row_ids))
      ORDER BY ts DESC
      LIMIT ${limit}
    `;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      entries: rows.map(r => ({
        id: Number(r.id),
        ts: r.ts,
        actor: r.actor,
        action: r.action,
        rowIds: r.row_ids || [],
        summary: r.summary,
        note: r.note,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Audit query failed', detail: String(err.message || err) });
  }
}

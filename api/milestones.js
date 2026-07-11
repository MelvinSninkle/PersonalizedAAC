// GET /api/milestones?childId= — the child's communication milestones,
// newest first. Read-only keepsakes for the parent dashboard's Moments panel;
// rows are created by detection on /api/events ingestion (_lib/milestones.js).
import { checkAuth } from './_lib/auth.js';
import { canAccessChild } from './_lib/access.js';
import { sql } from './_lib/db.js';
import { ensureMilestones } from './_lib/milestones.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const childId = String((req.query && req.query.childId) || '').slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  const db = sql();
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  try {
    await ensureMilestones(db);
    const rows = await db`
      SELECT kind, detail_key, payload, occurred_at FROM milestones
      WHERE child_id = ${childId} ORDER BY occurred_at DESC LIMIT 60`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ milestones: rows.map((r) => ({
      kind: r.kind, key: r.detail_key, payload: r.payload || {}, at: r.occurred_at,
    })) });
  } catch (err) {
    res.status(500).json({ error: 'milestones failed', detail: String(err.message || err) });
  }
}

// POST /api/admin/normalize-tiles?childId=<slug>
//
// Admin one-time fix: set every tile + category for a child to keep_aspect=false
// so each image FILLS its square uniformly (object-fit: cover) instead of a mix
// of filled and letterboxed tiles. Admin only.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const childId = typeof (req.query.childId || (req.body && req.body.childId)) === 'string'
    ? (req.query.childId || req.body.childId) : '';
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    const items = await db`UPDATE items SET keep_aspect = FALSE WHERE child_id = ${childId} AND keep_aspect = TRUE RETURNING id`;
    let cats = [];
    try { cats = await db`UPDATE categories SET keep_aspect = FALSE WHERE child_id = ${childId} AND keep_aspect = TRUE RETURNING id`; } catch (_) {}
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, items: items.length, categories: cats.length });
  } catch (err) {
    res.status(500).json({ error: 'normalize failed', detail: String(err.message || err) });
  }
}

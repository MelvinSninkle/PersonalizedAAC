// GET /api/admin/lab-board-state?childId= — what a child already has, for the Lab.
// Lets the Lab show "Fletcher already has this" next to a library tile, offer to
// PORT his existing image into the library, and know which category chips exist
// (publishing a tile is blocked until its category is on the board). Admin-gated.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    const items = await db`
      SELECT id, section, label, image_key, taxonomy_slug, category_id
      FROM items WHERE child_id = ${childId}`;
    const categories = await db`
      SELECT id, section, label, parent_id, image_key
      FROM categories WHERE child_id = ${childId}`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ childId, items, categories });
  } catch (err) {
    res.status(500).json({ error: 'board-state failed', detail: String(err.message || err) });
  }
}

// GET /api/therapist/board?id=N — fetch one of my board templates plus its
// categories (subs) + items, in the same shape as /api/sync. Used by the
// therapist library editor. Owner-only (admin allowed).
import { checkAuth } from '../_lib/auth.js';
import { sql, rowToCategory, rowToItem } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.id == null) { res.status(403).json({ error: 'Sign in required' }); return; }

  const id = Number(req.query && req.query.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: 'id required' }); return; }

  try {
    const db = sql();
    const root = (await db`SELECT * FROM categories WHERE id = ${id} LIMIT 1`)[0];
    if (!root || root.child_id != null || root.parent_id != null) {
      res.status(404).json({ error: 'Board not found' }); return;
    }
    if (auth.user.role !== 'admin' && Number(root.owner_user_id) !== Number(auth.user.id)) {
      res.status(403).json({ error: 'Owner only' }); return;
    }

    const cats = await db`
      WITH RECURSIVE tree AS (
        SELECT * FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.* FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.child_id IS NULL
      )
      SELECT * FROM tree ORDER BY display_order, id`;
    const catIds = cats.map(c => Number(c.id));
    const items = catIds.length
      ? await db`SELECT * FROM items WHERE category_id = ANY(${catIds}) ORDER BY display_order, id`
      : [];

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      board: rowToCategory(root),
      categories: cats.map(rowToCategory),
      items: items.map(rowToItem),
    });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

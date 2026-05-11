// GET /api/sync — returns all categories + items so a fresh device can hydrate.
import { checkAuth } from './_lib/auth.js';
import { sql, rowToCategory, rowToItem } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const db = sql();
    const cats = await db`SELECT * FROM categories ORDER BY display_order, id`;
    const items = await db`SELECT * FROM items ORDER BY display_order, id`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      categories: cats.map(rowToCategory),
      items: items.map(rowToItem),
    });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed', detail: String(err.message || err) });
  }
}

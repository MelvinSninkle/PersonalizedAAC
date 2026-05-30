// GET /api/my-children — the children the signed-in user can see, with a
// portrait for each (the starred/pinned People "me" tile, else the first People
// tile). Powers the therapist roster home (and any future multi-child picker).
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { accessibleChildIds } from './_lib/access.js';

function prettyName(childId) {
  return childId.replace(/peterson$/i, '').replace(/^\w/, c => c.toUpperCase()) || childId;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  try {
    const db = sql();
    const ids = await accessibleChildIds(auth.user, db);
    res.setHeader('Cache-Control', 'no-store');
    if (!ids.length) { res.status(200).json({ children: [] }); return; }

    // Portrait per child: pinned People tile first, else first People tile.
    const portraits = await db`
      SELECT DISTINCT ON (child_id) child_id, image_key, label
      FROM items
      WHERE child_id = ANY(${ids}) AND section = 'people' AND image_key IS NOT NULL
      ORDER BY child_id, pinned DESC, display_order ASC, id ASC`;
    const pmap = new Map(portraits.map(r => [r.child_id, { imageKey: r.image_key, label: r.label }]));

    let relMap = new Map();
    if (auth.user.id != null) {
      const rel = await db`SELECT child_id, relation FROM child_access WHERE user_id = ${auth.user.id} AND status = 'active'`;
      relMap = new Map(rel.map(r => [r.child_id, r.relation]));
    }

    const children = ids.map(id => ({
      childId: id,
      name: prettyName(id),
      imageKey: (pmap.get(id) || {}).imageKey || null,
      relation: relMap.get(id) || (auth.user.role === 'admin' ? 'admin' : ''),
    })).sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({ children });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load children', detail: String(err.message || err) });
  }
}

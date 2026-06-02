// GET  /api/therapist/boards         — list my board templates + share counts
// POST /api/therapist/boards         — create a new template (top-level category)
//
// A board template is a `categories` row with child_id IS NULL and
// owner_user_id = me. Items + subcategories live under it with the same
// child_id IS NULL + owner_user_id = me. Created from any user account; the UI
// (therapist-library) only surfaces them for the owner.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

const VALID_SECTIONS = new Set(['people', 'nouns', 'verbs', 'needs']);

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.id == null) { res.status(403).json({ error: 'Sign in required' }); return; }

  try {
    const db = sql();

    if (req.method === 'GET') {
      const rows = await db`
        SELECT c.id, c.section, c.label, c.image_key, c.keep_aspect, c.display_order, c.created_at,
               (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id)::int        AS item_count,
               (SELECT COUNT(*) FROM categories s WHERE s.parent_id = c.id)::int     AS sub_count,
               (SELECT COUNT(*) FROM category_shares cs
                  WHERE cs.category_id = c.id AND cs.status = 'active')::int          AS share_count
        FROM categories c
        WHERE c.owner_user_id = ${auth.user.id}
          AND c.child_id IS NULL
          AND c.parent_id IS NULL
        ORDER BY c.display_order DESC, c.id DESC`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        boards: rows.map(r => ({
          id: Number(r.id), section: r.section, label: r.label,
          imageKey: r.image_key, keepAspect: !!r.keep_aspect,
          itemCount: r.item_count, subCount: r.sub_count, shareCount: r.share_count,
          createdAt: r.created_at,
        })),
      });
      return;
    }

    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      const section = String(b.section || 'nouns').toLowerCase();
      const label = typeof b.label === 'string' ? b.label.trim().slice(0, 120) : '';
      const imageKey = typeof b.imageKey === 'string' ? b.imageKey : null;
      const keepAspect = !!b.keepAspect;
      if (!VALID_SECTIONS.has(section)) { res.status(400).json({ error: 'invalid section' }); return; }
      if (!label) { res.status(400).json({ error: 'label required' }); return; }
      const rows = await db`
        INSERT INTO categories (section, label, parent_id, image_key, keep_aspect, display_order, child_id, owner_user_id, updated_at)
        VALUES (${section}, ${label}, NULL, ${imageKey}, ${keepAspect}, ${Date.now()}, NULL, ${auth.user.id}, NOW())
        RETURNING id, section, label, image_key, keep_aspect`;
      const c = rows[0];
      res.status(200).json({
        ok: true,
        board: { id: Number(c.id), section: c.section, label: c.label, imageKey: c.image_key, keepAspect: !!c.keep_aspect, itemCount: 0, subCount: 0, shareCount: 0 },
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

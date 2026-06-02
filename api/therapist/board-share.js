// POST   /api/therapist/board-share?categoryId=X&childId=Y — owner shares
//                                                            template X with child Y.
// DELETE /api/therapist/board-share?categoryId=X&childId=Y — remove the share.
//   - If caller is the template's owner OR admin → delete the share row outright.
//   - If caller is a parent of the child         → soft-remove (status='removed').
//     Owner re-sharing later flips it back to 'active'.
//   - Other callers → 403.
// GET    /api/therapist/board-share?categoryId=X — list the children this
//                                                  template is currently shared with
//                                                  (owner only; for the share modal).
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { canAccessChild, isParentOf } from '../_lib/access.js';

async function loadTemplate(db, categoryId) {
  const rows = await db`
    SELECT id, owner_user_id, child_id, parent_id, label
    FROM categories WHERE id = ${categoryId} LIMIT 1`;
  return rows[0] || null;
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.id == null) { res.status(403).json({ error: 'Sign in required' }); return; }

  const categoryId = Number(req.query && req.query.categoryId);
  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  if (!Number.isFinite(categoryId)) { res.status(400).json({ error: 'categoryId required' }); return; }

  try {
    const db = sql();
    const tpl = await loadTemplate(db, categoryId);
    if (!tpl) { res.status(404).json({ error: 'Board not found' }); return; }
    if (tpl.child_id != null || tpl.parent_id != null) {
      res.status(400).json({ error: 'Not a template (only top-level shared boards can be shared)' }); return;
    }

    const isOwner = Number(tpl.owner_user_id) === Number(auth.user.id);
    const isAdmin = auth.user.role === 'admin';

    if (req.method === 'GET') {
      if (!isOwner && !isAdmin) { res.status(403).json({ error: 'Owner only' }); return; }
      const shares = await db`
        SELECT child_id, status, created_at FROM category_shares
        WHERE category_id = ${categoryId} ORDER BY created_at DESC`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ shares: shares.map(s => ({ childId: s.child_id, status: s.status, sharedAt: s.created_at })) });
      return;
    }

    if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

    if (req.method === 'POST') {
      // Owner / admin only — sharing is the therapist's decision.
      if (!isOwner && !isAdmin) { res.status(403).json({ error: 'Only the board owner can share it' }); return; }
      // Owner must also have access to this child (avoids fan-out to children they don't see).
      if (!isAdmin && !(await canAccessChild(auth.user, childId, db))) {
        res.status(403).json({ error: "You don't have access to that child." }); return;
      }
      await db`
        INSERT INTO category_shares (category_id, child_id, status, created_by)
        VALUES (${categoryId}, ${childId}, 'active', ${auth.user.id})
        ON CONFLICT (category_id, child_id) DO UPDATE
          SET status = 'active', created_at = NOW(), created_by = ${auth.user.id}`;
      res.status(200).json({ ok: true, action: 'shared' });
      return;
    }

    if (req.method === 'DELETE') {
      if (isOwner || isAdmin) {
        await db`DELETE FROM category_shares WHERE category_id = ${categoryId} AND child_id = ${childId}`;
        res.status(200).json({ ok: true, action: 'unshared' });
        return;
      }
      // Parent override path: soft-remove from the child's view, leaving the
      // template intact and the share record for audit.
      if (await isParentOf(auth.user, childId, db)) {
        await db`
          UPDATE category_shares SET status = 'removed'
          WHERE category_id = ${categoryId} AND child_id = ${childId}`;
        res.status(200).json({ ok: true, action: 'removed-from-view' });
        return;
      }
      res.status(403).json({ error: 'Only the board owner or this child\'s parent can remove the share.' });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Share request failed', detail: String(err.message || err) });
  }
}

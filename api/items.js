// /api/items — POST (create), PUT?id=N (update), DELETE?id=N (delete + blob cleanup)
//
// Two ownership contexts are served by the same endpoints:
//   - Child-scoped items (child_id = <slug>, owner_user_id IS NULL or set):
//     parent of that child + admin can edit; written from the parent organizer
//     and the kid-board's edit mode.
//   - Template items (child_id IS NULL, owner_user_id = therapist):
//     only the owner + admin can edit; written from the therapist library.
// The CREATE path infers context from the parent category (looked up by id).
// PUT/DELETE load the row and run canEditContent against its ownership.
import { del } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql, rowToItem } from './_lib/db.js';
import { canEditContent, isParentOf } from './_lib/access.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const db = sql();
    if (req.method === 'POST')   return await create(req, res, db, auth.user);
    if (req.method === 'PUT')    return await update(req, res, db, auth.user);
    if (req.method === 'DELETE') return await remove(req, res, db, auth.user);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

async function create(req, res, db, user) {
  const b = (typeof req.body === 'object' && req.body) || {};
  const section = b.section;
  const label = b.label;
  const categoryId = b.categoryId == null ? null : Number(b.categoryId);
  if (!section || !label) { res.status(400).json({ error: 'section and label required' }); return; }

  // Infer child_id + owner_user_id from the parent category. Fallback to the
  // legacy childId scoping when there's no category (top-level Needs-strip items).
  let childId = null, ownerUserId = null;
  if (categoryId != null) {
    const parents = await db`SELECT child_id, owner_user_id FROM categories WHERE id = ${categoryId} LIMIT 1`;
    if (!parents.length) { res.status(404).json({ error: 'category not found' }); return; }
    childId = parents[0].child_id;
    ownerUserId = parents[0].owner_user_id;
  } else {
    childId = String(((req.body && req.body.childId) || (req.query && req.query.childId) || 'fletcher')).slice(0, 64);
  }

  // Permission. Child-scoped → parent-of-child / admin. Template → owner / admin.
  if (childId != null) {
    if (user.role !== 'admin' && !(await isParentOf(user, childId, db))) {
      res.status(403).json({ error: "You don't have write access for that child." }); return;
    }
  } else {
    if (user.role !== 'admin' && Number(ownerUserId) !== Number(user.id)) {
      res.status(403).json({ error: 'Only the board owner can add tiles here.' }); return;
    }
  }

  const rows = await db`
    INSERT INTO items
      (section, category_id, label, image_url, image_key, sound_url, sound_key,
       keep_aspect, display_order, pinned, child_id, owner_user_id, updated_at)
    VALUES
      (${section}, ${categoryId}, ${label},
       ${b.imageUrl ?? null}, ${b.imageKey ?? null},
       ${b.soundUrl ?? null}, ${b.soundKey ?? null},
       ${!!b.keepAspect}, ${b.order ?? Date.now()}, ${!!b.pinned},
       ${childId}, ${ownerUserId}, NOW())
    RETURNING *
  `;
  res.status(200).json(rowToItem(rows[0]));
}

async function update(req, res, db, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const current = await db`SELECT * FROM items WHERE id = ${id} LIMIT 1`;
  if (!current.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = current[0];

  if (!(await canEditContent(user, old.owner_user_id, old.child_id, db))) {
    res.status(403).json({ error: 'No edit access' }); return;
  }

  const { label, categoryId, imageUrl, imageKey, soundUrl, soundKey, keepAspect, order, pinned, section } = req.body || {};
  const rows = await db`
    UPDATE items SET
      label         = COALESCE(${label ?? null},      label),
      section       = COALESCE(${section ?? null},    section),
      category_id   = ${categoryId === undefined ? old.category_id : categoryId},
      image_url     = COALESCE(${imageUrl ?? null},   image_url),
      image_key     = COALESCE(${imageKey ?? null},   image_key),
      sound_url     = COALESCE(${soundUrl ?? null},   sound_url),
      sound_key     = COALESCE(${soundKey ?? null},   sound_key),
      keep_aspect   = ${keepAspect === undefined ? old.keep_aspect : !!keepAspect},
      display_order = COALESCE(${order ?? null},      display_order),
      pinned        = ${pinned === undefined ? old.pinned : !!pinned},
      updated_at    = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  if (imageKey && old.image_key && imageKey !== old.image_key) { try { await del(old.image_key); } catch (_) {} }
  if (soundKey && old.sound_key && soundKey !== old.sound_key) { try { await del(old.sound_key); } catch (_) {} }

  res.status(200).json(rowToItem(rows[0]));
}

async function remove(req, res, db, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const rows = await db`SELECT * FROM items WHERE id = ${id} LIMIT 1`;
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = rows[0];

  if (!(await canEditContent(user, old.owner_user_id, old.child_id, db))) {
    res.status(403).json({ error: 'No delete access' }); return;
  }

  await db`DELETE FROM items WHERE id = ${id}`;
  if (old.image_key) { try { await del(old.image_key); } catch (_) {} }
  if (old.sound_key) { try { await del(old.sound_key); } catch (_) {} }
  res.status(200).json({ ok: true });
}

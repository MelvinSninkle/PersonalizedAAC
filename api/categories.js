// /api/categories — POST (create), PUT?id=N (update), DELETE?id=N (delete with cascade)
//
// Two ownership contexts (mirrors /api/items):
//   - Child-scoped categories (child_id = <slug>): parent + admin can edit.
//   - Template categories (child_id IS NULL, owner_user_id = therapist):
//     only the owner + admin can edit; subcategories of a template inherit.
// CREATE infers context from the parent category when parentId is set;
// otherwise falls back to legacy childId scoping. PUT/DELETE load the row and
// run canEditContent against its ownership.
import { del } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql, rowToCategory } from './_lib/db.js';
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
  const { section, label, imageUrl, imageKey, keepAspect, order } = b;
  const parentId = b.parentId == null ? null : Number(b.parentId);
  if (!section || !label) { res.status(400).json({ error: 'section and label required' }); return; }

  let childId = null, ownerUserId = null;
  if (parentId != null) {
    const parents = await db`SELECT child_id, owner_user_id FROM categories WHERE id = ${parentId} LIMIT 1`;
    if (!parents.length) { res.status(404).json({ error: 'parent category not found' }); return; }
    childId = parents[0].child_id;
    ownerUserId = parents[0].owner_user_id;
  } else {
    // Top-level category. Templates use /api/therapist/boards; this falls back
    // to legacy per-child scoping (the existing parent organizer + kid board).
    childId = String((b.childId || (req.query && req.query.childId) || 'fletcher')).slice(0, 64);
  }

  if (childId != null) {
    if (user.role !== 'admin' && !(await isParentOf(user, childId, db))) {
      res.status(403).json({ error: "You don't have write access for that child." }); return;
    }
  } else {
    if (user.role !== 'admin' && Number(ownerUserId) !== Number(user.id)) {
      res.status(403).json({ error: 'Only the board owner can add subcategories here.' }); return;
    }
  }

  const rows = await db`
    INSERT INTO categories (section, label, parent_id, image_url, image_key, keep_aspect, display_order, child_id, owner_user_id, updated_at)
    VALUES (${section}, ${label}, ${parentId}, ${imageUrl ?? null}, ${imageKey ?? null}, ${!!keepAspect}, ${order ?? Date.now()}, ${childId}, ${ownerUserId}, NOW())
    RETURNING *
  `;
  res.status(200).json(rowToCategory(rows[0]));
}

async function update(req, res, db, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const { label, parentId, imageUrl, imageKey, keepAspect, order, section, cascade } = req.body || {};

  const current = await db`SELECT * FROM categories WHERE id = ${id} LIMIT 1`;
  if (!current.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = current[0];

  if (!(await canEditContent(user, old.owner_user_id, old.child_id, db))) {
    res.status(403).json({ error: 'No edit access' }); return;
  }

  const rows = await db`
    UPDATE categories SET
      label         = COALESCE(${label ?? null},   label),
      section       = COALESCE(${section ?? null}, section),
      parent_id     = ${parentId === undefined ? old.parent_id : parentId},
      image_url     = COALESCE(${imageUrl ?? null}, image_url),
      image_key     = COALESCE(${imageKey ?? null}, image_key),
      keep_aspect   = ${keepAspect === undefined ? old.keep_aspect : !!keepAspect},
      display_order = COALESCE(${order ?? null},   display_order),
      updated_at    = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  // Moving a category to another section carries its whole subtree along — but
  // ONLY within the same ownership scope (child_id NULL-vs-NULL or matching slug).
  if (section && cascade) {
    if (old.child_id != null) {
      await db`
        WITH RECURSIVE tree AS (
          SELECT id FROM categories WHERE id = ${id} AND child_id = ${old.child_id}
          UNION ALL
          SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.child_id = ${old.child_id}
        )
        UPDATE categories SET section = ${section}, updated_at = NOW()
        WHERE id IN (SELECT id FROM tree) AND child_id = ${old.child_id}`;
      await db`
        WITH RECURSIVE tree AS (
          SELECT id FROM categories WHERE id = ${id} AND child_id = ${old.child_id}
          UNION ALL
          SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.child_id = ${old.child_id}
        )
        UPDATE items SET section = ${section}, updated_at = NOW()
        WHERE category_id IN (SELECT id FROM tree) AND child_id = ${old.child_id}`;
    } else {
      // Template subtree (child_id IS NULL throughout).
      await db`
        WITH RECURSIVE tree AS (
          SELECT id FROM categories WHERE id = ${id} AND child_id IS NULL
          UNION ALL
          SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.child_id IS NULL
        )
        UPDATE categories SET section = ${section}, updated_at = NOW()
        WHERE id IN (SELECT id FROM tree) AND child_id IS NULL`;
      await db`
        WITH RECURSIVE tree AS (
          SELECT id FROM categories WHERE id = ${id} AND child_id IS NULL
          UNION ALL
          SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.child_id IS NULL
        )
        UPDATE items SET section = ${section}, updated_at = NOW()
        WHERE category_id IN (SELECT id FROM tree) AND child_id IS NULL`;
    }
  }

  if (imageKey && old.image_key && imageKey !== old.image_key) {
    try { await del(old.image_key); } catch (_) {}
  }

  res.status(200).json(rowToCategory(rows[0]));
}

async function remove(req, res, db, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const current = await db`SELECT * FROM categories WHERE id = ${id} LIMIT 1`;
  if (!current.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = current[0];

  if (!(await canEditContent(user, old.owner_user_id, old.child_id, db))) {
    res.status(403).json({ error: 'No delete access' }); return;
  }

  // Find all descendant category ids within the same ownership scope.
  const descendants = old.child_id != null
    ? await db`
        WITH RECURSIVE tree AS (
          SELECT id FROM categories WHERE id = ${id} AND child_id = ${old.child_id}
          UNION ALL
          SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.child_id = ${old.child_id}
        )
        SELECT id FROM tree`
    : await db`
        WITH RECURSIVE tree AS (
          SELECT id FROM categories WHERE id = ${id} AND child_id IS NULL
          UNION ALL
          SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.child_id IS NULL
        )
        SELECT id FROM tree`;
  const catIds = descendants.map(r => Number(r.id));

  const catBlobs = await db`SELECT image_key FROM categories WHERE id = ANY(${catIds})`;
  const itemBlobs = await db`SELECT image_key, sound_key FROM items WHERE category_id = ANY(${catIds})`;
  const keys = [];
  catBlobs.forEach(r => { if (r.image_key) keys.push(r.image_key); });
  itemBlobs.forEach(r => { if (r.image_key) keys.push(r.image_key); if (r.sound_key) keys.push(r.sound_key); });

  // FK cascade handles descendants and dependent items.
  await db`DELETE FROM categories WHERE id = ${id}`;

  for (const k of keys) { try { await del(k); } catch (_) {} }

  res.status(200).json({ ok: true, deletedCategoryIds: catIds });
}

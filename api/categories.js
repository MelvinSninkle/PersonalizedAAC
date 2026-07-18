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
import { sql, rowToCategory, stampLayoutCustomized } from './_lib/db.js';
import { canEditContent, isParentOf } from './_lib/access.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const db = sql();
    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      if (b.op === 'reorder') return await reorderBulk(req, res, db, auth.user, b);
      return await create(req, res, db, auth.user);
    }
    if (req.method === 'PUT')    return await update(req, res, db, auth.user);
    if (req.method === 'DELETE') return await remove(req, res, db, auth.user);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

// POST { op:'reorder', ids:[...] } — persist a chip drag-reorder in ONE
// request (mirror of items.js reorderBulk; ids = the sibling chips in their
// new order → i*1000). One board per call; parent-or-admin edits everything,
// a therapist only their own rows.
async function reorderBulk(req, res, db, user, b) {
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite).slice(0, 200);
  if (!ids.length) { res.status(400).json({ error: 'ids required' }); return; }
  const rows = await db`SELECT id, child_id, owner_user_id FROM categories WHERE id = ANY(${ids})`;
  if (!rows.length) { res.status(404).json({ error: 'categories not found' }); return; }
  const childId = rows[0].child_id;
  if (!childId || rows.some((r) => r.child_id !== childId)) {
    res.status(400).json({ error: 'ids must all belong to one board' }); return;
  }
  const parentOK = await canEditContent(user, null, childId, db);
  for (const r of rows) {
    const ownRow = r.owner_user_id != null && user.id != null
      && Number(r.owner_user_id) === Number(user.id);
    if (!parentOK && !ownRow) { res.status(403).json({ error: 'Not allowed' }); return; }
  }
  const orders = ids.map((_, i) => i * 1000);
  try {
    await db`
      UPDATE categories AS c SET display_order = v.ord, updated_at = NOW()
      FROM (SELECT UNNEST(${ids}::int[]) AS id, UNNEST(${orders}::int[]) AS ord) AS v
      WHERE c.id = v.id AND c.child_id = ${childId}`;
  } catch (_) {
    for (let i = 0; i < ids.length; i++) {
      await db`UPDATE categories SET display_order = ${orders[i]}, updated_at = NOW()
               WHERE id = ${ids[i]} AND child_id = ${childId}`;
    }
  }
  await stampLayoutCustomized(db, childId);
  res.status(200).json({ ok: true, count: ids.length });
}

async function create(req, res, db, user) {
  const b = (typeof req.body === 'object' && req.body) || {};
  const { section, label, imageUrl, imageKey, keepAspect, order } = b;
  const parentId = b.parentId == null ? null : Number(b.parentId);
  const kind = normalizeKind(b.kind);
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
    INSERT INTO categories (section, label, parent_id, image_url, image_key, keep_aspect, display_order, child_id, owner_user_id, kind, updated_at)
    VALUES (${section}, ${label}, ${parentId}, ${imageUrl ?? null}, ${imageKey ?? null}, ${!!keepAspect}, ${order ?? Date.now()}, ${childId}, ${ownerUserId}, ${kind}, NOW())
    RETURNING *
  `;
  res.status(200).json(rowToCategory(rows[0]));
}

/// Whitelist the category "kind" hint so only known values land in the DB.
/// null clears the field (back to a normal category).
function normalizeKind(v) {
  if (v === undefined) return undefined;     // means "don't touch on update"
  if (v === null || v === '') return null;
  return (v === 'location' || v === 'room') ? v : null;
}

async function update(req, res, db, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const { label, parentId, imageUrl, imageKey, keepAspect, order, section, cascade } = req.body || {};
  const kind = normalizeKind((req.body || {}).kind);

  const current = await db`SELECT * FROM categories WHERE id = ${id} LIMIT 1`;
  if (!current.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = current[0];

  if (!(await canEditContent(user, old.owner_user_id, old.child_id, db))) {
    res.status(403).json({ error: 'No edit access' }); return;
  }

  // Re-parent guard: never under itself or its own subtree, never across
  // child/owner scopes (would leak the subtree onto another board).
  if (parentId !== undefined && parentId != null && Number(parentId) !== Number(old.parent_id)) {
    const pid = Number(parentId);
    if (!Number.isFinite(pid)) { res.status(400).json({ error: 'Invalid parentId' }); return; }
    const np = await db`SELECT child_id, owner_user_id FROM categories WHERE id = ${pid} LIMIT 1`;
    if (!np.length) { res.status(400).json({ error: 'Parent category not found' }); return; }
    if ((np[0].child_id ?? null) !== (old.child_id ?? null)
      || String(np[0].owner_user_id ?? '') !== String(old.owner_user_id ?? '')) {
      res.status(400).json({ error: 'Parent belongs to a different board scope' }); return;
    }
    const cyc = await db`
      WITH RECURSIVE tree AS (
        SELECT id FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
      )
      SELECT 1 FROM tree WHERE id = ${pid} LIMIT 1`;
    if (cyc.length) { res.status(400).json({ error: 'Cannot move a category inside itself or its descendants' }); return; }
  }

  const rows = await db`
    UPDATE categories SET
      label         = COALESCE(${label ?? null},   label),
      section       = COALESCE(${section ?? null}, section),
      parent_id     = ${parentId === undefined ? old.parent_id : parentId},
      image_url     = COALESCE(${imageUrl ?? null}, image_url),
      image_key     = COALESCE(${imageKey ?? null}, image_key),
      keep_aspect   = ${keepAspect === undefined ? old.keep_aspect : !!keepAspect},
      kind          = ${kind === undefined ? old.kind : kind},
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

  // A deliberate folder reorder marks the board family-arranged: the Lab's
  // layout push skips it from now on unless the admin explicitly overrides.
  if (order != null && old.child_id) await stampLayoutCustomized(db, old.child_id);

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

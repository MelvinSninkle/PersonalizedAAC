// /api/categories — POST (create), PUT?id=N (update), DELETE?id=N (delete with cascade)
import { del } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql, rowToCategory } from './_lib/db.js';

export default async function handler(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const db = sql();
    if (req.method === 'POST')   return await create(req, res, db);
    if (req.method === 'PUT')    return await update(req, res, db);
    if (req.method === 'DELETE') return await remove(req, res, db);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

function childIdOf(req) {
  const raw = (req.body && req.body.childId) || (req.query && req.query.childId) || 'fletcher';
  return String(raw).slice(0, 64);
}

async function create(req, res, db) {
  const { section, label, parentId, imageUrl, imageKey, keepAspect, order } = req.body || {};
  const childId = childIdOf(req);
  if (!section || !label) {
    res.status(400).json({ error: 'section and label required' });
    return;
  }
  const rows = await db`
    INSERT INTO categories (section, label, parent_id, image_url, image_key, keep_aspect, display_order, child_id, updated_at)
    VALUES (${section}, ${label}, ${parentId ?? null}, ${imageUrl ?? null}, ${imageKey ?? null}, ${!!keepAspect}, ${order ?? Date.now()}, ${childId}, NOW())
    RETURNING *
  `;
  res.status(200).json(rowToCategory(rows[0]));
}

async function update(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const childId = childIdOf(req);
  const { label, parentId, imageUrl, imageKey, keepAspect, order } = req.body || {};

  // Load current row so we can know which old blob to delete if image changed
  const current = await db`SELECT * FROM categories WHERE id = ${id} AND child_id = ${childId}`;
  if (!current.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = current[0];

  const rows = await db`
    UPDATE categories SET
      label         = COALESCE(${label ?? null},   label),
      parent_id     = ${parentId === undefined ? old.parent_id : parentId},
      image_url     = COALESCE(${imageUrl ?? null}, image_url),
      image_key     = COALESCE(${imageKey ?? null}, image_key),
      keep_aspect   = ${keepAspect === undefined ? old.keep_aspect : !!keepAspect},
      display_order = COALESCE(${order ?? null},   display_order),
      updated_at    = NOW()
    WHERE id = ${id} AND child_id = ${childId}
    RETURNING *
  `;

  // Best-effort: if a new image was uploaded, garbage-collect the old blob
  if (imageKey && old.image_key && imageKey !== old.image_key) {
    try { await del(old.image_key); } catch (_) {}
  }

  res.status(200).json(rowToCategory(rows[0]));
}

async function remove(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const childId = childIdOf(req);

  // Find all descendant category ids (recursive CTE) so we can collect blobs
  // to delete — scoped to this child so a stray id can't reach across children.
  const descendants = await db`
    WITH RECURSIVE tree AS (
      SELECT id FROM categories WHERE id = ${id} AND child_id = ${childId}
      UNION ALL
      SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
        WHERE c.child_id = ${childId}
    )
    SELECT id FROM tree
  `;
  const catIds = descendants.map(r => Number(r.id));
  if (!catIds.length) { res.status(404).json({ error: 'Not found' }); return; }

  // Collect blob keys (categories + their items) for best-effort cleanup
  const catBlobs = await db`SELECT image_key FROM categories WHERE id = ANY(${catIds}) AND child_id = ${childId}`;
  const itemBlobs = await db`SELECT image_key, sound_key FROM items WHERE category_id = ANY(${catIds}) AND child_id = ${childId}`;
  const keys = [];
  catBlobs.forEach(r => { if (r.image_key) keys.push(r.image_key); });
  itemBlobs.forEach(r => {
    if (r.image_key) keys.push(r.image_key);
    if (r.sound_key) keys.push(r.sound_key);
  });

  // DB cascade does the rest (FKs ON DELETE CASCADE)
  await db`DELETE FROM categories WHERE id = ${id} AND child_id = ${childId}`;

  // Best-effort blob cleanup; failures here don't block success
  for (const k of keys) {
    try { await del(k); } catch (_) {}
  }

  res.status(200).json({ ok: true, deletedCategoryIds: catIds });
}

// /api/items — POST (create), PUT?id=N (update), DELETE?id=N (delete + blob cleanup)
import { del } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql, rowToItem } from './_lib/db.js';

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

async function create(req, res, db) {
  const { section, categoryId, label, imageUrl, imageKey, soundUrl, soundKey, keepAspect, order, pinned } = req.body || {};
  if (!section || !label) {
    res.status(400).json({ error: 'section and label required' });
    return;
  }
  const rows = await db`
    INSERT INTO items
      (section, category_id, label, image_url, image_key, sound_url, sound_key, keep_aspect, display_order, pinned, updated_at)
    VALUES
      (${section}, ${categoryId ?? null}, ${label},
       ${imageUrl ?? null}, ${imageKey ?? null},
       ${soundUrl ?? null}, ${soundKey ?? null},
       ${!!keepAspect},
       ${order ?? Date.now()}, ${!!pinned}, NOW())
    RETURNING *
  `;
  res.status(200).json(rowToItem(rows[0]));
}

async function update(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const { label, categoryId, imageUrl, imageKey, soundUrl, soundKey, keepAspect, order, pinned } = req.body || {};

  const current = await db`SELECT * FROM items WHERE id = ${id}`;
  if (!current.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = current[0];

  const rows = await db`
    UPDATE items SET
      label         = COALESCE(${label ?? null},      label),
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

  // Best-effort orphan-blob cleanup
  if (imageKey && old.image_key && imageKey !== old.image_key) {
    try { await del(old.image_key); } catch (_) {}
  }
  if (soundKey && old.sound_key && soundKey !== old.sound_key) {
    try { await del(old.sound_key); } catch (_) {}
  }

  res.status(200).json(rowToItem(rows[0]));
}

async function remove(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const rows = await db`SELECT image_key, sound_key FROM items WHERE id = ${id}`;
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = rows[0];

  await db`DELETE FROM items WHERE id = ${id}`;

  if (old.image_key) { try { await del(old.image_key); } catch (_) {} }
  if (old.sound_key) { try { await del(old.sound_key); } catch (_) {} }

  res.status(200).json({ ok: true });
}

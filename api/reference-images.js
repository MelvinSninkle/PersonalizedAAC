// /api/reference-images — per-child style/subject reference images that steer
// AI tile generation. Managed from the parent dashboard.
//   GET    ?childId=         list references
//   POST   { childId, blobKey, label? }  record an uploaded reference (key from /api/upload)
//   DELETE ?id=              remove a reference (and its blob)
// Parent or admin only.
import { del } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild, isParentOf } from './_lib/access.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  if (auth.user.role !== 'admin' && auth.user.role !== 'parent') {
    res.status(403).json({ error: 'Parents or admins only' });
    return;
  }
  try {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS reference_images (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL,
        blob_key TEXT NOT NULL,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    if (req.method === 'GET') return await list(req, res, db, auth.user);
    if (req.method === 'POST') return await add(req, res, db, auth.user);
    if (req.method === 'DELETE') return await remove(req, res, db, auth.user);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

async function list(req, res, db, user) {
  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
  if (!(await canAccessChild(user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  const rows = await db`SELECT id, blob_key, label, created_at FROM reference_images WHERE child_id = ${childId} ORDER BY created_at DESC`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ references: rows });
}

async function add(req, res, db, user) {
  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = typeof b.childId === 'string' && b.childId ? b.childId.slice(0, 64) : 'fletcherpeterson';
  const blobKey = typeof b.blobKey === 'string' ? b.blobKey : '';
  const label = typeof b.label === 'string' ? b.label.slice(0, 120) : null;
  if (!blobKey) { res.status(400).json({ error: 'blobKey required' }); return; }
  if (!(await canAccessChild(user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  const rows = await db`
    INSERT INTO reference_images (child_id, blob_key, label)
    VALUES (${childId}, ${blobKey}, ${label})
    RETURNING id, blob_key, label, created_at
  `;
  res.status(200).json({ ok: true, reference: rows[0] });
}

async function remove(req, res, db, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const rows = await db`SELECT blob_key, child_id FROM reference_images WHERE id = ${id}`;
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  if (user.role !== 'admin' && !(await isParentOf(user, rows[0].child_id, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  await db`DELETE FROM reference_images WHERE id = ${id}`;
  if (rows[0].blob_key) { try { await del(rows[0].blob_key); } catch (_) {} }
  res.status(200).json({ ok: true });
}

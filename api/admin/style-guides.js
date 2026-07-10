// /api/admin/style-guides — admin-managed reference images for art styles.
// These are the style anchors the Lab uses when generating canonical taxonomy
// images, distinct from per-child reference_images (which are a kid's photos).
//   GET                      list all style guides (active + inactive)
//   POST   { label, blobKey, description?, sortOrder? }  register an uploaded reference
//   PATCH  ?id=   { label?, description?, active?, sortOrder? }  partial update
//   DELETE ?id=              remove a style guide + its blob
import { del } from '@vercel/blob';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  try {
    const db = sql();
    // Defensive migration: the per-style world references (default-board CMS).
    try {
      await db`ALTER TABLE style_guides ADD COLUMN IF NOT EXISTS person_ref_key TEXT`;
      await db`ALTER TABLE style_guides ADD COLUMN IF NOT EXISTS stuff_ref_key TEXT`;
    } catch (_) {}
    if (req.method === 'GET')    return await list(req, res, db);
    if (req.method === 'POST')   return await add(req, res, db, gate.email);
    if (req.method === 'PATCH')  return await patch(req, res, db);
    if (req.method === 'DELETE') return await remove(req, res, db);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

function rowOut(r) {
  return {
    id: r.id,
    label: r.label,
    description: r.description,
    blobUrl: r.blob_url,
    blobKey: r.blob_key,
    previewBlobKey: r.preview_blob_key || null,
    previewUrl: (r.preview_blob_key || r.blob_key) ? `/api/style-guides/public?image=${r.id}` : null,
    // Per-style world references for the pre-built default boards: a generic
    // person drawn in this style + a "stuff" scene. Lab-managed.
    personRefKey: r.person_ref_key || null,
    stuffRefKey: r.stuff_ref_key || null,
    active: !!r.active,
    sortOrder: r.sort_order,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

async function list(req, res, db) {
  // PUBLIC guides only (child_id IS NULL). Parents' private uploads are
  // child-scoped and managed from the parent view, not the Lab.
  const rows = await db`
    SELECT id, label, description, blob_url, blob_key, preview_blob_key, person_ref_key, stuff_ref_key,
           active, sort_order, created_by, created_at
    FROM style_guides
    WHERE child_id IS NULL
    ORDER BY sort_order ASC, created_at ASC
  `;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ styleGuides: rows.map(rowOut) });
}

async function add(req, res, db, email) {
  const b = (typeof req.body === 'object' && req.body) || {};
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 120) : '';
  const blobKey = typeof b.blobKey === 'string' ? b.blobKey.trim() : '';
  const description = typeof b.description === 'string' ? b.description.slice(0, 600) : null;
  const sortOrder = Number.isInteger(b.sortOrder) ? b.sortOrder : 0;
  // Optional polished marketing image for the public picker/home page.
  const previewBlobKey = typeof b.previewBlobKey === 'string' && b.previewBlobKey.trim() ? b.previewBlobKey.trim() : null;
  if (!label) { res.status(400).json({ error: 'label required' }); return; }
  if (!blobKey) { res.status(400).json({ error: 'blobKey required (upload via /api/upload first)' }); return; }
  // Resolve a viewable URL via the existing /api/media route so the UI can
  // <img src=> straight from the database row. child_id NULL = public guide.
  const blobUrl = `/api/media?key=${encodeURIComponent(blobKey)}`;
  const rows = await db`
    INSERT INTO style_guides (label, description, blob_url, blob_key, preview_blob_key, sort_order, created_by, child_id)
    VALUES (${label}, ${description}, ${blobUrl}, ${blobKey}, ${previewBlobKey}, ${sortOrder}, ${email}, NULL)
    RETURNING id, label, description, blob_url, blob_key, preview_blob_key, active, sort_order, created_by, created_at
  `;
  res.status(200).json({ ok: true, styleGuide: rowOut(rows[0]) });
}

async function patch(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const b = (typeof req.body === 'object' && req.body) || {};
  const sets = [];
  const vals = {};
  if (typeof b.label === 'string') { sets.push('label'); vals.label = b.label.trim().slice(0, 120); }
  if (typeof b.description === 'string' || b.description === null) { sets.push('description'); vals.description = b.description ? String(b.description).slice(0, 600) : null; }
  if (typeof b.active === 'boolean') { sets.push('active'); vals.active = b.active; }
  if (Number.isInteger(b.sortOrder)) { sets.push('sort_order'); vals.sort_order = b.sortOrder; }
  if (typeof b.previewBlobKey === 'string' || b.previewBlobKey === null) { sets.push('preview'); vals.preview = b.previewBlobKey ? String(b.previewBlobKey).trim() : null; }
  if (typeof b.personRefKey === 'string' || b.personRefKey === null) { sets.push('personRef'); vals.personRef = b.personRefKey ? String(b.personRefKey).trim() : null; }
  if (typeof b.stuffRefKey === 'string' || b.stuffRefKey === null) { sets.push('stuffRef'); vals.stuffRef = b.stuffRefKey ? String(b.stuffRefKey).trim() : null; }
  if (!sets.length) { res.status(400).json({ error: 'no fields to update' }); return; }
  // Build the update with a small switch — keeps neon-tagged-template safety.
  const r = await db`
    UPDATE style_guides SET
      label       = COALESCE(${vals.label       ?? null}, label),
      description = CASE WHEN ${'description' in vals} THEN ${vals.description ?? null} ELSE description END,
      active      = COALESCE(${vals.active      ?? null}, active),
      sort_order  = COALESCE(${vals.sort_order  ?? null}, sort_order),
      preview_blob_key = CASE WHEN ${'preview' in vals} THEN ${vals.preview ?? null} ELSE preview_blob_key END,
      person_ref_key = CASE WHEN ${'personRef' in vals} THEN ${vals.personRef ?? null} ELSE person_ref_key END,
      stuff_ref_key  = CASE WHEN ${'stuffRef' in vals} THEN ${vals.stuffRef ?? null} ELSE stuff_ref_key END
    WHERE id = ${id}
    RETURNING id, label, description, blob_url, blob_key, preview_blob_key, person_ref_key, stuff_ref_key, active, sort_order, created_by, created_at
  `;
  if (!r.length) { res.status(404).json({ error: 'not found' }); return; }
  res.status(200).json({ ok: true, styleGuide: rowOut(r[0]) });
}

async function remove(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const rows = await db`SELECT blob_key FROM style_guides WHERE id = ${id}`;
  await db`DELETE FROM style_guides WHERE id = ${id}`;
  if (rows[0] && rows[0].blob_key) { try { await del(rows[0].blob_key); } catch (_) {} }
  res.status(200).json({ ok: true });
}

// POST /api/admin/lab-category-upload?childId=&section=&label=&parent=&ext=
// Raw image bytes in body. Sets a category chip's image on the child's board —
// creating the chip row if it doesn't exist (parent must already exist for a
// subcategory). Direct to board: no candidate review, since a chip is one image,
// not a multi-style comparison. Admin-gated.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };
const MAX_BYTES = 8 * 1024 * 1024;
const EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
const CT  = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const q = req.query || {};
  const childId = String(q.childId || '').slice(0, 64).trim();
  const section = String(q.section || '').toLowerCase().trim();
  const label = String(q.label || '').trim();
  const parentLabel = String(q.parent || '').trim();
  let ext = String(q.ext || 'png').toLowerCase().replace(/[^a-z]/g, '');
  if (!EXT.has(ext)) ext = 'png';
  if (!childId || !section || !label) { res.status(400).json({ error: 'childId, section, label required' }); return; }

  let buffer;
  try {
    const chunks = []; let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) { res.status(413).json({ error: 'Image too large', max: MAX_BYTES }); return; }
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  } catch (err) { res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) }); return; }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }

  try {
    const db = sql();
    let parentId = null;
    if (parentLabel) {
      const pr = await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id IS NULL AND lower(label) = lower(${parentLabel}) LIMIT 1`;
      if (!pr.length) { res.status(409).json({ error: `Parent category "${parentLabel}" doesn't exist on ${childId}'s board yet — create it first.` }); return; }
      parentId = pr[0].id;
    }
    const blobKey = `lab/categories/${section}/${randomUUID()}.${ext}`;
    await put(blobKey, buffer, { access: 'private', contentType: CT[ext] || 'image/png', addRandomSuffix: false });

    const ex = parentId == null
      ? await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id IS NULL AND lower(label) = lower(${label}) LIMIT 1`
      : await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id = ${parentId} AND lower(label) = lower(${label}) LIMIT 1`;
    let row, created = false;
    if (ex.length) {
      row = await db`UPDATE categories SET image_key = ${blobKey}, updated_at = NOW() WHERE id = ${ex[0].id} RETURNING id, image_key`;
    } else {
      row = await db`INSERT INTO categories (section, label, parent_id, image_key, keep_aspect, display_order, child_id, updated_at)
        VALUES (${section}, ${label}, ${parentId}, ${blobKey}, FALSE, ${Date.now()}, ${childId}, NOW()) RETURNING id, image_key`;
      created = true;
    }
    res.status(200).json({ ok: true, created, id: Number(row[0].id), imageKey: row[0].image_key });
  } catch (err) {
    res.status(500).json({ error: 'category-upload failed', detail: String(err.message || err) });
  }
}

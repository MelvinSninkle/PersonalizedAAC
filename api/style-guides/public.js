// GET /api/style-guides/public            → { styles: [{ id, label, description }] }
// GET /api/style-guides/public?image=<id>  → streams that guide's preview image
//
// PUBLIC, no auth — this is what the marketing home page reads so the styles
// shown there are the SAME admin-managed public guides used in onboarding.
//
// SECURITY: every query is hard-filtered to active = TRUE AND child_id IS NULL,
// so a parent's PRIVATE uploaded guide (child_id set) can never be listed or
// streamed here. Images prefer preview_blob_key (the polished marketing shot)
// and fall back to blob_key (the raw style anchor).
import { sql } from '../_lib/db.js';
import { readBlobBytes } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const db = sql();
  try {
    const imageId = req.query && req.query.image ? parseInt(req.query.image, 10) : null;
    if (imageId) {
      const rows = await db`
        SELECT preview_blob_key, blob_key FROM style_guides
        WHERE id = ${imageId} AND active = TRUE AND child_id IS NULL LIMIT 1`;
      const key = rows.length ? (rows[0].preview_blob_key || rows[0].blob_key) : null;
      if (!key) { res.status(404).json({ error: 'style image not found' }); return; }
      const { buffer, contentType } = await readBlobBytes(key);
      res.setHeader('Content-Type', contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).send(buffer);
      return;
    }

    const rows = await db`
      SELECT id, label, description FROM style_guides
      WHERE active = TRUE AND child_id IS NULL
      ORDER BY sort_order ASC, created_at ASC`;
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({
      styles: rows.map(r => ({ id: Number(r.id), label: r.label, description: r.description || null })),
    });
  } catch (err) {
    res.status(500).json({ error: 'styles failed', detail: String(err.message || err) });
  }
}

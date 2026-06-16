// GET /api/onboarding/styles
//   (no params)      → { styles: [{ id, label, description }] } for the picker
//   ?image=<id>      → streams that style guide's reference image (auth-gated)
//
// The onboarding art-style picker needs the same style_guides the admin Lab uses,
// but parents aren't admins — so this read-only endpoint exposes just the active
// guides + their preview image, nothing editable.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { readBlobBytes } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const db = sql();
  try {
    const imageId = req.query && req.query.image ? parseInt(req.query.image, 10) : null;
    if (imageId) {
      const rows = await db`SELECT blob_key FROM style_guides WHERE id = ${imageId} AND active = TRUE LIMIT 1`;
      if (!rows.length || !rows[0].blob_key) { res.status(404).json({ error: 'style image not found' }); return; }
      const { buffer, contentType } = await readBlobBytes(rows[0].blob_key);
      res.setHeader('Content-Type', contentType || 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.status(200).send(buffer);
      return;
    }

    const rows = await db`
      SELECT id, label, description FROM style_guides
      WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      styles: rows.map(r => ({ id: Number(r.id), label: r.label, description: r.description || null })),
    });
  } catch (err) {
    res.status(500).json({ error: 'styles failed', detail: String(err.message || err) });
  }
}

// POST /api/admin/lab-upload-image?taxonomyId=<id>&ext=png|jpg|webp
// Raw image bytes in the body. Attaches an image you already made to a taxonomy
// tile as a CANDIDATE in the Lab's QC gallery (model='upload'). It is NOT
// auto-marked best — you review it next to the generated ones and click ★ to make
// it the tile's canonical image. No OpenAI call, no cost. Admin-gated.
//
// This is the cheap, hands-on path to the reusable canonical image library:
// upload (or generate) per tile, eyeball it, mark best — a bit at a time.
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
  const taxonomyId = String(q.taxonomyId || '').trim();
  if (!taxonomyId) { res.status(400).json({ error: 'taxonomyId required' }); return; }
  let ext = String(q.ext || 'png').toLowerCase().replace(/[^a-z]/g, '');
  if (!EXT.has(ext)) ext = 'png';

  let db;
  try { db = sql(); } catch (err) { res.status(500).json({ error: 'DB not configured', detail: String(err.message || err) }); return; }

  const tax = await db`SELECT id FROM taxonomy WHERE id = ${taxonomyId}`;
  if (!tax.length) { res.status(404).json({ error: 'taxonomy tile not found', taxonomyId }); return; }

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
    const blobKey = `lab/${taxonomyId}/upload-${randomUUID()}.${ext}`;
    await put(blobKey, buffer, { access: 'private', contentType: CT[ext] || 'image/png', addRandomSuffix: false });
    const blobUrl = `/api/media?key=${encodeURIComponent(blobKey)}`;
    const gen = await db`
      INSERT INTO tile_generations
        (taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key, cost_cents, created_by)
      VALUES
        (${taxonomyId}, ${null}, ${'upload'}, ${'(uploaded image)'}, ${blobUrl}, ${blobKey}, ${0}, ${gate.email})
      RETURNING id, taxonomy_id, style_guide_id, model, blob_url, blob_key, marked_best, created_at`;
    res.status(200).json({
      ok: true,
      generation: {
        id: gen[0].id, taxonomyId: gen[0].taxonomy_id, styleGuideId: gen[0].style_guide_id,
        model: gen[0].model, blobUrl: gen[0].blob_url, blobKey: gen[0].blob_key,
        markedBest: !!gen[0].marked_best, createdAt: gen[0].created_at,
      },
    });
  } catch (err) {
    res.status(502).json({ error: 'Upload failed', detail: String(err.message || err) });
  }
}

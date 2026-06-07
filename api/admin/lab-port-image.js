// POST /api/admin/lab-port-image  { taxonomyId, childId }
// "Port over" an image the child already has: find the board item that matches
// this library tile (by taxonomy_slug, else by section+label) and add ITS image
// as a candidate generation (model='ported') so you can review it and ★ it as the
// tile's canonical image — reusing art you already made instead of regenerating.
// Admin-gated.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const b = (typeof req.body === 'object' && req.body) || {};
  const taxonomyId = String(b.taxonomyId || '').trim();
  const childId = String(b.childId || 'fletcherpeterson').slice(0, 64).trim();
  if (!taxonomyId || !childId) { res.status(400).json({ error: 'taxonomyId and childId required' }); return; }

  try {
    const db = sql();
    const tx = await db`SELECT id, column_name, label FROM taxonomy WHERE id = ${taxonomyId}`;
    if (!tx.length) { res.status(404).json({ error: 'taxonomy tile not found' }); return; }
    const section = String(tx[0].column_name || '').toLowerCase();
    const label = (tx[0].label || '').trim();

    const it = await db`
      SELECT id, image_key FROM items
      WHERE child_id = ${childId}
        AND (taxonomy_slug = ${taxonomyId} OR (section = ${section} AND lower(label) = lower(${label})))
        AND image_key IS NOT NULL
      ORDER BY (taxonomy_slug = ${taxonomyId}) DESC, id DESC
      LIMIT 1`;
    if (!it.length || !it[0].image_key) {
      res.status(404).json({ error: `No existing board image for "${label}" on ${childId}'s board.` });
      return;
    }
    const imageKey = it[0].image_key;
    const blobUrl = `/api/media?key=${encodeURIComponent(imageKey)}`;
    const gen = await db`
      INSERT INTO tile_generations (taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key, cost_cents, created_by)
      VALUES (${taxonomyId}, ${null}, ${'ported'}, ${'(ported from board)'}, ${blobUrl}, ${imageKey}, ${0}, ${gate.email})
      RETURNING id`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, generationId: gen[0].id });
  } catch (err) {
    res.status(500).json({ error: 'port failed', detail: String(err.message || err) });
  }
}

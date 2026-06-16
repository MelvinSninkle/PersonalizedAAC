// POST /api/admin/lab-publish-tile  { taxonomyId, childId }
// Stamp a library tile LIVE onto a child's board using its marked-best image.
// Ensures the board category (and subcategory) chip exists — creating it and
// borrowing this tile's image for the chip if it has none yet — then upserts the
// item under it, linked back by taxonomy_slug. This is the "generate it in the
// Lab and have it go live on Fletcher's board as I go" step. Admin-gated.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { archivePriorImage } from '../_lib/image-history.js';
import { loadChildVoiceId, synthesizeVoice } from '../_lib/onboarding-render.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const b = (typeof req.body === 'object' && req.body) || {};
  const taxonomyId = String(b.taxonomyId || '').trim();
  const childId = String(b.childId || 'fletcherpeterson').slice(0, 64).trim();
  if (!taxonomyId) { res.status(400).json({ error: 'taxonomyId required' }); return; }
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  let db;
  try { db = sql(); } catch (err) { res.status(500).json({ error: 'DB not configured', detail: String(err.message || err) }); return; }

  const tx = await db`SELECT id, column_name, category, subcategory, label FROM taxonomy WHERE id = ${taxonomyId}`;
  if (!tx.length) { res.status(404).json({ error: 'taxonomy tile not found', taxonomyId }); return; }
  const t = tx[0];
  const section = String(t.column_name || '').toLowerCase();
  const category = (t.category || '').trim();
  const subcategory = (t.subcategory || '').trim();
  const label = (t.label || '').trim();
  if (!label) { res.status(400).json({ error: 'tile has no label' }); return; }

  const best = await db`SELECT blob_key FROM tile_generations WHERE taxonomy_id = ${taxonomyId} AND marked_best = TRUE ORDER BY created_at DESC LIMIT 1`;
  if (!best.length || !best[0].blob_key) {
    res.status(400).json({ error: 'No best image yet — mark one ★ in the Lab first.' });
    return;
  }
  const imageKey = best[0].blob_key;

  try {
    // 1) The category (and subcategory) chip must ALREADY exist — we never
    //    auto-create one. The parent decides what categories live on the board
    //    and gives them art first; a tile can only land in a place that exists.
    let targetCatId = null;
    if (category) {
      const ex = await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id IS NULL AND lower(label) = lower(${category}) LIMIT 1`;
      if (!ex.length) {
        res.status(409).json({ error: `The "${category}" category isn't on ${childId}'s board yet — create it first.`, missing: 'category', section, category });
        return;
      }
      targetCatId = ex[0].id;
      if (subcategory) {
        const sx = await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id = ${targetCatId} AND lower(label) = lower(${subcategory}) LIMIT 1`;
        if (!sx.length) {
          res.status(409).json({ error: `The "${category} › ${subcategory}" subcategory isn't on the board yet — create it first.`, missing: 'subcategory', section, category, subcategory });
          return;
        }
        targetCatId = sx[0].id;
      }
    }
    // 3) Upsert the live item (match by taxonomy_slug first, else same label in section).
    const found = await db`SELECT id, image_key, label, section FROM items WHERE child_id = ${childId} AND section = ${section}
      AND (taxonomy_slug = ${taxonomyId} OR lower(label) = lower(${label})) LIMIT 1`;
    let itemId, created = false;
    if (found.length) {
      itemId = found[0].id;
      if (found[0].image_key && found[0].image_key !== imageKey) {
        await archivePriorImage({
          db, childId, itemId, oldKey: found[0].image_key,
          label: found[0].label, section: found[0].section, source: 'lab',
          who: gate.email || null,
        });
      }
      await db`UPDATE items SET label = ${label}, image_key = ${imageKey}, category_id = ${targetCatId},
        taxonomy_slug = ${taxonomyId}, needs_review = FALSE, updated_at = NOW() WHERE id = ${itemId}`;
    } else {
      const it = await db`INSERT INTO items (section, category_id, label, image_key, keep_aspect, display_order, pinned, child_id, taxonomy_slug, needs_review, updated_at)
        VALUES (${section}, ${targetCatId}, ${label}, ${imageKey}, FALSE, ${Date.now()}, FALSE, ${childId}, ${taxonomyId}, FALSE, NOW()) RETURNING id`;
      itemId = it[0].id; created = true;
    }

    // 4) Voice: if the tile has no recorded audio yet, synthesize it in the
    //    child's chosen voice so a freshly published tile is fully ready (art +
    //    voice) instead of falling back to the system voice. Best-effort — a TTS
    //    miss never fails the publish (the image is already live).
    let voiced = false;
    try {
      const cur = await db`SELECT sound_key FROM items WHERE id = ${itemId} LIMIT 1`;
      if (!cur[0] || !cur[0].sound_key) {
        const voiceId = await loadChildVoiceId(db, childId);
        const mp3 = await synthesizeVoice({ text: label, voiceId });
        if (mp3) {
          const soundKey = `lab/${childId}/voice/${randomUUID()}.mp3`;
          await put(soundKey, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
          await db`UPDATE items SET sound_key = ${soundKey}, updated_at = NOW() WHERE id = ${itemId}`;
          voiced = true;
        }
      }
    } catch (_) { /* voice is best-effort; the tile is already published */ }

    res.status(200).json({ ok: true, itemId: Number(itemId), categoryId: targetCatId ? Number(targetCatId) : null, created, voiced, live: true });
  } catch (err) {
    res.status(500).json({ error: 'Publish failed', detail: String(err.message || err) });
  }
}

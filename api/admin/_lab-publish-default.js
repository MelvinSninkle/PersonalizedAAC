// POST /api/admin/lab?action=publish-default  { taxonomyId }
//
// Publish a Lab tile's ★ best image as the shared DEFAULT (generic-board) image
// for its taxonomy row — the Lab counterpart to "Push live" (which puts it on a
// child's board). Only valid for default-able tiles (they don't reference a
// specific person); those are the ones every child reuses via onboarding's
// seed-core. We COPY the best image into the stable taxonomy-defaults/ namespace
// (decoupled from the tile_generations / board lifecycle) and record its key on
// taxonomy.default_image_key. Admin-gated. See _lab-seed-defaults.js / defaults.html.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { isDefaultableTile, readBlobBytes } from '../_lib/onboarding-render.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const b = (typeof req.body === 'object' && req.body) || {};
  const taxonomyId = String(b.taxonomyId || '').trim();
  if (!taxonomyId) { res.status(400).json({ error: 'taxonomyId required' }); return; }

  let db;
  try { db = sql(); } catch (err) { res.status(500).json({ error: 'DB not configured', detail: String(err.message || err) }); return; }

  try {
    const tx = await db`SELECT id, column_name, subject_mode, prompt_template, label FROM taxonomy WHERE id = ${taxonomyId}`;
    if (!tx.length) { res.status(404).json({ error: 'taxonomy tile not found', taxonomyId }); return; }
    const t = tx[0];
    if (!isDefaultableTile(t)) {
      res.status(400).json({ error: 'This tile is personalized (it references a specific person), so it has no shared default. Push it live to a child instead.' });
      return;
    }

    const best = await db`SELECT blob_key FROM tile_generations WHERE taxonomy_id = ${taxonomyId} AND marked_best = TRUE ORDER BY created_at DESC LIMIT 1`;
    if (!best.length || !best[0].blob_key) {
      res.status(400).json({ error: 'No best image yet — mark one ★ in the Lab first.' });
      return;
    }

    // Copy the best image into the stable defaults namespace.
    const { buffer, contentType } = await readBlobBytes(best[0].blob_key);
    const ext = String(contentType || '').includes('jpeg') || String(contentType || '').includes('jpg') ? 'jpg' : 'png';
    const key = `taxonomy-defaults/${taxonomyId}/${randomUUID()}.${ext}`;
    await put(key, buffer, { access: 'private', contentType: contentType || 'image/png', addRandomSuffix: false });
    await db`UPDATE taxonomy SET default_image_key = ${key}, updated_at = NOW() WHERE id = ${taxonomyId}`;

    res.status(200).json({ ok: true, taxonomyId, imageKey: key });
  } catch (err) {
    res.status(500).json({ error: 'Publish to default failed', detail: String(err.message || err) });
  }
}

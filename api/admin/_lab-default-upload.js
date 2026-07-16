// /api/admin/lab?action=default-upload  (admin only)
//
// Set a taxonomy tile's DEFAULT art straight from an uploaded image — the
// curation path for hand-picked imagery (e.g. the mixed group-of-children
// pictures used for person-y tiles), bypassing prompt generation entirely.
//
//   POST { taxonomyId, imageBase64, styleGuideId? }
//     no styleGuideId → generic default: blob under taxonomy-defaults/ and
//                       taxonomy.default_image_key
//     styleGuideId    → that style's default: blob under style-defaults/ and
//                       an upsert into taxonomy_style_defaults
//
// SAFE BY CONSTRUCTION: this writes only the shared default layers. It never
// touches items rows, so a family's own tile art is untouched — sync's
// read-through only overlays defaults onto tiles that have no custom image
// (the `replaceable` guard in api/sync.js).
import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const b = (typeof req.body === 'object' && req.body) || {};
  const taxonomyId = String(b.taxonomyId || '').slice(0, 200).trim();
  const styleGuideId = Number(b.styleGuideId) || null;
  const b64 = String(b.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!taxonomyId || !b64) { res.status(400).json({ error: 'taxonomyId and imageBase64 required' }); return; }

  try {
    const png = Buffer.from(b64, 'base64');
    if (!png.length || png.length > 8 * 1024 * 1024) {
      res.status(400).json({ error: 'image empty or over 8MB' });
      return;
    }
    const db = sql();
    const tax = (await db`SELECT id, label FROM taxonomy WHERE id = ${taxonomyId} LIMIT 1`)[0];
    if (!tax) { res.status(404).json({ error: 'taxonomy row not found' }); return; }

    if (styleGuideId) {
      const key = `style-defaults/${styleGuideId}/${taxonomyId}/${randomUUID()}.png`;
      await put(key, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
      // Uploads always target the style's PRIMARY set (demo_child_id 0) —
      // the one family boards read. Extra demo kids render via the wizard.
      await db`
        INSERT INTO taxonomy_style_defaults (taxonomy_id, style_guide_id, demo_child_id, image_key, status, updated_at)
        VALUES (${taxonomyId}, ${styleGuideId}, 0, ${key}, 'done', NOW())
        ON CONFLICT (taxonomy_id, style_guide_id, demo_child_id)
        DO UPDATE SET image_key = ${key}, status = 'done', error = NULL, updated_at = NOW()`;
      res.status(200).json({ ok: true, scope: 'style', styleGuideId, imageKey: key, label: tax.label });
      return;
    }

    const key = `taxonomy-defaults/${randomUUID()}.png`;
    await put(key, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
    await db`UPDATE taxonomy SET default_image_key = ${key} WHERE id = ${taxonomyId}`;
    res.status(200).json({ ok: true, scope: 'generic', imageKey: key, label: tax.label });
  } catch (err) {
    res.status(500).json({ error: 'default-upload failed', detail: String(err.message || err) });
  }
}

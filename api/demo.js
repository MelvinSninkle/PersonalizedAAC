// PUBLIC practice-board data — the one deliberately unauthenticated read in
// the API. Serves the STARTER board (the same canonical/universal taxonomy
// projection every new family's board is placed from) for the marketing
// practice page, so a prospective parent can feel the product before signing
// up. STRICTLY read-only and shared-library-only:
//   - GET only; every other method is rejected.
//   - Nothing child-owned is queryable here: labels, categories, and the
//     shared default art/audio keys. No child ids, no user data, no writes.
//   - The art itself serves through /api/media's public-prefix whitelist
//     (taxonomy-defaults/, category-defaults/, demo-audio/, …).
// Aggressively CDN-cached — the starter board changes rarely.
import { sql } from './_lib/db.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const db = sql();
    let rows;
    try {
      rows = await db`
        SELECT column_name, category, subcategory, label, default_image_key, sort_order
        FROM taxonomy
        WHERE COALESCE(archived, FALSE) = FALSE
          AND COALESCE(is_event, FALSE) = FALSE
          AND COALESCE(is_gestalt, FALSE) = FALSE
          AND COALESCE(authoring_kind, 'canonical') = 'canonical'
          AND COALESCE(audience, 'universal') = 'universal'
          AND default_image_key IS NOT NULL
        ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST,
                 sort_order NULLS LAST, label`;
    } catch (_) {
      rows = await db`
        SELECT column_name, category, subcategory, label, default_image_key
        FROM taxonomy
        WHERE COALESCE(archived, FALSE) = FALSE
          AND COALESCE(authoring_kind, 'canonical') = 'canonical'
          AND COALESCE(audience, 'universal') = 'universal'
          AND default_image_key IS NOT NULL
        ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST, label`;
    }
    const tiles = rows.map((r) => ({
      label: r.label,
      section: String(r.column_name || '').toLowerCase(),
      category: r.category || '',
      subcategory: r.subcategory || '',
      imageKey: r.default_image_key,
    }));

    // Shared folder icons (category chips), keyed by normalized label.
    let folders = [];
    try {
      folders = (await db`SELECT section, label_norm, image_key FROM category_defaults`)
        .map((r) => ({ section: String(r.section || '').toLowerCase(), label: r.label_norm, imageKey: r.image_key }));
    } catch (_) { /* pre-migration DB — chips just render as text */ }

    // Demo voices built by Lab → demo-audio (deterministic clip keys:
    // demo-audio/<voiceId>/<slug(label)>.mp3). Empty until the admin builds
    // them — the page falls back to the device's own speech synthesis.
    let voices = [];
    try {
      voices = (await db`SELECT voice_id, name FROM demo_voices ORDER BY name`)
        .map((r) => ({ id: r.voice_id, name: r.name }));
    } catch (_) { /* table appears with the first Lab build */ }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ ok: true, tiles, folders, voices });
  } catch (err) {
    res.status(500).json({ error: 'demo failed', detail: String(err.message || err) });
  }
}

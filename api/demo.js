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
    // ?style=<id> renders the demo in an OFFERED style: tile art resolves
    // against taxonomy_style_defaults / category_style_defaults — the exact
    // per-style tables the New Style wizard fills, so a published style is
    // instantly demo-able with zero extra renders. All of that art lives
    // under the public style-defaults/ prefix (shared, never family data).
    // The `styles` list (the page's switcher) shows PUBLISHED styles only;
    // an explicit ?style= id also resolves drafts so the Lab wizard can
    // preview before publishing (draft art is still shared-library-only).
    const styleId = parseInt((req.query && req.query.style) || '', 10);
    // Base rows are ALL placeable canonical/universal taxonomy — NOT gated on
    // default_image_key. Person-referencing rows (all of People, all of
    // Verbs, most of Needs) never get a generic default by design, but the
    // per-style sets DO include them (rendered around the demo kid) — so a
    // styled demo shows the FULL board. Rows with no art from either source
    // are dropped after the overlay below; Classic behaves exactly as before.
    let rows;
    try {
      rows = await db`
        SELECT id, column_name, category, subcategory, label, default_image_key, sort_order
        FROM taxonomy
        WHERE COALESCE(archived, FALSE) = FALSE
          AND COALESCE(is_event, FALSE) = FALSE
          AND COALESCE(is_gestalt, FALSE) = FALSE
          AND COALESCE(authoring_kind, 'canonical') = 'canonical'
          AND COALESCE(audience, 'universal') = 'universal'
        ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST,
                 sort_order NULLS LAST, label`;
    } catch (_) {
      rows = await db`
        SELECT id, column_name, category, subcategory, label, default_image_key
        FROM taxonomy
        WHERE COALESCE(archived, FALSE) = FALSE
          AND COALESCE(authoring_kind, 'canonical') = 'canonical'
          AND COALESCE(audience, 'universal') = 'universal'
        ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST, label`;
    }
    // Style overlay: styled art wins, generic default fills any gaps.
    let styledTiles = new Map();
    let styledChips = new Map();
    if (Number.isFinite(styleId) && styleId > 0) {
      try {
        const t = await db`SELECT taxonomy_id, image_key FROM taxonomy_style_defaults
                           WHERE style_guide_id = ${styleId} AND image_key IS NOT NULL`;
        styledTiles = new Map(t.map((r) => [r.taxonomy_id, r.image_key]));
        const c = await db`SELECT section, label_norm, image_key FROM category_style_defaults
                           WHERE style_guide_id = ${styleId} AND image_key IS NOT NULL`;
        styledChips = new Map(c.map((r) => [`${String(r.section || '').toLowerCase()}|${r.label_norm}`, r.image_key]));
      } catch (_) { /* pre-migration DB — generic art */ }
    }

    const tiles = rows
      .filter((r) => styledTiles.get(r.id) || r.default_image_key)
      .map((r) => ({
        label: r.label,
        section: String(r.column_name || '').toLowerCase(),
        category: r.category || '',
        subcategory: r.subcategory || '',
        imageKey: styledTiles.get(r.id) || r.default_image_key,
      }));

    // Shared folder icons (category chips), keyed by normalized label.
    let folders = [];
    try {
      folders = (await db`SELECT section, label_norm, image_key FROM category_defaults`)
        .map((r) => ({ section: String(r.section || '').toLowerCase(), label: r.label_norm,
                       imageKey: styledChips.get(`${String(r.section || '').toLowerCase()}|${r.label_norm}`) || r.image_key }));
    } catch (_) { /* pre-migration DB — chips just render as text */ }

    // Published styles for the page's style switcher (thumbnails serve via
    // the existing public /api/style-guides/public?image= endpoint).
    let styles = [];
    try {
      styles = (await db`SELECT id, label FROM style_guides
                         WHERE active = TRUE AND child_id IS NULL
                         ORDER BY sort_order, id`)
        .map((r) => ({ id: Number(r.id), label: r.label }));
    } catch (_) { /* pre-migration DB — no switcher */ }

    // Demo voices built by Lab → demo-audio (deterministic clip keys:
    // demo-audio/<voiceId>/<slug(label)>.mp3). Empty until the admin builds
    // them — the page falls back to the device's own speech synthesis.
    let voices = [];
    try {
      voices = (await db`SELECT voice_id, name FROM demo_voices ORDER BY name`)
        .map((r) => ({ id: r.voice_id, name: r.name }));
    } catch (_) { /* table appears with the first Lab build */ }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ ok: true, tiles, folders, voices, styles,
                           style: Number.isFinite(styleId) && styleId > 0 ? styleId : null });
  } catch (err) {
    res.status(500).json({ error: 'demo failed', detail: String(err.message || err) });
  }
}

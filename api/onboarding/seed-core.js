// POST /api/onboarding/seed-core?g=<groupIndex>
//
// Final step: generate the child's CURATED STARTER board for real — the baseline
// "core" vocabulary a brand-new child starts with (taxonomy.core = TRUE,
// published), ordered Core-category first so the most important words land even
// if the parent stops early. Each tile renders the SAME way the admin Lab does
// (api/_lib/onboarding-render.js): the parent's style-guide image as the art
// reference (the approved keystone after onboarding) plus the child's committed
// self-portrait as the subject anchor for any tile that depicts the child. Each
// rendered tile is uploaded and dropped on the board, linked by taxonomy_slug.
//
// CHUNKED + RESUMABLE: a curated set (~80-150 tiles) can't reliably finish inside
// one 300s function call, so each request processes a budget of whole related-
// groups starting at group index `g` and returns `{ done, nextG, total, placed }`.
// The client (onboard.html) loops calls until `done`, showing a progress bar.
//
// Generations are tagged actor_role='onboarding_seed' so they don't burn the
// parent's monthly quota. Rendered on the cheap Flash tier (renderTaxonomyTile's
// default) — the Pro-generated keystones lock the style and ride along as refs.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { ensureProgress, setStep } from '../_lib/onboarding.js';
import { loadStyleGuide, loadChildAnchor, renderTaxonomyTile,
         loadChildVoiceId, synthesizeVoice, isDefaultableTile } from '../_lib/onboarding-render.js';
import { planGenerationGroups, runGroups } from '../_lib/batch-generate.js';

export const config = { maxDuration: 300 };

// Tiles processed per request (whole related-groups are packed until this many
// tiles are covered). Keeps each call well inside the 300s ceiling at Flash speed.
const TILE_BUDGET = 12;

// The curated starter is bounded to the most foundational N tiles. `core`
// defaults TRUE for every row, so a hard cap (not the flag alone) is what keeps
// the starter board at the intended ~80-150 size and the cost/time predictable;
// the parent grows the rest by snapping household photos.
const CURATED_LIMIT = 150;

// Ensure the board has the category (and subcategory) chip a tile belongs in,
// creating missing ones. A fresh board has NO chips, and the kid board only
// renders items INSIDE a category — items with category_id NULL are invisible
// in People/Nouns/Verbs — so without this every seeded tile silently vanished.
// `cache` memoizes per request ("section|cat|sub" → category id).
async function ensureCategory(db, childId, cache, section, category, subcategory) {
  const cat = String(category || '').trim();
  if (!cat) return null;
  const sub = String(subcategory || '').trim();
  const key = `${section}|${cat.toLowerCase()}|${sub.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);

  const topKey = `${section}|${cat.toLowerCase()}|`;
  let topId = cache.get(topKey);
  if (!topId) {
    const ex = await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section}
                        AND parent_id IS NULL AND lower(label) = lower(${cat}) LIMIT 1`;
    if (ex.length) topId = ex[0].id;
    else {
      const ins = await db`INSERT INTO categories (section, label, parent_id, display_order, child_id, updated_at)
                           VALUES (${section}, ${cat}, NULL, ${Date.now()}, ${childId}, NOW()) RETURNING id`;
      topId = ins[0].id;
    }
    cache.set(topKey, topId);
  }
  let outId = topId;
  if (sub) {
    const sx = await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section}
                        AND parent_id = ${topId} AND lower(label) = lower(${sub}) LIMIT 1`;
    if (sx.length) outId = sx[0].id;
    else {
      const ins = await db`INSERT INTO categories (section, label, parent_id, display_order, child_id, updated_at)
                           VALUES (${section}, ${sub}, ${topId}, ${Date.now()}, ${childId}, NOW()) RETURNING id`;
      outId = ins[0].id;
    }
  }
  cache.set(key, outId);
  return outId;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  try {
    const db = sql();
    const p = await ensureProgress(db, auth.user);
    const childId = p.child_id;
    const startG = Math.max(0, parseInt((req.query && req.query.g) || '0', 10) || 0);

    // Style: explicit param wins, else what was stashed earlier in the flow
    // (the approved keystone-derived anchor), else the first active guide.
    const fromQuery = req.query && req.query.styleGuideId ? parseInt(req.query.styleGuideId, 10) : null;
    const fromData = p.data && p.data.styleGuideId ? Number(p.data.styleGuideId) : null;
    const styleGuideId = fromQuery || fromData || null;

    const [styleGuide, settingsRows, childAnchor, childVoiceId] = await Promise.all([
      loadStyleGuide(db, styleGuideId),
      db`SELECT master_prompt, size_default FROM lab_settings WHERE id = 1`,
      loadChildAnchor(db, childId),
      loadChildVoiceId(db, childId),
    ]);
    const settings = settingsRows[0] || { master_prompt: '', size_default: '1024x1024' };

    // The curated starter set: baseline core vocabulary, Core-category first then
    // earliest-acquired words, capped at CURATED_LIMIT. Fully deterministic order
    // (ending in id) so the group indexing is stable across the chunked calls.
    // NB: no status filter — the library is authored in 'draft' and the editorial
    // publish flag shouldn't gate a family's starter board (it used to, and every
    // new board seeded ZERO tiles because nothing was ever flipped to published).
    const tiles = await db`
      SELECT id, id AS slug, column_name, category, subcategory, label, prompt_template, subject_mode, related_images, default_image_key
      FROM taxonomy
      WHERE core = TRUE
        AND COALESCE(archived, FALSE) = FALSE
        AND COALESCE(is_event, FALSE) = FALSE
        AND COALESCE(is_gestalt, FALSE) = FALSE
      ORDER BY (category = 'Core') DESC,
               CASE acquisition_age
                 WHEN '12-18m' THEN 0 WHEN '18-30m' THEN 1 WHEN '2-3y' THEN 2
                 WHEN '3-4y' THEN 3 ELSE 4 END,
               column_name, category NULLS LAST, label, id
      LIMIT ${CURATED_LIMIT}`;

    const total = tiles.length;
    const byId = new Map(tiles.map((t) => [t.id, t]));
    const allGroups = planGenerationGroups(tiles);
    const catCache = new Map();   // per-request category-chip memo for ensureCategory

    // Pack whole groups for THIS call until we've covered ~TILE_BUDGET tiles.
    const slice = [];
    let g = startG, count = 0;
    while (g < allGroups.length && (count < TILE_BUDGET || slice.length === 0)) {
      slice.push(allGroups[g]);
      count += allGroups[g].length;
      g++;
      if (count >= TILE_BUDGET) break;
    }
    const nextG = g;
    const doneAll = nextG >= allGroups.length;

    const render = async (tax, { referenceImageKeys }) => {
      // Default-able tiles (they never reference a specific person) are NOT
      // generated per-child at all — they read straight from the generic board
      // (taxonomy.default_image_key) at sync time. We just create the item (linked
      // by taxonomy_slug) and voice it; the image resolves live, so a later edit on
      // the generic board updates this child too. Only personalized tiles (People,
      // {reference}, {parent_photo}) still generate below.
      const useDefault = isDefaultableTile(tax);

      let imageKey, promptForLog, costForLog;
      if (useDefault) {
        imageKey = tax.default_image_key || null;   // sync fills this from the generic board
        promptForLog = '(generic board default)';
        costForLog = 0;
      } else {
        const r = await renderTaxonomyTile({ tax, styleGuide, childAnchor, settings, referenceImageKeys });
        if (!r.ok) return { ok: false, error: r.detail || 'render failed' };
        const png = Buffer.from(r.b64, 'base64');
        imageKey = `onboarding/${childId}/core/${randomUUID()}.png`;
        await put(imageKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
        promptForLog = r.prompt;
        costForLog = r.costCents ?? 4;
      }

      // Voice the tile in the parent's chosen voice (best-effort — a TTS miss
      // leaves sound_key null and the board speaks it with the system voice).
      let soundKey = null;
      const mp3 = await synthesizeVoice({ text: tax.label, voiceId: childVoiceId });
      if (mp3) {
        soundKey = `onboarding/${childId}/voice/${randomUUID()}.mp3`;
        await put(soundKey, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
      }

      const section = String(tax.column_name || 'needs').toLowerCase();
      // Needs is the flat strip (no categories); every other section's tiles are
      // only visible INSIDE a category chip, so make sure it exists.
      const catId = section === 'needs' ? null
        : await ensureCategory(db, childId, catCache, section, tax.category, tax.subcategory);
      // Upsert by taxonomy_slug so re-running the step doesn't duplicate tiles.
      // COALESCE keeps a category the parent already moved the tile into.
      const existing = await db`SELECT id FROM items WHERE child_id = ${childId} AND taxonomy_slug = ${tax.slug} LIMIT 1`;
      if (existing.length) {
        // Default-able re-runs must never clobber an image the tile already has
        // (a personalized render or a parent's own photo) — the shared default
        // resolves at sync time anyway. Generated (personalized) tiles do replace.
        await db`UPDATE items SET label = ${tax.label},
                   image_key = CASE WHEN ${useDefault} THEN COALESCE(image_key, ${imageKey}) ELSE ${imageKey} END,
                   sound_key = COALESCE(${soundKey}, sound_key), section = ${section},
                   category_id = COALESCE(category_id, ${catId}),
                   needs_review = FALSE, updated_at = NOW() WHERE id = ${existing[0].id}`;
      } else {
        await db`INSERT INTO items
                   (section, category_id, label, image_key, sound_key, keep_aspect, display_order, pinned,
                    child_id, taxonomy_slug, needs_review, updated_at)
                 VALUES (${section}, ${catId}, ${tax.label}, ${imageKey}, ${soundKey}, FALSE, ${Date.now()}, FALSE,
                    ${childId}, ${tax.slug}, FALSE, NOW())`;
      }

      // Cost log, quota-exempt (actor_role='onboarding_seed').
      try {
        await db`INSERT INTO image_generations
                   (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
                 VALUES (${childId}, ${auth.user.email || null}, 'onboarding_seed', ${tax.label},
                    ${useDefault ? 'default' : (styleGuide ? styleGuide.label : 'default')}, ${promptForLog}, '1024x1024', ${costForLog})`;
      } catch (_) {}
      // blobKey threads into paired tiles as a reference for a consistent set.
      return { ok: true, blobKey: imageKey, slug: tax.slug, costCents: costForLog };
    };

    // Pre-create this slice's category chips SERIALLY before the concurrent
    // render pass — two parallel renders racing on the same brand-new category
    // would otherwise both INSERT it and the board would grow duplicate chips.
    for (const grp of slice) for (const id of grp) {
      const t = byId.get(id);
      if (!t) continue;
      const sec = String(t.column_name || 'needs').toLowerCase();
      if (sec !== 'needs') await ensureCategory(db, childId, catCache, sec, t.category, t.subcategory);
    }

    const resultMap = await runGroups({ groups: slice, byId, concurrency: 3, render });
    let placed = 0, failed = 0;
    for (const grp of slice) for (const id of grp) {
      const r = resultMap.get(id);
      if (r && r.ok) placed++; else failed++;
    }

    // Accumulate the running total across chunks; only mark complete on the last.
    const priorSeeded = Number((p.data && p.data.seededCount) || 0);
    const seededTotal = priorSeeded + placed;
    if (doneAll) {
      await setStep(db, Number(auth.user.uid), 'complete',
        { seededCount: seededTotal, seedStyleGuideId: styleGuide ? styleGuide.id : null });
    } else {
      // Persist the resume cursor so a parent who closes the tab mid-build picks
      // up where they left off instead of regenerating from the start.
      await setStep(db, Number(auth.user.uid), 'seed_core', { seededCount: seededTotal, seedNextG: nextG });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      done: doneAll,
      step: doneAll ? 'complete' : 'seed_core',
      nextG,
      total,
      placed,
      failed,
      seededCount: seededTotal,
      styleGuideId: styleGuide ? styleGuide.id : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'seed-core failed', detail: String(err.message || err) });
  }
}

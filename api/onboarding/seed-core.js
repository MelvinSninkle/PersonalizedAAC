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
         loadChildVoiceId, synthesizeVoice, isGenericTemplate } from '../_lib/onboarding-render.js';
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
    const tiles = await db`
      SELECT id, id AS slug, column_name, category, subcategory, label, prompt_template, subject_mode, related_images, default_image_key
      FROM taxonomy
      WHERE core = TRUE
        AND status = 'published'
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
      // Generic tiles (no {placeholder} → identical for every kid) reuse the one
      // pre-rendered default image if the admin seed-defaults job has populated it.
      // We point this child's item straight at that shared Blob key — no image
      // generation at all — but still record the cost row as $0 and, below, voice
      // the tile in the child's own voice. NULL default (never seeded) falls
      // through to normal per-child generation.
      const useDefault = isGenericTemplate(tax.prompt_template) && !!tax.default_image_key;

      let imageKey, promptForLog, costForLog;
      if (useDefault) {
        imageKey = tax.default_image_key;
        promptForLog = '(shared default image)';
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
      // Upsert by taxonomy_slug so re-running the step doesn't duplicate tiles.
      const existing = await db`SELECT id FROM items WHERE child_id = ${childId} AND taxonomy_slug = ${tax.slug} LIMIT 1`;
      if (existing.length) {
        await db`UPDATE items SET label = ${tax.label}, image_key = ${imageKey},
                   sound_key = COALESCE(${soundKey}, sound_key), section = ${section},
                   needs_review = FALSE, updated_at = NOW() WHERE id = ${existing[0].id}`;
      } else {
        await db`INSERT INTO items
                   (section, category_id, label, image_key, sound_key, keep_aspect, display_order, pinned,
                    child_id, taxonomy_slug, needs_review, updated_at)
                 VALUES (${section}, NULL, ${tax.label}, ${imageKey}, ${soundKey}, FALSE, ${Date.now()}, FALSE,
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

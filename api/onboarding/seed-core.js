// POST /api/onboarding/seed-core?styleGuideId=
//
// Final step: generate the child's Core 12-18m starter tiles for real. Pulls the
// taxonomy rows where category='Core' AND acquisition_age='12-18m' (~13 tiles),
// then renders each one the SAME way the admin Lab does (api/_lib/onboarding-
// render.js): the parent's chosen style-guide image as the art reference, plus
// the child's committed self-portrait as the subject anchor for any tile that
// depicts the child ({reference} / child_as_subject). Each rendered tile is
// uploaded and dropped on the board, linked back by taxonomy_slug.
//
// Generations are tagged actor_role='onboarding_seed' so they don't burn the
// parent's monthly quota (api/generate-image excludes that role). ~$0.52 at Nano
// Banana for the ~13-tile batch. Tiles render with limited concurrency so the
// whole batch finishes inside the function's 300s ceiling.
//
// Tiles get no recorded voice here — the board speaks them with the system voice
// until the parent records one. Returns the count actually placed on the board.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { ensureProgress, setStep, SEED_BAND, SEED_CATEGORY } from '../_lib/onboarding.js';
import { loadStyleGuide, loadChildAnchor, renderTaxonomyTile,
         loadChildVoiceId, synthesizeVoice } from '../_lib/onboarding-render.js';
import { planGenerationGroups, runGroups } from '../_lib/batch-generate.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  try {
    const db = sql();
    const p = await ensureProgress(db, auth.user);
    const childId = p.child_id;

    // Style: explicit param wins, else what was stashed earlier in the flow,
    // else the first active guide (loadStyleGuide handles the fallback).
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

    const tiles = await db`
      SELECT id, id AS slug, column_name, category, subcategory, label, prompt_template, subject_mode, related_images
      FROM taxonomy
      WHERE category = ${SEED_CATEGORY}
        AND acquisition_age = ${SEED_BAND}
        AND COALESCE(archived, FALSE) = FALSE
        AND COALESCE(is_event, FALSE) = FALSE
        AND status = 'published'
      ORDER BY label`;

    // Same dependency-ordered engine the admin Lab's bulk generate uses: paired
    // tiles (related_images) generate together with bounded concurrency, the
    // earlier image seeding the later, so the starter set fits inside maxDuration.
    const byId = new Map(tiles.map((t) => [t.id, t]));
    const groups = planGenerationGroups(tiles);
    const render = async (tax, { referenceImageKeys }) => {
      const r = await renderTaxonomyTile({ tax, styleGuide, childAnchor, settings, referenceImageKeys });
      if (!r.ok) return { ok: false, error: r.detail || 'render failed' };

      const png = Buffer.from(r.b64, 'base64');
      const imageKey = `onboarding/${childId}/core/${randomUUID()}.png`;
      await put(imageKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });

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
                    ${styleGuide ? styleGuide.label : 'default'}, ${r.prompt}, '1024x1024', ${r.costCents ?? 4})`;
      } catch (_) {}
      // blobKey threads into paired tiles as a reference for a consistent set.
      return { ok: true, blobKey: imageKey, slug: tax.slug, costCents: r.costCents };
    };

    const resultMap = await runGroups({ groups, byId, concurrency: 3, render });
    const placed = [];
    let failed = 0;
    for (const t of tiles) {
      const r = resultMap.get(t.id);
      if (r && r.ok) placed.push(r.slug); else failed++;
    }

    await setStep(db, Number(auth.user.uid), 'complete',
      { seededCount: placed.length, seedStyleGuideId: styleGuide ? styleGuide.id : null });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      step: 'complete',
      queuedCount: placed.length,
      placed: placed.length,
      failed,
      styleGuideId: styleGuide ? styleGuide.id : null,
      slugs: placed,
      message: `Placed ${placed.length} starter tiles for ${childId}${failed ? ` (${failed} need a retry)` : ''}.`,
    });
  } catch (err) {
    res.status(500).json({ error: 'seed-core failed', detail: String(err.message || err) });
  }
}

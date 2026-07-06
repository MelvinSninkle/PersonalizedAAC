// The onboarding board-build pipeline, in three server-side moves:
//
//   1. PLACE (instant, no generation): every in-scope taxonomy word lands on the
//      board as an item + its category chips. image_key stays NULL — /api/sync
//      resolves default-able tiles to the shared generic image live, and tiles
//      with no image render as word-tiles until their custom art arrives.
//   2. RENDER (durable background jobs): core/needs words + ALL verbs are
//      re-generated per child — the child's style guide + likeness anchor — and
//      the item flips from default/word-tile to its personalized art as each
//      lands. Queued in seed_jobs, drained by /api/cron/run-tile-jobs every
//      minute, so the build finishes even if the parent closes everything.
//   3. VOICE (durable background jobs): every other placed tile gets the child's
//      chosen TTS voice (render jobs voice their own tile as part of the render).
//
// The queue survives crashes the same way tile_jobs does: queued → processing →
// done | failed, stale processing rows are reclaimed, failures retry up to
// MAX_SEED_ATTEMPTS. A special 'place' job lets the cron run step 1 itself when
// onboarding's scene-keystone commit enqueues the build server-side.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { loadStyleGuide, loadChildAnchor, loadChildStyleGuideId, renderTaxonomyTile,
         loadChildVoiceId, synthesizeVoice, isDefaultableTile } from './onboarding-render.js';
import { archivePriorImage } from './image-history.js';

export const MAX_SEED_ATTEMPTS = 3;

export async function ensureSeedJobs(db) {
  await db`
    CREATE TABLE IF NOT EXISTS seed_jobs (
      id BIGSERIAL PRIMARY KEY,
      child_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      taxonomy_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INT NOT NULL DEFAULT 0,
      image_key TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS seed_jobs_uidx
           ON seed_jobs(child_id, kind, COALESCE(taxonomy_id, ''))`;
  await db`CREATE INDEX IF NOT EXISTS seed_jobs_status_idx ON seed_jobs(status, updated_at)`;
  await db`CREATE INDEX IF NOT EXISTS seed_jobs_child_idx  ON seed_jobs(child_id, kind, status)`;
  // force = re-render even when the tile already has custom art (store retries
  // and whole-board rebuilds). The prior image is archived first — a family's
  // images are theirs to keep, so a replacement never deletes anything.
  await db`ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS force BOOLEAN NOT NULL DEFAULT FALSE`;
  // ref_key: an extra reference image attached to the render — the "you added a
  // fork, remake the pictures that mention a fork WITH your fork" flow.
  await db`ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS ref_key TEXT`;
  // guidance: parent's correction text on a guided retry. When set, ref_key is
  // treated as the PREVIOUS attempt (improve-this) rather than a related tile.
  await db`ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS guidance TEXT`;
  // Per-image styled tracking (§9): WHICH style guide an item's art was
  // rendered under, so batch "match my style" ops can skip already-styled
  // tiles (never double-charge) and treat a STYLE CHANGE as re-eligible.
  await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS styled_style_id INT`;
  await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS styled_at TIMESTAMPTZ`;
}

/**
 * Does this item still need styling under the child's CURRENT guide?
 *  - no art / default art            → yes
 *  - custom art, styled_style_id NULL → no (grandfathered: personalized before
 *    tracking existed — never re-charge those)
 *  - custom art under another guide  → yes (style changed → stale)
 */
export function needsStyling(item, currentGuideId) {
  const key = String(item.image_key || '');
  if (!key || key.startsWith('taxonomy-defaults/')) return true;
  if (item.styled_style_id == null) return false;
  const cur = currentGuideId == null ? null : Number(currentGuideId);
  return Number(item.styled_style_id) !== cur;
}

// Queue (or re-arm) one CHIP job (§6): a folder icon rendered in the child's
// own style. Identity rides taxonomy_id as "chip:section|label|parentLabel"
// so the (child, kind, taxonomy_id) unique index dedupes naturally.
export async function enqueueChipJob(db, childId, section, label, parentLabel = '') {
  const key = `chip:${section}|${label}|${parentLabel || ''}`;
  await db`INSERT INTO seed_jobs (child_id, kind, taxonomy_id, force)
           VALUES (${childId}, 'chip', ${key}, TRUE)
           ON CONFLICT (child_id, kind, COALESCE(taxonomy_id, ''))
           DO UPDATE SET status = 'queued', attempts = 0, error = NULL, updated_at = NOW()`;
}

// Queue (or re-arm) one render job. Store checkout, retries, and rebuilds all
// funnel through here — ON CONFLICT resets a finished/failed job back to queued.
export async function enqueueRenderJob(db, childId, taxonomyId, { force = false, refKey = null, guidance = null } = {}) {
  await db`INSERT INTO seed_jobs (child_id, kind, taxonomy_id, force, ref_key, guidance)
           VALUES (${childId}, 'render', ${taxonomyId}, ${force}, ${refKey}, ${guidance})
           ON CONFLICT (child_id, kind, COALESCE(taxonomy_id, ''))
           DO UPDATE SET status = 'queued', attempts = 0, error = NULL,
                         force = ${force}, ref_key = ${refKey}, guidance = ${guidance}, updated_at = NOW()`;
}

// ── Scope ────────────────────────────────────────────────────────────────────

// Personal-render scope: which placed words get re-generated per child.
// Decision: the Needs strip + the Core category + EVERY verb.
export function isRenderScope(t) {
  const col = String(t.column_name || '').toLowerCase();
  return col === 'needs' || col === 'verbs' || String(t.category || '').toLowerCase() === 'core';
}

// Everything a fresh board receives. Default-able words always place (the shared
// default — or a word-tile until one exists). Person-referencing words place only
// when they're in the render scope, so nothing sits as a permanent word-tile.
export async function placementRows(db) {
  const rows = await db`
    SELECT id, id AS slug, column_name, category, subcategory, label, prompt_template,
           subject_mode, related_images, default_image_key
    FROM taxonomy
    WHERE COALESCE(archived, FALSE) = FALSE
      AND COALESCE(is_event, FALSE) = FALSE
      AND COALESCE(is_gestalt, FALSE) = FALSE
      AND COALESCE(authoring_kind, 'canonical') = 'canonical'
      AND COALESCE(audience, 'universal') = 'universal'
    ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST, label, id`;
  return rows.filter((t) => isDefaultableTile(t) || isRenderScope(t));
}

// ── Categories (same rules as the board editor: items are only visible inside
//    a chip, so chips must exist; Needs is the flat strip) ───────────────────

export async function ensureCategory(db, childId, cache, section, category, subcategory) {
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

// ── 1. PLACE ─────────────────────────────────────────────────────────────────

// Place one chunk of `rows` (ordered; caller slices by offset). No image
// generation, no TTS — just categories + items, so a full board places in
// seconds. Upsert by taxonomy_slug; re-runs never move a tile a parent
// re-organized (COALESCE on category) and never touch an existing image.
export async function placeChunk({ db, childId, rows, catCache }) {
  let placed = 0, failed = 0;
  const base = Date.now();
  for (let idx = 0; idx < rows.length; idx++) {
    const tax = rows[idx];
    try {
      const section = String(tax.column_name || 'needs').toLowerCase();
      const catId = section === 'needs' ? null
        : await ensureCategory(db, childId, catCache, section, tax.category, tax.subcategory);
      const existing = await db`SELECT id FROM items WHERE child_id = ${childId} AND taxonomy_slug = ${tax.id} LIMIT 1`;
      if (existing.length) {
        await db`UPDATE items SET label = ${tax.label}, section = ${section},
                   category_id = COALESCE(category_id, ${catId}),
                   needs_review = FALSE, updated_at = NOW() WHERE id = ${existing[0].id}`;
      } else {
        await db`INSERT INTO items
                   (section, category_id, label, image_key, sound_key, keep_aspect, display_order, pinned,
                    child_id, taxonomy_slug, needs_review, updated_at)
                 VALUES (${section}, ${catId}, ${tax.label}, NULL, NULL, FALSE, ${base + idx}, FALSE,
                    ${childId}, ${tax.id}, FALSE, NOW())`;
      }
      placed++;
    } catch (err) {
      failed++;
      console.error('placeChunk item failed:', tax.id, String(err.message || err));
    }
  }
  return { placed, failed };
}

// ── 2+3. Enqueue the background jobs ────────────────────────────────────────

export async function enqueueSeedJobs(db, childId, rows) {
  // FREE TIER: the free experience is the two onboarding portraits + the
  // shared default board (sync overlays taxonomy.default_image_key onto any
  // tile without custom art). Personal in-your-style renders of the seed scope
  // are a membership perk — without one, every seed job is voice-only. Bought
  // words / retries still render for anyone: those are paid with credits.
  let personalRenders = true;
  let ownerTier = 'unknown';
  try {
    const { entitlementFor, boardOwnerId } = await import('./credits.js');
    const ownerId = await boardOwnerId(db, childId);
    const ent = await entitlementFor(db, ownerId);
    personalRenders = !!ent.sub || ent.tier === 'admin';
    ownerTier = ent.label || ent.tier || 'unknown';
  } catch (_) { /* on any doubt keep the historical behavior */ }

  let renders = 0, voices = 0;
  for (const t of rows) {
    const kind = (personalRenders && isRenderScope(t)) ? 'render' : 'voice';
    try {
      const r = await db`INSERT INTO seed_jobs (child_id, kind, taxonomy_id)
                         VALUES (${childId}, ${kind}, ${t.id})
                         ON CONFLICT (child_id, kind, COALESCE(taxonomy_id, '')) DO NOTHING
                         RETURNING id`;
      if (r.length) { if (kind === 'render') renders++; else voices++; }
    } catch (_) { /* best-effort; the rescue tool can re-enqueue */ }
  }
  // Surface the WHY so admin tooling can distinguish "renders queued" from
  // "renders skipped — free tier" instead of a silent voice-only downgrade.
  return { renders, voices, personalRenders, ownerTier };
}

// Run the whole build for a child in one call (used by the cron 'place' job and
// the admin rescue): place everything, then enqueue the jobs.
export async function buildBoard(db, childId) {
  const rows = await placementRows(db);
  const catCache = new Map();
  const { placed, failed } = await placeChunk({ db, childId, rows, catCache });
  const q = await enqueueSeedJobs(db, childId, rows);
  return { total: rows.length, placed, failed, ...q };
}

// ── Queue plumbing (mirrors tile_jobs semantics) ────────────────────────────

export async function claimSeedJobs(db, kind, limit) {
  return db`
    UPDATE seed_jobs SET status = 'processing', updated_at = NOW()
    WHERE id IN (
      SELECT id FROM seed_jobs
      WHERE kind = ${kind} AND (
        status = 'queued'
        OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes')
        OR (status = 'failed' AND attempts < ${MAX_SEED_ATTEMPTS})
      )
      ORDER BY id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, child_id, kind, taxonomy_id, attempts, force, ref_key, guidance`;
}

async function jobDone(db, id, patch = {}) {
  await db`UPDATE seed_jobs SET status = 'done', image_key = ${patch.imageKey || null},
             error = NULL, updated_at = NOW() WHERE id = ${id}`;
}
async function jobFailed(db, id, err) {
  await db`UPDATE seed_jobs SET status = 'failed', attempts = attempts + 1,
             error = ${String(err && (err.message || err)).slice(0, 500)}, updated_at = NOW() WHERE id = ${id}`;
}

// Per-child context (style guide, anchor, settings, voice) cached across the
// jobs of one drain pass so 20 renders don't re-read the same blobs 20 times.
export function makeSeedContext(db) {
  const cache = new Map();
  return async function ctx(childId) {
    if (cache.has(childId)) return cache.get(childId);
    const [styleGuideId, settingsRows, childAnchor, voiceId, ownerRows] = await Promise.all([
      loadChildStyleGuideId(db, childId),
      db`SELECT master_prompt, size_default FROM lab_settings WHERE id = 1`,
      loadChildAnchor(db, childId),
      loadChildVoiceId(db, childId),
      // Cron-run renders have no signed-in actor; attribute the spend to the
      // board's parent account so the usage report never shows "(token)".
      db`SELECT email FROM users WHERE child_slug = ${childId} LIMIT 1`,
    ]);
    let styleGuide = null;
    try { styleGuide = await loadStyleGuide(db, styleGuideId); } catch (_) { styleGuide = null; }
    const out = {
      styleGuide, childAnchor, voiceId,
      ownerEmail: (ownerRows[0] && ownerRows[0].email) || null,
      settings: settingsRows[0] || { master_prompt: '', size_default: '1024x1024' },
    };
    cache.set(childId, out);
    return out;
  };
}

export async function processSeedJob(db, job, getCtx) {
  try {
    if (job.kind === 'place') {
      const r = await buildBoard(db, job.child_id);
      await jobDone(db, job.id);
      return { ok: true, ...r };
    }

    // §6: a folder icon rendered in the CHILD's own style guide (the ctx's
    // guide is the child's saved one). Identity: "chip:section|label|parent".
    if (job.kind === 'chip') {
      const raw = String(job.taxonomy_id || '').replace(/^chip:/, '');
      const [section, label, parentLabel] = raw.split('|');
      if (!section || !label) { await jobDone(db, job.id); return { ok: true, skipped: 'malformed chip key' }; }
      const c = await getCtx(job.child_id);
      const { generateCategoryIcon } = await import('./category-icons.js');
      const r = await generateCategoryIcon({
        db, childId: job.child_id, section, label, parentLabel: parentLabel || '',
        style: c.styleGuide, styleBuf: c.styleGuide && c.styleGuide.image ? c.styleGuide.image : undefined,
        actorEmail: c.ownerEmail, attributeChildId: job.child_id,
      });
      if (!r.ok) throw new Error(r.error || 'chip render failed');
      await jobDone(db, job.id, { imageKey: r.imageKey });
      return { ok: true, imageKey: r.imageKey };
    }

    const tax = (await db`SELECT id, id AS slug, column_name, category, subcategory, label,
                                 prompt_template, subject_mode, related_images, default_image_key
                          FROM taxonomy WHERE id = ${job.taxonomy_id} LIMIT 1`)[0];
    if (!tax) { await jobDone(db, job.id); return { ok: true, skipped: 'taxonomy row gone' }; }
    const item = (await db`SELECT id, image_key, sound_key, label, section FROM items
                           WHERE child_id = ${job.child_id} AND taxonomy_slug = ${job.taxonomy_id} LIMIT 1`)[0];
    if (!item) { await jobDone(db, job.id); return { ok: true, skipped: 'item gone' }; }
    const c = await getCtx(job.child_id);

    if (job.kind === 'render') {
      // Skip if a parent already personalized this tile themselves — UNLESS this
      // is a forced job (paid retry / whole-board rebuild), which replaces on
      // purpose. A replaced image is archived first, never deleted: the family
      // keeps every image they've made.
      const cur = item.image_key || '';
      const isDefaultKey = cur.startsWith('taxonomy-defaults/');
      const replaceable = job.force || !cur || isDefaultKey;
      let imageKey = null;
      if (replaceable) {
        // Guided retry (guidance set): ref_key is the PREVIOUS attempt to
        // improve. Otherwise it's a related-tile composition reference.
        const isGuidedRetry = !!job.guidance;
        const r = await renderTaxonomyTile({ tax, styleGuide: c.styleGuide, childAnchor: c.childAnchor, settings: c.settings,
                                             referenceImageKeys: (!isGuidedRetry && job.ref_key) ? [job.ref_key] : [],
                                             guidance: job.guidance || '',
                                             priorKey: isGuidedRetry ? job.ref_key : null });
        if (!r.ok) throw new Error(r.detail || 'render failed');
        const png = Buffer.from(r.b64, 'base64');
        imageKey = `onboarding/${job.child_id}/core/${randomUUID()}.png`;
        await put(imageKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
        if (cur && !isDefaultKey) {
          try {
            await archivePriorImage({ db, childId: job.child_id, itemId: item.id, oldKey: cur,
                                      label: item.label, section: item.section, source: 'seed-render', who: null });
          } catch (_) { /* archive is best-effort; the render still lands */ }
        }
        // Stamp WHICH guide painted it (styled_style_id) so batch style-match
        // ops can skip it — and notice when the child's style later changes.
        const guideId = c.styleGuide && c.styleGuide.id ? Number(c.styleGuide.id) : null;
        if (job.force) {
          await db`UPDATE items SET image_key = ${imageKey}, styled_style_id = ${guideId},
                   styled_at = NOW(), updated_at = NOW() WHERE id = ${item.id}`;
        } else {
          await db`UPDATE items SET image_key = ${imageKey}, styled_style_id = ${guideId},
                   styled_at = NOW(), updated_at = NOW()
                   WHERE id = ${item.id} AND (image_key IS NULL OR image_key LIKE 'taxonomy-defaults/%')`;
        }
        try {
          await db`INSERT INTO image_generations
                     (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
                   VALUES (${job.child_id}, ${c.ownerEmail}, 'onboarding_seed', ${tax.label},
                      ${c.styleGuide ? c.styleGuide.label : 'default'}, ${r.prompt}, '1024x1024', ${r.costCents ?? 4})`;
        } catch (_) {}
      }
      if (!item.sound_key) {
        const mp3 = await synthesizeVoice({ text: tax.label, voiceId: c.voiceId, db, childId: job.child_id, kind: 'seed' });
        if (mp3) {
          const soundKey = `onboarding/${job.child_id}/voice/${randomUUID()}.mp3`;
          await put(soundKey, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
          await db`UPDATE items SET sound_key = ${soundKey}, updated_at = NOW()
                   WHERE id = ${item.id} AND sound_key IS NULL`;
        }
      }
      await jobDone(db, job.id, { imageKey });
      return { ok: true, imageKey };
    }

    if (job.kind === 'voice') {
      if (!item.sound_key) {
        const mp3 = await synthesizeVoice({ text: tax.label, voiceId: c.voiceId, db, childId: job.child_id, kind: 'seed' });
        if (mp3) {
          const soundKey = `onboarding/${job.child_id}/voice/${randomUUID()}.mp3`;
          await put(soundKey, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
          await db`UPDATE items SET sound_key = ${soundKey}, updated_at = NOW()
                   WHERE id = ${item.id} AND sound_key IS NULL`;
        }
      }
      await jobDone(db, job.id);
      return { ok: true };
    }

    await jobFailed(db, job.id, new Error('unknown kind ' + job.kind));
    return { ok: false };
  } catch (err) {
    await jobFailed(db, job.id, err);
    return { ok: false, detail: String(err.message || err) };
  }
}

// ── Progress (for the board banner + parent dashboard) ──────────────────────

export async function seedStatus(db, childId) {
  // "dead" = failed with no retries left; those must not keep the banner
  // spinning forever. The rescue tool re-arms them.
  const rows = await db`
    SELECT kind, status,
           COUNT(*) FILTER (WHERE NOT (status = 'failed' AND attempts >= ${MAX_SEED_ATTEMPTS}))::int AS live,
           COUNT(*) FILTER (WHERE status = 'failed' AND attempts >= ${MAX_SEED_ATTEMPTS})::int AS dead
    FROM seed_jobs WHERE child_id = ${childId} GROUP BY kind, status`;
  const agg = { render: { total: 0, done: 0, dead: 0 }, voice: { total: 0, done: 0, dead: 0 },
                place: { total: 0, done: 0, dead: 0 }, chip: { total: 0, done: 0, dead: 0 } };
  for (const r of rows) {
    const k = agg[r.kind]; if (!k) continue;
    k.total += r.live + r.dead;
    k.dead += r.dead;
    if (r.status === 'done') k.done += r.live;
  }
  const remaining = (k) => Math.max(0, k.total - k.done - k.dead);
  const active = remaining(agg.place) + remaining(agg.render) + remaining(agg.voice) + remaining(agg.chip) > 0;
  return { active, ...agg };
}

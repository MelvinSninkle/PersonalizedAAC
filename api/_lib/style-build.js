// Per-style DEFAULT-BOARD build machinery, shared by:
//   - api/admin/_lab-style-defaults.js  (the defaults.html gallery: GET +
//     spot regen + the legacy browser-driven chunk loop)
//   - api/admin/_lab-style-wizard.js    (the one-button New Style wizard)
//   - api/cron/run-tile-jobs.js         (drains style_build_jobs every minute
//     so a full-taxonomy render survives the admin closing the tab)
//
// A style's default set = one image per placeable taxonomy row
// (taxonomy_style_defaults) + one icon per category/subcategory chip
// (category_style_defaults). Person-y tiles render with the style's PERSON
// reference (a generic child drawn in the style — style_guides.person_ref_key)
// standing in for the real child; the STUFF reference rides along as a world
// reference. /api/sync (and now /api/demo) resolve against these tables.
//
// Rendering here never charges credits (admin/lab work) but always logs to
// image_generations (actor_role 'lab_style_default') so spend stays visible.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { readBlobBytes, renderTaxonomyTile, mapPool } from './onboarding-render.js';
import { buildIconPrompt, iconFor } from './category-icons.js';
import { geminiKey, geminiDefaultModel, geminiGenerateImage, geminiCostCents } from './gemini.js';

export const norm = (s) => String(s || '').trim().toLowerCase();

export async function ensureStyleDefaultTables(db) {
  await db`ALTER TABLE style_guides ADD COLUMN IF NOT EXISTS person_ref_key TEXT`;
  await db`ALTER TABLE style_guides ADD COLUMN IF NOT EXISTS stuff_ref_key TEXT`;
  await db`
    CREATE TABLE IF NOT EXISTS taxonomy_style_defaults (
      taxonomy_id TEXT NOT NULL, style_guide_id BIGINT NOT NULL,
      image_key TEXT, status TEXT NOT NULL DEFAULT 'queued', error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (taxonomy_id, style_guide_id)
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS category_style_defaults (
      style_guide_id BIGINT NOT NULL, section TEXT NOT NULL,
      label_norm TEXT NOT NULL, parent_norm TEXT NOT NULL DEFAULT '',
      image_key TEXT, status TEXT NOT NULL DEFAULT 'queued', error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (style_guide_id, section, label_norm, parent_norm)
    )`;
  // Demo children: extra "demo kids" per style for the PUBLIC practice
  // board's kid switcher. demo_child_id 0 = the style's primary kid
  // (style_guides.person_ref_key). Only PERSON-SCOPE tiles vary per kid
  // (~29% of rows); object tiles + folder chips stay the shared kid-0 set.
  // Family boards read ONLY demo_child_id = 0 (pinned in api/sync.js — E9).
  await db`
    CREATE TABLE IF NOT EXISTS style_demo_children (
      id BIGSERIAL PRIMARY KEY,
      style_guide_id BIGINT NOT NULL,
      label TEXT NOT NULL,
      person_ref_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`ALTER TABLE taxonomy_style_defaults ADD COLUMN IF NOT EXISTS demo_child_id INT NOT NULL DEFAULT 0`;
  // Widen the PK to include demo_child_id (once — checked, not churned).
  try {
    const pk = await db`SELECT array_length(conkey, 1) AS n FROM pg_constraint
                        WHERE conrelid = 'taxonomy_style_defaults'::regclass AND contype = 'p'`;
    if ((Number(pk[0]?.n) || 0) < 3) {
      await db`ALTER TABLE taxonomy_style_defaults DROP CONSTRAINT taxonomy_style_defaults_pkey`;
      await db`ALTER TABLE taxonomy_style_defaults ADD PRIMARY KEY (taxonomy_id, style_guide_id, demo_child_id)`;
    }
  } catch (_) { /* pre-migration DB or concurrent ensure — next call settles it */ }
}

/// PERSON-SCOPE ⇔ the tile draws the child, so it varies per demo kid.
/// Mirrors renderTaxonomyTile's usePerson (onboarding-render.js) exactly.
export function isPersonScopeRow(t) {
  return String(t.column_name || '').toLowerCase() === 'people'
    || /\{reference\}/i.test(String(t.prompt_template || ''))
    || t.subject_mode === 'child_as_subject';
}

/// The anchor image for a build: kid 0 = the style's own person ref;
/// otherwise the style_demo_children row's ref.
export async function demoChildAnchor(db, style, demoChildId) {
  if (!demoChildId) return personAnchor(style);
  const row = (await db`SELECT person_ref_key FROM style_demo_children
                        WHERE id = ${demoChildId} AND style_guide_id = ${style.id} LIMIT 1`)[0];
  if (!row || !row.person_ref_key) return null;
  try {
    const bytes = await readBlobBytes(row.person_ref_key);
    return { ...bytes, key: row.person_ref_key, name: 'the child' };
  } catch (_) { return null; }
}

// The style row WITHOUT the active filter (a style being prepped before it's
// offered is the main use case) — but always a GLOBAL one, never a parent's
// child-scoped upload (those keep the generic default board by design).
export async function loadStyle(db, id) {
  const row = (await db`SELECT id, label, description, blob_key, person_ref_key, stuff_ref_key
                        FROM style_guides WHERE id = ${id} AND child_id IS NULL LIMIT 1`)[0];
  if (!row) return null;
  let image = null;
  if (row.blob_key) { try { image = await readBlobBytes(row.blob_key); } catch (_) {} }
  return { id: Number(row.id), label: row.label, description: row.description || '',
           blob_key: row.blob_key, person_ref_key: row.person_ref_key || null,
           stuff_ref_key: row.stuff_ref_key || null, image };
}

// Everything a default board places — the same WHERE as seed-board's
// placementRows, WITHOUT the defaultable/render-scope JS filter: the per-style
// set covers person-y tiles too (rendered with the style's person reference).
export async function placeableRows(db) {
  return db`
    SELECT id, id AS slug, column_name, category, subcategory, label, prompt_template,
           subject_mode, related_images, default_image_key
    FROM taxonomy
    WHERE COALESCE(archived, FALSE) = FALSE
      AND COALESCE(is_event, FALSE) = FALSE
      AND COALESCE(is_gestalt, FALSE) = FALSE
      AND COALESCE(authoring_kind, 'canonical') = 'canonical'
      AND COALESCE(audience, 'universal') = 'universal'
    ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST, label, id`;
}

// Distinct chips (top-level + sub) from the taxonomy hierarchy. Needs is the
// flat strip — no chips.
export async function chipRows(db) {
  const rows = await db`
    SELECT DISTINCT lower(column_name) AS section, category, subcategory
    FROM taxonomy
    WHERE COALESCE(archived, FALSE) = FALSE
      AND COALESCE(is_event, FALSE) = FALSE
      AND COALESCE(is_gestalt, FALSE) = FALSE
      AND COALESCE(authoring_kind, 'canonical') = 'canonical'
      AND COALESCE(audience, 'universal') = 'universal'
      AND lower(column_name) <> 'needs'
      AND COALESCE(category, '') <> ''`;
  const seen = new Map();
  for (const r of rows) {
    const top = `${r.section}|${norm(r.category)}|`;
    if (!seen.has(top)) seen.set(top, { section: r.section, label: String(r.category).trim(), parent: '' });
    if (r.subcategory && String(r.subcategory).trim()) {
      const sub = `${r.section}|${norm(r.subcategory)}|${norm(r.category)}`;
      if (!seen.has(sub)) seen.set(sub, { section: r.section, label: String(r.subcategory).trim(), parent: String(r.category).trim() });
    }
  }
  return [...seen.values()];
}

export async function labSettings(db) {
  try {
    const r = await db`SELECT master_prompt, size_default FROM lab_settings WHERE id = 1`;
    return r[0] || { master_prompt: '', size_default: '1024x1024' };
  } catch (_) { return { master_prompt: '', size_default: '1024x1024' }; }
}

export async function personAnchor(style) {
  if (!style || !style.person_ref_key) return null;
  try {
    const bytes = await readBlobBytes(style.person_ref_key);
    return { ...bytes, key: style.person_ref_key, name: 'the child' };
  } catch (_) { return null; }
}

export async function renderOneTile({ db, style, tax, settings, anchor, demoChildId = 0 }) {
  // An EXTRA demo kid's render is owned by THAT child, exactly like a family
  // render — so it gets the same C4 guard (familyRender): the style's person
  // exemplar (a picture of the MAIN demo kid) never attaches, and the subject
  // legend hardens to "this is THE subject — match this person's established
  // look". Without this, every kid tile carried TWO children (the kid's ref
  // + the exemplar) and the model kept drawing the exemplar — Emily came out
  // looking like Bobby. Kid 0 keeps the exemplar: there the sample child IS
  // the subject.
  const r = await renderTaxonomyTile({
    tax, styleGuide: style, childAnchor: anchor, settings,
    familyRender: Number(demoChildId) !== 0,
    worldRefKeys: style.stuff_ref_key ? [style.stuff_ref_key] : [],
  });
  if (!r.ok) throw new Error(r.detail || 'render failed');
  const png = Buffer.from(r.b64, 'base64');
  const imageKey = `style-defaults/${style.id}/${tax.id}/${randomUUID()}.png`;
  await put(imageKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
  await db`INSERT INTO taxonomy_style_defaults (taxonomy_id, style_guide_id, demo_child_id, image_key, status, error, updated_at)
           VALUES (${tax.id}, ${style.id}, ${Number(demoChildId) || 0}, ${imageKey}, 'done', NULL, NOW())
           ON CONFLICT (taxonomy_id, style_guide_id, demo_child_id)
           DO UPDATE SET image_key = ${imageKey}, status = 'done', error = NULL, updated_at = NOW()`;
  try {
    await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
             VALUES ('__lab__', NULL, 'lab_style_default', ${tax.label},
                     ${'style-default guide#' + style.id + ' ' + (style.label || '')}, ${r.prompt}, '1024x1024', ${r.costCents ?? 4})`;
  } catch (_) {}
  return imageKey;
}

// A chip for a category with NO curated icon description (a new taxonomy
// category the CATEGORY_ICONS maps don't know) composes itself from three of
// the style's own finished tiles instead of prompting blind: free (no model
// call), always on-style, and always representative of what's actually inside
// the folder. Falls through to the prompt path when the category has no
// rendered tiles yet (the drain re-runs the chip after tiles land — chip jobs
// requeue on failure, and 🚀 Generate gap-fills ON CONFLICT DO NOTHING).
async function composeChipFromTiles({ db, style, chip }) {
  const done = chip.parent
    ? await db`SELECT d.image_key FROM taxonomy t
               JOIN taxonomy_style_defaults d ON d.taxonomy_id = t.id
               WHERE d.style_guide_id = ${style.id} AND d.demo_child_id = 0 AND d.image_key IS NOT NULL
                 AND COALESCE(t.archived, FALSE) = FALSE
                 AND lower(t.column_name) = ${chip.section}
                 AND lower(TRIM(t.subcategory)) = ${norm(chip.label)}
                 AND lower(TRIM(t.category)) = ${norm(chip.parent)}
               ORDER BY t.label, t.id LIMIT 3`
    : await db`SELECT d.image_key FROM taxonomy t
               JOIN taxonomy_style_defaults d ON d.taxonomy_id = t.id
               WHERE d.style_guide_id = ${style.id} AND d.demo_child_id = 0 AND d.image_key IS NOT NULL
                 AND COALESCE(t.archived, FALSE) = FALSE
                 AND lower(t.column_name) = ${chip.section}
                 AND lower(TRIM(t.category)) = ${norm(chip.label)}
               ORDER BY t.label, t.id LIMIT 3`;
  if (!done.length) return null;
  // Dynamic import, same as api/media.js: sharp must never gate — if it's
  // unavailable on this platform the chip falls through to the prompt path.
  let sharp;
  try { sharp = (await import('sharp')).default; } catch (_) { return null; }
  const parts = await Promise.all(done.map((r) => readBlobBytes(r.image_key)));
  const n = parts.length;
  const cell = n === 1 ? 1024 : 512;
  const bufs = await Promise.all(parts.map((p) =>
    sharp(p.buffer).resize(cell, cell, { fit: 'cover' }).png().toBuffer()));
  // 3 → two up top, one centered below; 2 → side by side; 1 → full frame.
  const layout = n >= 3
    ? [{ input: bufs[0], top: 0, left: 0 }, { input: bufs[1], top: 0, left: 512 }, { input: bufs[2], top: 512, left: 256 }]
    : n === 2
      ? [{ input: bufs[0], top: 256, left: 0 }, { input: bufs[1], top: 256, left: 512 }]
      : [{ input: bufs[0], top: 0, left: 0 }];
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3,
                                      background: { r: 255, g: 247, b: 251 } } })
    .composite(layout).png().toBuffer();
  const imageKey = `style-defaults/${style.id}/chips/${chip.section}/${randomUUID()}.png`;
  await put(imageKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
  await db`INSERT INTO category_style_defaults (style_guide_id, section, label_norm, parent_norm, image_key, status, error, updated_at)
           VALUES (${style.id}, ${chip.section}, ${norm(chip.label)}, ${norm(chip.parent)}, ${imageKey}, 'done', NULL, NOW())
           ON CONFLICT (style_guide_id, section, label_norm, parent_norm)
           DO UPDATE SET image_key = ${imageKey}, status = 'done', error = NULL, updated_at = NOW()`;
  try {
    await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
             VALUES ('__lab__', NULL, 'lab_style_default', ${'chip: ' + chip.label},
                     ${'style-default guide#' + style.id + ' ' + (style.label || '')},
                     ${'composite of ' + n + ' category tiles (no curated icon)'}, '1024x1024', 0)`;
  } catch (_) {}
  return imageKey;
}

export async function renderOneChip({ db, style, chip }) {
  // New categories (no curated CATEGORY_ICONS entry) prefer the tile
  // composite — see composeChipFromTiles. Curated chips render as before.
  const curated = chip.parent ? iconFor(chip.parent, chip.label) : iconFor(chip.label, null);
  if (!curated) {
    const composed = await composeChipFromTiles({ db, style, chip });
    if (composed) return composed;
  }
  const gKey = geminiKey();
  if (!gKey) throw new Error('GEMINI_API_KEY not configured');
  let prompt = buildIconPrompt({
    label: chip.label, parentLabel: chip.parent || '',
    hasStyle: !!(style.image && style.image.buffer),
    styleDescription: style.description || '',
  });
  const images = [];
  if (style.image && style.image.buffer) {
    images.push({ buffer: style.image.buffer, contentType: style.image.contentType });
    prompt += '\n\nThe attached image is the STYLE reference — copy its art style only, not its content.';
  }
  const g = await geminiGenerateImage({ apiKey: gKey, model: geminiDefaultModel(), prompt, images, aspectRatio: '1:1' });
  if (!g.ok) throw new Error(g.detail || 'chip render failed');
  const png = Buffer.from(g.b64, 'base64');
  const imageKey = `style-defaults/${style.id}/chips/${chip.section}/${randomUUID()}.png`;
  await put(imageKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
  await db`INSERT INTO category_style_defaults (style_guide_id, section, label_norm, parent_norm, image_key, status, error, updated_at)
           VALUES (${style.id}, ${chip.section}, ${norm(chip.label)}, ${norm(chip.parent)}, ${imageKey}, 'done', NULL, NOW())
           ON CONFLICT (style_guide_id, section, label_norm, parent_norm)
           DO UPDATE SET image_key = ${imageKey}, status = 'done', error = NULL, updated_at = NOW()`;
  try {
    await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
             VALUES ('__lab__', NULL, 'lab_style_default', ${'chip: ' + chip.label},
                     ${'style-default guide#' + style.id + ' ' + (style.label || '')}, ${prompt}, '1024x1024', ${g.costCents ?? geminiCostCents()})`;
  } catch (_) {}
  return imageKey;
}

// ── The durable build queue (style_build_jobs) ──────────────────────────────
// One row per (style, tile-or-chip). The wizard fans the whole taxonomy out;
// the every-minute cron drains a bounded chunk per tick — a full render
// finishes on its own even if the admin closes the tab mid-way.

export async function ensureStyleBuildJobs(db) {
  await db`
    CREATE TABLE IF NOT EXISTS style_build_jobs (
      id BIGSERIAL PRIMARY KEY,
      style_guide_id BIGINT NOT NULL,
      kind TEXT NOT NULL,               -- 'tile' | 'chip'
      taxonomy_id TEXT,                 -- tiles
      section TEXT, label TEXT, parent TEXT,   -- chips
      status TEXT NOT NULL DEFAULT 'queued',   -- queued | done | failed
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`ALTER TABLE style_build_jobs ADD COLUMN IF NOT EXISTS demo_child_id INT NOT NULL DEFAULT 0`;
  await db`CREATE INDEX IF NOT EXISTS style_build_jobs_pick ON style_build_jobs(status, id)`;
  await db`DROP INDEX IF EXISTS style_build_jobs_tile`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS style_build_jobs_tile_kid
           ON style_build_jobs(style_guide_id, taxonomy_id, demo_child_id) WHERE kind = 'tile'`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS style_build_jobs_chip
           ON style_build_jobs(style_guide_id, section, label, parent) WHERE kind = 'chip'`;
}

/// Fan out every missing tile + chip for a style. Already-rendered pieces are
/// skipped (gap-fill semantics — same as the gallery's non-force loop); a
/// failed/stale job re-queues. Returns { tiles, chips } queued counts.
///
/// demoChildId ≠ 0 = an EXTRA demo kid: only person-scope rows re-render
/// (object tiles + chips are shared with kid 0), so a kid costs ~344 tiles,
/// not the full board.
export async function enqueueStyleBuild(db, styleGuideId, { demoChildId = 0, force = false } = {}) {
  await ensureStyleDefaultTables(db);
  await ensureStyleBuildJobs(db);
  const kid = Number(demoChildId) || 0;
  const [allRows, chips, tileDefs, chipDefs] = await Promise.all([
    placeableRows(db), chipRows(db),
    db`SELECT taxonomy_id, image_key FROM taxonomy_style_defaults
       WHERE style_guide_id = ${styleGuideId} AND demo_child_id = ${kid}`,
    db`SELECT section, label_norm, parent_norm, image_key FROM category_style_defaults WHERE style_guide_id = ${styleGuideId}`,
  ]);
  const rows = kid === 0 ? allRows : allRows.filter(isPersonScopeRow);
  const doneTiles = new Set(tileDefs.filter(t => t.image_key).map(t => t.taxonomy_id));
  const doneChips = new Set(chipDefs.filter(c => c.image_key).map(c => `${c.section}|${c.label_norm}|${c.parent_norm}`));
  let tiles = 0, chipsN = 0;
  for (const t of rows) {
    // force = re-render even finished tiles (the recovery path for a set
    // that rendered wrong — e.g. the exemplar-bleed kid tiles). Every
    // replaced image is a fresh blob; nothing is deleted.
    if (!force && doneTiles.has(t.id)) continue;
    // attempts resets too — a job that already burned its 3 tries would
    // otherwise sit "queued" forever (the drain only picks attempts < 3).
    await db`INSERT INTO style_build_jobs (style_guide_id, kind, taxonomy_id, demo_child_id)
             VALUES (${styleGuideId}, 'tile', ${t.id}, ${kid})
             ON CONFLICT (style_guide_id, taxonomy_id, demo_child_id) WHERE kind = 'tile'
             DO UPDATE SET status = 'queued', error = NULL, attempts = 0, updated_at = NOW()`;
    tiles++;
  }
  if (kid === 0) {
    for (const c of chips) {
      if (doneChips.has(`${c.section}|${norm(c.label)}|${norm(c.parent)}`)) continue;
      await db`INSERT INTO style_build_jobs (style_guide_id, kind, section, label, parent)
               VALUES (${styleGuideId}, 'chip', ${c.section}, ${c.label}, ${c.parent})
               ON CONFLICT (style_guide_id, section, label, parent) WHERE kind = 'chip'
               DO UPDATE SET status = 'queued', error = NULL, attempts = 0, updated_at = NOW()`;
      chipsN++;
    }
  }
  return { tiles, chips: chipsN };
}

/// Queue + completion status for one style (the wizard's progress bar).
/// demoChildId ≠ 0 scopes everything to that kid's person-scope set: totals
/// count only person-scope rows, chips are always 0/0 (shared with kid 0).
export async function styleBuildStatus(db, styleGuideId, { demoChildId = 0 } = {}) {
  await ensureStyleDefaultTables(db);
  await ensureStyleBuildJobs(db);
  const kid = Number(demoChildId) || 0;
  const [jobs, allRows, allChips, tileDefs, chipDefs] = await Promise.all([
    db`SELECT kind, status, COUNT(*)::int AS n FROM style_build_jobs
       WHERE style_guide_id = ${styleGuideId} AND demo_child_id = ${kid} GROUP BY kind, status`,
    placeableRows(db), chipRows(db),
    db`SELECT taxonomy_id FROM taxonomy_style_defaults
       WHERE style_guide_id = ${styleGuideId} AND demo_child_id = ${kid} AND image_key IS NOT NULL`,
    db`SELECT section, label_norm, parent_norm FROM category_style_defaults
       WHERE style_guide_id = ${styleGuideId} AND image_key IS NOT NULL`,
  ]);
  const rows = kid === 0 ? allRows : allRows.filter(isPersonScopeRow);
  const chips = kid === 0 ? allChips : [];
  // TRUE SET DIFFERENCE, not row counts: counts let a stale default (for a
  // renamed/retired row) mask a genuinely missing NEW one — "42 done of 42"
  // while a category added last week has no chip anywhere. The missing lists
  // ride along so the wizard can say exactly what 🚀 Generate will fill.
  const doneTiles = new Set(tileDefs.map((r) => String(r.taxonomy_id)));
  const doneChips = new Set(chipDefs.map((r) => `${r.section}|${r.label_norm}|${r.parent_norm || ''}`));
  const missingTiles = rows.filter((r) => !doneTiles.has(String(r.id)));
  const missingChips = chips.filter((c) => !doneChips.has(`${c.section}|${norm(c.label)}|${norm(c.parent)}`));
  const j = { tileQueued: 0, tileFailed: 0, chipQueued: 0, chipFailed: 0 };
  for (const r of jobs) {
    // 'rendering' (mid-drain claim) still counts as queued for display.
    if (r.kind === 'tile' && (r.status === 'queued' || r.status === 'rendering')) j.tileQueued += r.n;
    if (r.kind === 'tile' && r.status === 'failed') j.tileFailed += r.n;
    if (r.kind === 'chip' && (r.status === 'queued' || r.status === 'rendering')) j.chipQueued += r.n;
    if (r.kind === 'chip' && r.status === 'failed') j.chipFailed += r.n;
  }
  return {
    tiles: rows.length, tilesDone: rows.length - missingTiles.length,
    chips: chips.length, chipsDone: chips.length - missingChips.length,
    missingTileLabels: missingTiles.slice(0, 40).map((r) => r.label),
    missingChipLabels: missingChips.slice(0, 40).map((c) => (c.parent ? `${c.parent} › ${c.label}` : c.label)),
    ...j,
    complete: missingTiles.length === 0 && missingChips.length === 0,
  };
}

/// How many images render at once per drain. Image-API latency dominates
/// (~10-15s each), so parallelism is nearly free throughput — 6-way ≈ 6×.
/// The Gemini wrapper already backs off on 429/503 and failed jobs re-queue
/// (3 attempts), so an over-aggressive setting degrades gracefully instead
/// of losing work. Tune with STYLE_BUILD_CONCURRENCY (capped at 12 so a
/// cron tick + a turbo tab together stay well inside paid-tier rate limits).
export function styleBuildConcurrency() {
  const n = parseInt(process.env.STYLE_BUILD_CONCURRENCY || '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 6;
}

/// Cron hook + the wizard's ⚡ turbo drain: render queued jobs until the time
/// budget runs out. Four properties (owner-requested after Emily sat at 0%
/// while Bobby drained, then again when a full style took an afternoon):
///   FAIR — the pick round-robins across (style, demo kid) queues, so every
///     queued build progresses at once instead of strict oldest-first.
///   PARALLEL — `concurrency` images render at a time (default
///     styleBuildConcurrency; image-API latency dominates).
///   CONTINUOUS — claim → render → claim again until budgetMs is spent, so
///     one cron tick does ~budget/latency × concurrency images, not one
///     fixed batch (the old 9-per-minute ceiling was the whole slowness).
///   CLAIMED — jobs flip to 'rendering' atomically before work starts, so a
///     cron tick and a manual wizard drain can run together without ever
///     rendering (and paying for) the same job twice. Orphaned 'rendering'
///     rows (a crashed drain) reap back to 'queued' after 10 minutes.
/// A 'canceled' status (the wizard's ⏹ Stop) is never picked; 🚀 Generate
/// re-queues canceled rows via its ON CONFLICT upsert. Failures mark the job
/// (3 attempts max) and never wedge the queue. Returns processed counts.
export async function drainStyleBuildJobs(db, { budgetMs = 40000, batch = null, concurrency = null } = {}) {
  await ensureStyleBuildJobs(db);
  const started = Date.now();
  const conc = Math.max(1, Number(concurrency) || styleBuildConcurrency());
  const roundSize = Math.max(1, Number(batch) || conc * 3);
  await db`UPDATE style_build_jobs SET status = 'queued', updated_at = NOW()
           WHERE status = 'rendering' AND updated_at < NOW() - INTERVAL '10 minutes'`;
  const settings = await labSettings(db);
  // Shared lookups persist ACROSS rounds — one style/anchor load per drain,
  // no matter how many rounds render.
  const styles = new Map();   // style id → style row (or null)
  const anchors = new Map();  // "styleId:kidId" → child anchor image (or null)
  let processed = 0, failed = 0;

  while (Date.now() - started < budgetMs) {
    const picked = await db`
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY style_guide_id, demo_child_id ORDER BY id) AS rn
        FROM style_build_jobs WHERE status = 'queued' AND attempts < 3
      ) t ORDER BY rn, id LIMIT ${roundSize}`;
    if (!picked.length) break;
    const claimed = await db`UPDATE style_build_jobs SET status = 'rendering', updated_at = NOW()
                             WHERE id = ANY(${picked.map((r) => Number(r.id))}) AND status = 'queued'
                             RETURNING *`;
    // A concurrent drain won the whole round — go pick again.
    if (!claimed.length) continue;
    for (const job of claimed) {
      const sid = Number(job.style_guide_id);
      const kid = Number(job.demo_child_id) || 0;
      if (!styles.has(sid)) styles.set(sid, await loadStyle(db, sid));
      const aKey = `${sid}:${kid}`;
      if (job.kind === 'tile' && styles.get(sid) && !anchors.has(aKey)) {
        anchors.set(aKey, await demoChildAnchor(db, styles.get(sid), kid));
      }
    }
    const requeue = [];
    await mapPool(claimed, conc, async (job) => {
      // Out of budget: unstarted jobs go straight back to the queue.
      if (Date.now() - started > budgetMs) { requeue.push(Number(job.id)); return; }
      const sid = Number(job.style_guide_id);
      const kid = Number(job.demo_child_id) || 0;
      const style = styles.get(sid);
      try {
        if (!style) throw new Error('style guide missing');
        if (job.kind === 'tile') {
          const anchor = anchors.get(`${sid}:${kid}`);
          if (kid !== 0 && !anchor) throw new Error('demo kid reference missing');
          const tax = (await db`SELECT id, id AS slug, column_name, category, subcategory, label, prompt_template,
                                       subject_mode, related_images, default_image_key
                                FROM taxonomy WHERE id = ${job.taxonomy_id} LIMIT 1`)[0];
          if (!tax) throw new Error('taxonomy row gone');
          await renderOneTile({ db, style, tax, settings, anchor, demoChildId: kid });
        } else {
          await renderOneChip({ db, style,
            chip: { section: job.section, label: job.label, parent: job.parent || '' } });
        }
        await db`UPDATE style_build_jobs SET status = 'done', error = NULL, updated_at = NOW() WHERE id = ${job.id}`;
        processed++;
      } catch (err) {
        failed++;
        const msg = String(err.message || err).slice(0, 400);
        await db`UPDATE style_build_jobs
                 SET attempts = attempts + 1, error = ${msg}, updated_at = NOW(),
                     status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'queued' END
                 WHERE id = ${job.id}`;
      }
    });
    if (requeue.length) {
      await db`UPDATE style_build_jobs SET status = 'queued', updated_at = NOW()
               WHERE id = ANY(${requeue}) AND status = 'rendering'`;
      break;   // budget hit mid-round — done for this drain
    }
  }
  return { processed, failed };
}

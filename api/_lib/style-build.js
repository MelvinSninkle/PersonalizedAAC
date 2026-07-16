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
import { readBlobBytes, renderTaxonomyTile } from './onboarding-render.js';
import { buildIconPrompt } from './category-icons.js';
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
  const r = await renderTaxonomyTile({
    tax, styleGuide: style, childAnchor: anchor, settings,
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

export async function renderOneChip({ db, style, chip }) {
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
export async function enqueueStyleBuild(db, styleGuideId, { demoChildId = 0 } = {}) {
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
    if (doneTiles.has(t.id)) continue;
    await db`INSERT INTO style_build_jobs (style_guide_id, kind, taxonomy_id, demo_child_id)
             VALUES (${styleGuideId}, 'tile', ${t.id}, ${kid})
             ON CONFLICT (style_guide_id, taxonomy_id, demo_child_id) WHERE kind = 'tile'
             DO UPDATE SET status = 'queued', error = NULL, updated_at = NOW()`;
    tiles++;
  }
  if (kid === 0) {
    for (const c of chips) {
      if (doneChips.has(`${c.section}|${norm(c.label)}|${norm(c.parent)}`)) continue;
      await db`INSERT INTO style_build_jobs (style_guide_id, kind, section, label, parent)
               VALUES (${styleGuideId}, 'chip', ${c.section}, ${c.label}, ${c.parent})
               ON CONFLICT (style_guide_id, section, label, parent) WHERE kind = 'chip'
               DO UPDATE SET status = 'queued', error = NULL, updated_at = NOW()`;
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
    db`SELECT COUNT(*)::int AS n FROM taxonomy_style_defaults
       WHERE style_guide_id = ${styleGuideId} AND demo_child_id = ${kid} AND image_key IS NOT NULL`,
    db`SELECT COUNT(*)::int AS n FROM category_style_defaults WHERE style_guide_id = ${styleGuideId} AND image_key IS NOT NULL`,
  ]);
  const rows = kid === 0 ? allRows : allRows.filter(isPersonScopeRow);
  const chips = kid === 0 ? allChips : [];
  const chipsDone = kid === 0 ? (chipDefs[0]?.n || 0) : 0;
  const j = { tileQueued: 0, tileFailed: 0, chipQueued: 0, chipFailed: 0 };
  for (const r of jobs) {
    if (r.kind === 'tile' && r.status === 'queued') j.tileQueued = r.n;
    if (r.kind === 'tile' && r.status === 'failed') j.tileFailed = r.n;
    if (r.kind === 'chip' && r.status === 'queued') j.chipQueued = r.n;
    if (r.kind === 'chip' && r.status === 'failed') j.chipFailed = r.n;
  }
  return {
    tiles: rows.length, tilesDone: tileDefs[0]?.n || 0,
    chips: chips.length, chipsDone,
    ...j,
    complete: (tileDefs[0]?.n || 0) >= rows.length && chipsDone >= chips.length,
  };
}

/// Cron hook: render a bounded batch of queued jobs (oldest first, any
/// style). Time-budgeted so the tick always returns; failures mark the job
/// (3 attempts max) and never wedge the queue. Returns processed counts.
export async function drainStyleBuildJobs(db, { budgetMs = 40000, batch = 6 } = {}) {
  await ensureStyleBuildJobs(db);
  const started = Date.now();
  const picked = await db`SELECT * FROM style_build_jobs
                          WHERE status = 'queued' AND attempts < 3
                          ORDER BY id LIMIT ${batch}`;
  if (!picked.length) return { processed: 0, failed: 0 };
  const settings = await labSettings(db);
  const styles = new Map();   // style id → style row (or null)
  const anchors = new Map();  // "styleId:kidId" → child anchor image (or null)
  let processed = 0, failed = 0;
  for (const job of picked) {
    if (Date.now() - started > budgetMs) break;
    const sid = Number(job.style_guide_id);
    const kid = Number(job.demo_child_id) || 0;
    if (!styles.has(sid)) styles.set(sid, await loadStyle(db, sid));
    const style = styles.get(sid);
    try {
      if (!style) throw new Error('style guide missing');
      if (job.kind === 'tile') {
        const aKey = `${sid}:${kid}`;
        if (!anchors.has(aKey)) anchors.set(aKey, await demoChildAnchor(db, style, kid));
        const anchor = anchors.get(aKey);
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
  }
  return { processed, failed };
}

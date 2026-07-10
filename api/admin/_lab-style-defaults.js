// /api/admin/lab?action=style-defaults  (admin only)
//
// The per-style DEFAULT BOARD content system. Every OFFERED style (global
// style_guides row) gets its own pre-generated, style-matched set of default
// art: one image per placeable taxonomy row + one icon per category/
// subcategory chip. /api/sync then resolves a child's default-able tiles
// against their chosen style's set first (see sync.js), so a family that
// picks an offered style gets a fully matching board with ZERO onboarding
// generation cost for the shared vocabulary.
//
//   GET  ?styleGuideId=N
//     → { style, tiles:[{id,label,column,category,subcategory,defaultable,
//          imageKey,status,error}], chips:[{section,label,parent,imageKey,
//          status,error}], counts }
//   POST { styleGuideId, op:'generate', kind:'tiles'|'chips', offset?, limit?, force? }
//     → chunked bulk generation; loop until done:true (defaults.html drives it).
//   POST { styleGuideId, op:'regen', taxonomyId }            → re-render one tile
//   POST { styleGuideId, op:'regen', chip:{section,label,parent} } → one chip
//
// Person-referencing tiles render with the style's PERSON reference (a generic
// child drawn in the style — style_guides.person_ref_key) standing in for the
// real child; the style's STUFF reference rides along as a world reference so
// objects and materials stay consistent. Both are Lab-uploaded per style.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { readBlobBytes, renderTaxonomyTile } from '../_lib/onboarding-render.js';
import { buildIconPrompt } from '../_lib/category-icons.js';
import { geminiKey, geminiDefaultModel, geminiGenerateImage, geminiCostCents } from '../_lib/gemini.js';

export const config = { maxDuration: 300 };

const norm = (s) => String(s || '').trim().toLowerCase();

async function ensureTables(db) {
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
}

// The style row WITHOUT the active filter (a style being prepped before it's
// offered is the main use case) — but always a GLOBAL one, never a parent's
// child-scoped upload (those keep the generic default board by design).
async function loadStyle(db, id) {
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
async function placeableRows(db) {
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
async function chipRows(db) {
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

async function labSettings(db) {
  try {
    const r = await db`SELECT master_prompt, size_default FROM lab_settings WHERE id = 1`;
    return r[0] || { master_prompt: '', size_default: '1024x1024' };
  } catch (_) { return { master_prompt: '', size_default: '1024x1024' }; }
}

async function personAnchor(style) {
  if (!style || !style.person_ref_key) return null;
  try {
    const bytes = await readBlobBytes(style.person_ref_key);
    return { ...bytes, key: style.person_ref_key, name: 'the child' };
  } catch (_) { return null; }
}

async function renderOneTile({ db, style, tax, settings, anchor }) {
  const r = await renderTaxonomyTile({
    tax, styleGuide: style, childAnchor: anchor, settings,
    worldRefKeys: style.stuff_ref_key ? [style.stuff_ref_key] : [],
  });
  if (!r.ok) throw new Error(r.detail || 'render failed');
  const png = Buffer.from(r.b64, 'base64');
  const imageKey = `style-defaults/${style.id}/${tax.id}/${randomUUID()}.png`;
  await put(imageKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
  await db`INSERT INTO taxonomy_style_defaults (taxonomy_id, style_guide_id, image_key, status, error, updated_at)
           VALUES (${tax.id}, ${style.id}, ${imageKey}, 'done', NULL, NOW())
           ON CONFLICT (taxonomy_id, style_guide_id)
           DO UPDATE SET image_key = ${imageKey}, status = 'done', error = NULL, updated_at = NOW()`;
  try {
    await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
             VALUES ('__lab__', NULL, 'lab_style_default', ${tax.label},
                     ${'style-default guide#' + style.id + ' ' + (style.label || '')}, ${r.prompt}, '1024x1024', ${r.costCents ?? 4})`;
  } catch (_) {}
  return imageKey;
}

async function renderOneChip({ db, style, chip }) {
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

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await ensureTables(db);

  const q = req.query || {};
  const b = (typeof req.body === 'object' && req.body) || {};
  const styleGuideId = parseInt((req.method === 'GET' ? q.styleGuideId : b.styleGuideId), 10);
  if (!styleGuideId) { res.status(400).json({ error: 'styleGuideId required' }); return; }
  const style = await loadStyle(db, styleGuideId);
  if (!style) { res.status(404).json({ error: 'style guide not found (or not a global/offered one)' }); return; }

  try {
    if (req.method === 'GET') {
      const [rows, chips, tileDefs, chipDefs] = await Promise.all([
        placeableRows(db), chipRows(db),
        db`SELECT taxonomy_id, image_key, status, error FROM taxonomy_style_defaults WHERE style_guide_id = ${styleGuideId}`,
        db`SELECT section, label_norm, parent_norm, image_key, status, error FROM category_style_defaults WHERE style_guide_id = ${styleGuideId}`,
      ]);
      const tMap = new Map(tileDefs.map(t => [t.taxonomy_id, t]));
      const cMap = new Map(chipDefs.map(c => [`${c.section}|${c.label_norm}|${c.parent_norm}`, c]));
      const { isDefaultableTile } = await import('../_lib/onboarding-render.js');
      const tiles = rows.map(t => {
        const d = tMap.get(t.id);
        return { id: t.id, label: t.label, column: t.column_name, category: t.category || '',
                 subcategory: t.subcategory || '', defaultable: isDefaultableTile(t),
                 genericKey: t.default_image_key || null,
                 imageKey: (d && d.image_key) || null, status: (d && d.status) || null, error: (d && d.error) || null };
      });
      const chipsOut = chips.map(c => {
        const d = cMap.get(`${c.section}|${norm(c.label)}|${norm(c.parent)}`);
        return { ...c, imageKey: (d && d.image_key) || null, status: (d && d.status) || null, error: (d && d.error) || null };
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        ok: true,
        style: { id: style.id, label: style.label, personRefKey: style.person_ref_key, stuffRefKey: style.stuff_ref_key },
        tiles, chips: chipsOut,
        counts: {
          tiles: tiles.length, tilesDone: tiles.filter(t => t.imageKey).length,
          chips: chipsOut.length, chipsDone: chipsOut.filter(c => c.imageKey).length,
        },
      });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const op = String(b.op || 'generate');
    const settings = await labSettings(db);
    const anchor = await personAnchor(style);

    if (op === 'regen') {
      if (b.taxonomyId) {
        const tax = (await db`SELECT id, id AS slug, column_name, category, subcategory, label, prompt_template,
                                     subject_mode, related_images, default_image_key
                              FROM taxonomy WHERE id = ${String(b.taxonomyId)} LIMIT 1`)[0];
        if (!tax) { res.status(404).json({ error: 'taxonomy row not found' }); return; }
        const imageKey = await renderOneTile({ db, style, tax, settings, anchor });
        res.status(200).json({ ok: true, imageKey }); return;
      }
      if (b.chip && b.chip.section && b.chip.label) {
        const imageKey = await renderOneChip({ db, style,
          chip: { section: norm(b.chip.section), label: String(b.chip.label).trim(), parent: String(b.chip.parent || '').trim() } });
        res.status(200).json({ ok: true, imageKey }); return;
      }
      res.status(400).json({ error: 'regen needs taxonomyId or chip{section,label,parent}' }); return;
    }

    // op === 'generate' — one chunk; the client loops until done. force=true
    // re-renders existing images (a whole-set refresh); default fills gaps only.
    const kind = b.kind === 'chips' ? 'chips' : 'tiles';
    const offset = Math.max(0, parseInt(b.offset, 10) || 0);
    const limit = Math.min(4, Math.max(1, parseInt(b.limit, 10) || 3));
    const force = b.force === true;
    const list = kind === 'tiles' ? await placeableRows(db) : await chipRows(db);
    const slice = list.slice(offset, offset + limit);
    let generated = 0, skipped = 0, failed = 0;
    for (const item of slice) {
      try {
        if (kind === 'tiles') {
          const ex = (await db`SELECT image_key FROM taxonomy_style_defaults
                               WHERE taxonomy_id = ${item.id} AND style_guide_id = ${styleGuideId} LIMIT 1`)[0];
          if (ex && ex.image_key && !force) { skipped++; continue; }
          await renderOneTile({ db, style, tax: item, settings, anchor });
        } else {
          const ex = (await db`SELECT image_key FROM category_style_defaults
                               WHERE style_guide_id = ${styleGuideId} AND section = ${item.section}
                                 AND label_norm = ${norm(item.label)} AND parent_norm = ${norm(item.parent)} LIMIT 1`)[0];
          if (ex && ex.image_key && !force) { skipped++; continue; }
          await renderOneChip({ db, style, chip: item });
        }
        generated++;
      } catch (err) {
        failed++;
        const msg = String(err.message || err).slice(0, 400);
        try {
          if (kind === 'tiles') {
            await db`INSERT INTO taxonomy_style_defaults (taxonomy_id, style_guide_id, status, error, updated_at)
                     VALUES (${item.id}, ${styleGuideId}, 'failed', ${msg}, NOW())
                     ON CONFLICT (taxonomy_id, style_guide_id)
                     DO UPDATE SET status = 'failed', error = ${msg}, updated_at = NOW()`;
          } else {
            await db`INSERT INTO category_style_defaults (style_guide_id, section, label_norm, parent_norm, status, error, updated_at)
                     VALUES (${styleGuideId}, ${item.section}, ${norm(item.label)}, ${norm(item.parent)}, 'failed', ${msg}, NOW())
                     ON CONFLICT (style_guide_id, section, label_norm, parent_norm)
                     DO UPDATE SET status = 'failed', error = ${msg}, updated_at = NOW()`;
          }
        } catch (_) {}
      }
    }
    const next = offset + slice.length;
    res.status(200).json({ ok: true, kind, total: list.length, offset, next,
                           done: next >= list.length, generated, skipped, failed });
  } catch (err) {
    res.status(500).json({ error: 'style-defaults failed', detail: String(err.message || err) });
  }
}

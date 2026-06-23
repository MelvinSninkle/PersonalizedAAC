// POST /api/admin/lab-batch-generate
// Body: { taxonomyIds?: [...], categories?: [{ section, label, parent?, promptOverride?, childId? }],
//         styleGuideId?, childId?, model? }
//
// Bulk-generate many tiles AND/OR category chips in one call, reusing the shared
// batch engine (api/_lib/batch-generate.js) + the shared renderers
// (renderTaxonomyTile, generateCategoryIcon) — the SAME code path new-customer
// onboarding uses. Paired/related tiles (has_relationship + related_images)
// generate together so the earlier image seeds the later for a consistent set;
// category chips have no cross-deps, so each is a singleton group. Everything runs
// through one concurrency pool so chips and tiles parallelize together.
//
// The caller (Lab UI) sends manageable CHUNKS — whole related-groups, ~15-20 items
// — so each request stays inside the function time limit; it loops chunks for the
// whole board. Tile results are recorded in tile_generations (QC gallery + publish
// flow); chips are set straight on the board. Returns per-item results + totals.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { isGeminiModel } from '../_lib/gemini.js';
import { loadStyleGuide, loadChildAnchor, renderTaxonomyTile } from '../_lib/onboarding-render.js';
import { generateCategoryIcon, loadCategoryStyle } from '../_lib/category-icons.js';
import { planGenerationGroups, runGroups } from '../_lib/batch-generate.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const b = (typeof req.body === 'object' && req.body) || {};
  const ids = Array.isArray(b.taxonomyIds) ? b.taxonomyIds.map((x) => String(x)).filter(Boolean).slice(0, 60) : [];
  const cats = Array.isArray(b.categories) ? b.categories.filter((c) => c && c.section && c.label).slice(0, 60) : [];
  if (!ids.length && !cats.length) { res.status(400).json({ error: 'taxonomyIds[] or categories[] required' }); return; }
  const childId = String(b.childId || 'fletcherpeterson').slice(0, 64).trim();
  const styleGuideId = b.styleGuideId != null ? parseInt(b.styleGuideId, 10) : null;
  const model = (typeof b.model === 'string' && isGeminiModel(b.model)) ? b.model : null;

  let db;
  try { db = sql(); } catch (err) { res.status(500).json({ error: 'DB not configured', detail: String(err.message || err) }); return; }

  try {
    // ── Tiles ────────────────────────────────────────────────────────────────
    let rows = [];
    if (ids.length) {
      rows = await db`
        SELECT id, column_name, category, subcategory, label, prompt_template, subject_mode, related_images
        FROM taxonomy WHERE id = ANY(${ids})
      `;
    }
    const settingsRows = await db`SELECT master_prompt, size_default, model_defaults FROM lab_settings WHERE id = 1`;
    const settings = settingsRows[0] || {};

    const styleGuide = rows.length ? await loadStyleGuide(db, styleGuideId) : null;
    const childAnchor = rows.length ? await loadChildAnchor(db, childId) : null;

    // ── Category chips ─────────────────────────────────────────────────────────
    // Load the chosen style once (image bytes + description) and reuse for every
    // chip. Chips can run on a Gemini model (when the batch model is Gemini) or
    // fall back to the configured category model.
    let catStyle = null, catStyleBuf = null;
    let catModel = model;
    const catSize = settings.size_default || '1024x1024';
    if (cats.length) {
      ({ style: catStyle, styleBuf: catStyleBuf } = await loadCategoryStyle(db, styleGuideId));
      if (!catModel) catModel = (settings.model_defaults && (settings.model_defaults.category || settings.model_defaults.default)) || 'gpt-image-1.5';
    }

    // Build a unified id space: real taxonomy ids for tiles + synthetic ids for
    // chips, so both flow through the one ordering + concurrency pool.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const catGroups = [];
    cats.forEach((c, i) => {
      const cid = `__cat__${i}`;
      byId.set(cid, { __category: true, spec: c });
      catGroups.push([cid]);   // chips have no cross-deps → singleton groups
    });
    const tileGroups = rows.length ? planGenerationGroups(rows) : [];
    const groups = [...tileGroups, ...catGroups];

    // Dispatch render: tiles via renderTaxonomyTile (records tile_generations and
    // threads paired references); chips via the shared generateCategoryIcon.
    const render = async (row, { referenceImageKeys }) => {
      if (row && row.__category) {
        const c = row.spec;
        const r = await generateCategoryIcon({
          db, childId: String(c.childId || childId), section: c.section, label: c.label,
          parentLabel: c.parent || '', promptOverride: c.promptOverride || null,
          style: catStyle, styleBuf: catStyleBuf, model: catModel, size: catSize, actorEmail: gate.email,
        });
        if (!r.ok) return { ok: false, error: r.error || 'generation failed' };
        return { ok: true, blobKey: r.blobKey, costCents: r.costCents, created: r.created, categoryId: r.id };
      }
      const tax = row;
      const r = await renderTaxonomyTile({ tax, styleGuide, childAnchor, settings, referenceImageKeys, model });
      if (!r.ok) return { ok: false, error: r.detail || r.status || 'generation failed' };
      const blobKey = `lab/${tax.id}/${randomUUID()}.png`;
      await put(blobKey, Buffer.from(r.b64, 'base64'), { access: 'private', contentType: 'image/png', addRandomSuffix: false });
      const blobUrl = `/api/media?key=${encodeURIComponent(blobKey)}`;
      try {
        await db`
          INSERT INTO tile_generations (taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key, cost_cents, created_by)
          VALUES (${tax.id}, ${styleGuide ? styleGuide.id : null}, ${r.model}, ${r.prompt}, ${blobUrl}, ${blobKey}, ${r.costCents}, ${gate.email})
        `;
      } catch (_) { /* recording is best-effort; the image is already stored */ }
      return { ok: true, blobKey, blobUrl, costCents: r.costCents };
    };

    const results = await runGroups({ groups, byId, concurrency: 3, render });

    // Split results back into tiles + chips.
    const out = [];
    let okCount = 0, cost = 0;
    for (const id of ids) {
      const r = results.get(id) || { ok: false, error: 'not processed' };
      if (r.ok) { okCount++; cost += (r.costCents || 0); }
      out.push({ id, ok: !!r.ok, blobKey: r.blobKey, blobUrl: r.blobUrl, costCents: r.costCents, error: r.error });
    }
    const catOut = [];
    let catOk = 0;
    cats.forEach((c, i) => {
      const r = results.get(`__cat__${i}`) || { ok: false, error: 'not processed' };
      if (r.ok) { catOk++; cost += (r.costCents || 0); }
      catOut.push({ section: c.section, label: c.label, parent: c.parent || null, ok: !!r.ok, categoryId: r.categoryId, created: r.created, error: r.error });
    });

    res.status(200).json({
      ok: true,
      generated: okCount, failed: ids.length - okCount,
      categoriesGenerated: catOk, categoriesFailed: cats.length - catOk,
      costCents: cost, groups: groups.length, results: out, categories: catOut,
    });
  } catch (err) {
    res.status(500).json({ error: 'batch generate failed', detail: String(err.message || err) });
  }
}

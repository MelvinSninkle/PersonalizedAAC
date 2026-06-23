// POST /api/admin/lab-batch-generate
// Body: { taxonomyIds: [...], styleGuideId?, childId?, model? }
//
// Bulk-generate many tiles in one call, reusing the shared batch engine
// (api/_lib/batch-generate.js) + the shared renderer (renderTaxonomyTile) — the
// SAME code path new-customer onboarding uses. Paired/related tiles
// (has_relationship + related_images) generate together so the earlier image
// seeds the later for a consistent set. Each result is recorded in
// tile_generations (so the QC gallery + publish flow pick it up).
//
// The caller (Lab UI) sends manageable CHUNKS — whole related-groups, ~15-20 tiles
// — so each request stays inside the function time limit; it loops chunks for the
// whole board. Returns per-tile { id, ok, blobKey?, costCents?, error? } + totals.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { isGeminiModel } from '../_lib/gemini.js';
import { loadStyleGuide, loadChildAnchor, renderTaxonomyTile } from '../_lib/onboarding-render.js';
import { planGenerationGroups, runGroups } from '../_lib/batch-generate.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const b = (typeof req.body === 'object' && req.body) || {};
  const ids = Array.isArray(b.taxonomyIds) ? b.taxonomyIds.map((x) => String(x)).filter(Boolean).slice(0, 60) : [];
  if (!ids.length) { res.status(400).json({ error: 'taxonomyIds[] required' }); return; }
  const childId = String(b.childId || 'fletcherpeterson').slice(0, 64).trim();
  const styleGuideId = b.styleGuideId != null ? parseInt(b.styleGuideId, 10) : null;
  const model = (typeof b.model === 'string' && isGeminiModel(b.model)) ? b.model : null;

  let db;
  try { db = sql(); } catch (err) { res.status(500).json({ error: 'DB not configured', detail: String(err.message || err) }); return; }

  try {
    // Load the rows (with related_images so the engine can group pairs).
    const rows = await db`
      SELECT id, column_name, category, subcategory, label, prompt_template, subject_mode, related_images
      FROM taxonomy WHERE id = ANY(${ids})
    `;
    if (!rows.length) { res.status(404).json({ error: 'no matching taxonomy rows', ids }); return; }
    const byId = new Map(rows.map((r) => [r.id, r]));

    const styleGuide = await loadStyleGuide(db, styleGuideId);
    const childAnchor = await loadChildAnchor(db, childId);
    const settingsRows = await db`SELECT master_prompt, size_default FROM lab_settings WHERE id = 1`;
    const settings = settingsRows[0] || {};

    const groups = planGenerationGroups(rows);

    // Per-tile render: generate → upload PNG → record tile_generations → return the
    // blob key so the engine can thread it into the next tile in the group.
    const render = async (tax, { referenceImageKeys }) => {
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

    const out = [];
    let okCount = 0, cost = 0;
    for (const id of ids) {
      const r = results.get(id) || { ok: false, error: 'not processed' };
      if (r.ok) { okCount++; cost += (r.costCents || 0); }
      out.push({ id, ok: !!r.ok, blobKey: r.blobKey, blobUrl: r.blobUrl, costCents: r.costCents, error: r.error });
    }
    res.status(200).json({ ok: true, generated: okCount, failed: ids.length - okCount, costCents: cost, groups: groups.length, results: out });
  } catch (err) {
    res.status(500).json({ error: 'batch generate failed', detail: String(err.message || err) });
  }
}

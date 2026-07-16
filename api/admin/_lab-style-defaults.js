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
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { norm, ensureStyleDefaultTables, loadStyle, placeableRows, chipRows,
         labSettings, personAnchor, renderOneTile, renderOneChip } from '../_lib/style-build.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await ensureStyleDefaultTables(db);

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
        db`SELECT taxonomy_id, image_key, status, error FROM taxonomy_style_defaults
           WHERE style_guide_id = ${styleGuideId} AND demo_child_id = 0`,
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
                               WHERE taxonomy_id = ${item.id} AND style_guide_id = ${styleGuideId}
                                 AND demo_child_id = 0 LIMIT 1`)[0];
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
            await db`INSERT INTO taxonomy_style_defaults (taxonomy_id, style_guide_id, demo_child_id, status, error, updated_at)
                     VALUES (${item.id}, ${styleGuideId}, 0, 'failed', ${msg}, NOW())
                     ON CONFLICT (taxonomy_id, style_guide_id, demo_child_id)
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

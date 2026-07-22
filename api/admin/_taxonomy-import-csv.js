// POST /api/admin/taxonomy?fn=import-csv   { rows: [...], dryRun?: true }
//
// Bulk-merge a batch of authored taxonomy rows (the 2026-07 reactive-vocab
// CSVs) with DEDUP AGAINST THE LIVE MASTER — the piece a blind insert lacks:
//   • exact label match (case-insensitive, same column) → SKIP the new row and
//     MERGE its listen variants into the existing row's match_terms (the
//     "'I missed you' becomes a variant of 'I miss you'" rule, systematized)
//   • exact id match → skip entirely (re-run safe)
//   • everything else → INSERT as status='draft' so nothing goes live until
//     the admin reviews and publishes
// Safe + reversible: auto-snapshots first, audits after, dryRun previews the
// full plan (inserts/skips/merges) without writing. Rows arrive as JSON
// objects keyed by the CSV headers (the workbench parses the file client-side).
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

const ACTOR = 'admin';
const COLUMNS = new Set(['People', 'Nouns', 'Verbs', 'Needs', 'Events']);
const bool = (v) => String(v).trim().toUpperCase() === 'TRUE';
const txt = (v) => { const s = String(v ?? '').trim(); return s || null; };
// listen_variants arrive piped or comma-separated → match_terms text[]
const variants = (v) => String(v ?? '').split(/[|,]/).map((s) => s.trim().toLowerCase())
  .filter(Boolean).slice(0, 24);
// descriptive_clues arrive pipe- or newline-separated → text[3] (or null)
const cluesArr = (v) => {
  const parts = String(v ?? '').split(/\s*\|\s*|\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  return parts.length ? parts : null;
};
// gestalt_target_words arrive comma-separated → text[] (or null)
const wordsArr = (v) => {
  const parts = String(v ?? '').split(/[|,]/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  return parts.length ? parts : null;
};

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const b = (typeof req.body === 'object' && req.body) || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  // 3000 covers a full master overlay (the live table is ~1,600 rows); the
  // dispatcher runs at maxDuration 300 so ~1,300 sequential enrich UPDATEs
  // fit comfortably.
  if (!rows.length || rows.length > 3000) { res.status(400).json({ error: 'rows required (1-3000)' }); return; }
  const dryRun = b.dryRun === true;

  try {
    const db = sql();
    const existing = await db`SELECT id, label, column_name, match_terms FROM taxonomy`;
    const byId = new Set(existing.map((r) => r.id));
    const byLabel = new Map(existing.map((r) => [`${r.column_name}|${String(r.label).trim().toLowerCase()}`, r]));

    const plan = { inserts: [], skippedId: [], merges: [], invalid: [], enrich: [], labelConflicts: [] };
    const rowById = new Map(existing.map((r) => [r.id, r]));
    for (const r of rows) {
      const id = txt(r.id), label = txt(r.label), col = txt(r.column);
      if (!id || !label || !COLUMNS.has(col) || !/^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(id)) {
        plan.invalid.push({ id, label, why: 'missing/invalid id, label, or column' }); continue;
      }
      if (byId.has(id)) {
        // ENRICH, don't skip: an authored master overlay updates ONLY the
        // fields the author actually writes — clues, prompts, pronunciation,
        // categories, metadata — and MERGES listen variants. It never touches
        // status, default art, or anything the CSV doesn't carry, so a
        // partial export can't wipe live columns (the snapshot-restore
        // lesson). Empty cells leave the live value alone.
        const cur = rowById.get(id);
        // Label = identity, forever. A differing label is a rename request,
        // which is a migration, not an import — refuse just that row.
        if (String(cur.label).trim().toLowerCase() !== label.toLowerCase()) {
          plan.labelConflicts.push({ id, from: cur.label, to: label });
          continue;
        }
        const have = new Set((cur.match_terms || []).map((s) => s.toLowerCase()));
        plan.enrich.push({
          id,
          clues: cluesArr(r.descriptive_clues),
          prompt: txt(r.prompt_template),
          pron: txt(r.pronunciation),
          category: txt(r.category),
          subcategory: txt(r.subcategory),
          growth: txt(r.growth_stage),
          meal: txt(r.meal_context),
          notes: txt(r.notes),
          sort: Number.isFinite(parseInt(r.sort_order, 10)) ? parseInt(r.sort_order, 10) : null,
          addVariants: variants(r.listen_variants).filter((v) => !have.has(v) && v !== label.toLowerCase()),
        });
        continue;
      }
      const dupe = byLabel.get(`${col}|${label.toLowerCase()}`);
      if (dupe) {
        // Same word already in the master: don't duplicate the tile — donate
        // the new row's listen variants (and its label, if novel) instead.
        const have = new Set((dupe.match_terms || []).map((s) => s.toLowerCase()));
        const add = variants(r.listen_variants).filter((v) => !have.has(v) && v !== label.toLowerCase());
        plan.merges.push({ id: dupe.id, from: id, addedVariants: add });
        continue;
      }
      plan.inserts.push(r);
    }

    if (dryRun) { res.status(200).json({ ok: true, dryRun: true, ...summarize(plan) }); return; }

    // Snapshot first (reversible), exactly like import-board.
    const all = await db`SELECT * FROM taxonomy ORDER BY id`;
    await db`INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
             VALUES (${ACTOR}, ${'pre-csv-import-' + new Date().toISOString()},
                     ${'Auto-snapshot before CSV merge of ' + rows.length + ' rows'},
                     ${all.length}, ${JSON.stringify(all)}::jsonb)`;

    for (const m of plan.merges) {
      if (!m.addedVariants.length) continue;
      await db`UPDATE taxonomy
               SET match_terms = (
                 SELECT ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(match_terms, '{}') || ${m.addedVariants}::text[]) AS x)
               ) WHERE id = ${m.id}`;
    }
    // Targeted enrichment of existing rows: COALESCE keeps the live value
    // whenever the CSV cell was empty; match_terms merge, never replace.
    for (const e of plan.enrich) {
      await db`UPDATE taxonomy SET
                 descriptive_clues = COALESCE(${e.clues}, descriptive_clues),
                 prompt_template   = COALESCE(${e.prompt}, prompt_template),
                 pronunciation     = COALESCE(${e.pron}, pronunciation),
                 category          = COALESCE(${e.category}, category),
                 subcategory       = COALESCE(${e.subcategory}, subcategory),
                 growth_stage      = COALESCE(${e.growth}, growth_stage),
                 meal_context      = COALESCE(${e.meal}, meal_context),
                 notes             = COALESCE(${e.notes}, notes),
                 sort_order        = COALESCE(${e.sort}, sort_order),
                 match_terms       = CASE WHEN ${e.addVariants.length > 0}
                   THEN (SELECT ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(match_terms, '{}') || ${e.addVariants}::text[]) AS x))
                   ELSE match_terms END,
                 updated_at        = NOW(), updated_by = ${ACTOR}
               WHERE id = ${e.id}`;
    }
    for (const r of plan.inserts) {
      await db`INSERT INTO taxonomy (
          id, column_name, category, subcategory, label, pronunciation, match_terms,
          subject_mode, parent_photo_behavior, phase, core, growth_stage, meal_context,
          is_gestalt, gestalt_type, gestalt_meaning, gestalt_target_words,
          descriptive_clues, audience, authoring_kind, status, notes, prompt_template, sort_order
        ) VALUES (
          ${r.id}, ${txt(r.column)}, ${txt(r.category)}, ${txt(r.subcategory)}, ${txt(r.label)},
          ${txt(r.pronunciation)}, ${variants(r.listen_variants)},
          ${txt(r.subject_mode) || 'object'}, ${txt(r.parent_photo_behavior) || 'none'},
          ${txt(r.phase) || 'v1_extended'}, ${bool(r.core)}, ${txt(r.growth_stage)}, ${txt(r.meal_context)},
          ${bool(r.is_gestalt)}, ${txt(r.gestalt_type)}, ${txt(r.gestalt_meaning)}, ${wordsArr(r.gestalt_target_words)},
          ${cluesArr(r.descriptive_clues)}, ${txt(r.audience) || 'universal'}, ${txt(r.authoring_kind) || 'canonical'},
          'draft', ${txt(r.notes)}, ${txt(r.prompt_template) ?? ''},
          ${Number.isFinite(parseInt(r.sort_order, 10)) ? parseInt(r.sort_order, 10) : null}
        ) ON CONFLICT (id) DO NOTHING`;
    }

    await db`INSERT INTO taxonomy_audit (actor, action, summary, note)
             VALUES (${ACTOR}, ${'import-csv'},
                     ${`CSV merge: ${plan.inserts.length} drafts inserted, ${plan.enrich.length} existing rows enriched, ${plan.merges.length} label matches merged as variants, ${plan.labelConflicts.length} label conflicts refused, ${plan.invalid.length} invalid`},
                     ${JSON.stringify(summarize(plan)).slice(0, 4000)})`;
    res.status(200).json({ ok: true, dryRun: false, ...summarize(plan) });
  } catch (err) {
    res.status(500).json({ error: 'import-csv failed', detail: String(err.message || err) });
  }
}

function summarize(plan) {
  return {
    inserted: plan.inserts.length,
    insertedIds: plan.inserts.map((r) => r.id).slice(0, 500),
    mergedIntoExisting: plan.merges,
    skippedExistingIds: plan.skippedId,
    enriched: plan.enrich.length,
    enrichedVariantAdds: plan.enrich.reduce((n, e) => n + e.addVariants.length, 0),
    labelConflicts: plan.labelConflicts,
    invalid: plan.invalid,
  };
}

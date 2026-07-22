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

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const b = (typeof req.body === 'object' && req.body) || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length || rows.length > 1000) { res.status(400).json({ error: 'rows required (1-1000)' }); return; }
  const dryRun = b.dryRun === true;

  try {
    const db = sql();
    const existing = await db`SELECT id, label, column_name, match_terms FROM taxonomy`;
    const byId = new Set(existing.map((r) => r.id));
    const byLabel = new Map(existing.map((r) => [`${r.column_name}|${String(r.label).trim().toLowerCase()}`, r]));

    const plan = { inserts: [], skippedId: [], merges: [], invalid: [] };
    for (const r of rows) {
      const id = txt(r.id), label = txt(r.label), col = txt(r.column);
      if (!id || !label || !COLUMNS.has(col) || !/^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(id)) {
        plan.invalid.push({ id, label, why: 'missing/invalid id, label, or column' }); continue;
      }
      if (byId.has(id)) { plan.skippedId.push(id); continue; }
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
          ${bool(r.is_gestalt)}, ${txt(r.gestalt_type)}, ${txt(r.gestalt_meaning)}, ${txt(r.gestalt_target_words)},
          ${txt(r.descriptive_clues)}, ${txt(r.audience) || 'universal'}, ${txt(r.authoring_kind) || 'canonical'},
          'draft', ${txt(r.notes)}, ${txt(r.prompt_template) ?? ''},
          ${Number.isFinite(parseInt(r.sort_order, 10)) ? parseInt(r.sort_order, 10) : null}
        ) ON CONFLICT (id) DO NOTHING`;
    }

    await db`INSERT INTO taxonomy_audit (actor, action, summary, note)
             VALUES (${ACTOR}, ${'import-csv'},
                     ${`CSV merge: ${plan.inserts.length} drafts inserted, ${plan.merges.length} label matches merged as variants, ${plan.skippedId.length} ids skipped, ${plan.invalid.length} invalid`},
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
    invalid: plan.invalid,
  };
}

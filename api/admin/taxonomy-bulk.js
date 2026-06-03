// POST /api/admin/taxonomy-bulk — bulk-insert/update rows from a parsed import.
// Body: { rows: [{ id, column, label, ... }, ...],
//         strategy: 'skip' | 'overwrite',
//         defaultStatus: 'draft' | 'published',
//         snapshotLabel?: string,
//         snapshotNote?: string }
//
// Always auto-snapshots the current state first (labeled "pre-import-<ts>"
// unless an explicit label is provided) so the import is reversible.
// Returns counts: { inserted, updated, skipped, errors: [...] }.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

const ACTOR = 'admin';
const VALID_COLUMNS = new Set(['People', 'Nouns', 'Verbs', 'Needs']);
const VALID_SUBJECT_MODES = new Set(['child_as_subject', 'object', 'person', 'concept']);
const VALID_PARENT_PHOTO = new Set(['override', 'supplement', 'none']);
const VALID_STATUS = new Set(['draft', 'published']);
const VALID_PHASES = new Set(['v1_core', 'v1_extended', 'v2', 'later']);
const VALID_GROWTH_STAGES = new Set(['stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5plus']);
const VALID_MEAL = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'anytime']);
const VALID_GESTALT_TYPES = new Set(['compositional', 'category_holding', 'opaque']);
const VALID_AUDIENCE = new Set(['universal', 'parent', 'therapist', 'school_team', 'family']);
const VALID_AUTHORING_KIND = new Set(['canonical', 'personal_skeleton']);
const ID_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const MAX_ROWS = 5000;

function validateRow(r) {
  const errs = [];
  if (typeof r.id !== 'string' || !ID_PATTERN.test(r.id)) errs.push('id pattern');
  if (!VALID_COLUMNS.has(r.column)) errs.push('column');
  if (typeof r.label !== 'string' || !r.label.trim()) errs.push('label');
  if (typeof r.promptTemplate !== 'string' || !r.promptTemplate.trim()) errs.push('promptTemplate');
  if (!VALID_SUBJECT_MODES.has(r.subjectMode)) errs.push('subjectMode');
  if (!VALID_PARENT_PHOTO.has(r.parentPhotoBehavior)) errs.push('parentPhotoBehavior');
  if (r.phase && !VALID_PHASES.has(r.phase)) errs.push('phase');
  if (r.status && !VALID_STATUS.has(r.status)) errs.push('status');
  if (r.growthStage && !VALID_GROWTH_STAGES.has(r.growthStage)) errs.push('growthStage');
  if (r.mealContext && !VALID_MEAL.has(r.mealContext)) errs.push('mealContext');
  if (r.gestaltType && !VALID_GESTALT_TYPES.has(r.gestaltType)) errs.push('gestaltType');
  if (r.audience && !VALID_AUDIENCE.has(r.audience)) errs.push('audience');
  if (r.authoringKind && !VALID_AUTHORING_KIND.has(r.authoringKind)) errs.push('authoringKind');
  return errs;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }

  const body = (typeof req.body === 'object' && req.body) || {};
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || !rows.length) { res.status(400).json({ error: 'rows[] required' }); return; }
  if (rows.length > MAX_ROWS) { res.status(413).json({ error: `Too many rows; max ${MAX_ROWS} per import` }); return; }
  const strategy = body.strategy === 'overwrite' ? 'overwrite' : 'skip';
  const defaultStatus = body.defaultStatus === 'published' ? 'published' : 'draft';
  const snapshotLabel = typeof body.snapshotLabel === 'string' && body.snapshotLabel.trim()
    ? body.snapshotLabel.slice(0, 200)
    : `pre-import-${new Date().toISOString()}`;
  const snapshotNote = typeof body.snapshotNote === 'string' ? body.snapshotNote.slice(0, 2000) : null;

  try {
    const db = sql();

    // 1) Auto-snapshot the current state before we mutate anything.
    const existing = await db`SELECT * FROM taxonomy ORDER BY id`;
    await db`
      INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
      VALUES (${ACTOR}, ${snapshotLabel}, ${snapshotNote}, ${existing.length}, ${JSON.stringify(existing)}::jsonb)
    `;

    // 2) Build a set of existing ids so we can categorize each incoming row.
    const existingIds = new Set(existing.map(r => r.id));

    const errors = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    // 3) Apply each row sequentially. Volume here is tiny; correctness > batching.
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fieldErrs = validateRow(r);
      if (fieldErrs.length) { errors.push({ index: i, id: r.id || null, error: fieldErrs.join(', ') }); continue; }
      const collision = existingIds.has(r.id);
      if (collision && strategy === 'skip') { skipped++; continue; }

      const status = VALID_STATUS.has(r.status) ? r.status : defaultStatus;
      const core = r.core === undefined ? true : !!r.core;   // default to core unless explicitly false
      const isGestalt = !!r.isGestalt;
      // Postgres array fields — leave NULL when omitted (preserves existing on update).
      const targetWords = Array.isArray(r.gestaltTargetWords) ? r.gestaltTargetWords.filter(s => typeof s === 'string' && s.trim()).map(s => s.slice(0, 80)) : null;
      const clues = Array.isArray(r.descriptiveClues) ? r.descriptiveClues.filter(s => typeof s === 'string' && s.trim()).map(s => s.slice(0, 400)) : null;
      const repLevels = r.representationLevels == null ? null : JSON.stringify(r.representationLevels);
      const audience = VALID_AUDIENCE.has(r.audience) ? r.audience : 'universal';
      const authoringKind = VALID_AUTHORING_KIND.has(r.authoringKind) ? r.authoringKind : 'canonical';

      if (collision) {
        await db`
          UPDATE taxonomy SET
            column_name           = ${r.column},
            category              = ${r.category ?? null},
            subcategory           = ${r.subcategory ?? null},
            label                 = ${r.label},
            pronunciation         = ${r.pronunciation ?? null},
            prompt_template       = ${r.promptTemplate},
            subject_mode          = ${r.subjectMode},
            parent_photo_behavior = ${r.parentPhotoBehavior},
            phase                 = ${r.phase ?? 'v1_core'},
            core                  = ${core},
            notes                 = ${r.notes ?? null},
            growth_stage          = ${r.growthStage ?? null},
            meal_context          = ${r.mealContext ?? null},
            is_gestalt            = ${isGestalt},
            gestalt_type          = ${r.gestaltType ?? null},
            gestalt_meaning       = ${r.gestaltMeaning ?? null},
            gestalt_target_words  = ${targetWords},
            descriptive_clues     = ${clues},
            representation_levels = ${repLevels}::jsonb,
            audience              = ${audience},
            authoring_kind        = ${authoringKind},
            status                = ${status},
            archived              = ${!!r.archived},
            updated_at            = NOW(),
            updated_by            = ${ACTOR}
          WHERE id = ${r.id}
        `;
        updated++;
      } else {
        await db`
          INSERT INTO taxonomy (
            id, column_name, category, subcategory, label, pronunciation,
            prompt_template, subject_mode, parent_photo_behavior, phase, core, notes,
            growth_stage, meal_context, is_gestalt, gestalt_type, gestalt_meaning,
            gestalt_target_words, descriptive_clues, representation_levels,
            audience, authoring_kind,
            status, archived, created_by, updated_by
          ) VALUES (
            ${r.id}, ${r.column}, ${r.category ?? null}, ${r.subcategory ?? null},
            ${r.label}, ${r.pronunciation ?? null},
            ${r.promptTemplate}, ${r.subjectMode}, ${r.parentPhotoBehavior},
            ${r.phase ?? 'v1_core'}, ${core}, ${r.notes ?? null},
            ${r.growthStage ?? null}, ${r.mealContext ?? null},
            ${isGestalt}, ${r.gestaltType ?? null}, ${r.gestaltMeaning ?? null},
            ${targetWords}, ${clues}, ${repLevels}::jsonb,
            ${audience}, ${authoringKind},
            ${status}, ${!!r.archived}, ${ACTOR}, ${ACTOR}
          )
        `;
        inserted++;
      }
    }

    const summary = `import: +${inserted} ~${updated} skip:${skipped} err:${errors.length} (${strategy})`;
    await db`
      INSERT INTO taxonomy_audit (actor, action, summary, note)
      VALUES (${ACTOR}, 'import', ${summary}, ${snapshotLabel})
    `;

    res.status(200).json({ ok: true, inserted, updated, skipped, errors, snapshotLabel });
  } catch (err) {
    res.status(500).json({ error: 'Import failed', detail: String(err.message || err) });
  }
}

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
  return errs;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

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
            notes                 = ${r.notes ?? null},
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
            prompt_template, subject_mode, parent_photo_behavior, phase, notes,
            status, archived, created_by, updated_by
          ) VALUES (
            ${r.id}, ${r.column}, ${r.category ?? null}, ${r.subcategory ?? null},
            ${r.label}, ${r.pronunciation ?? null},
            ${r.promptTemplate}, ${r.subjectMode}, ${r.parentPhotoBehavior},
            ${r.phase ?? 'v1_core'}, ${r.notes ?? null},
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

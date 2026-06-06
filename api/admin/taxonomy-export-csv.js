// GET /api/admin/taxonomy-export-csv
// Streams the current DB taxonomy back out in the exact seed-core-v1.csv shape
// so the git repo can stay the long-term record. The format matches the seed:
// array fields are pipe-joined ("a | b | c"), and the column order matches the
// 22-column header used by /taxonomy/apply-authored.mjs.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

const HEADER = [
  'id', 'section', 'category', 'subcategory', 'label', 'pronunciation', 'prompt_template',
  'subject_mode', 'parent_photo_behavior', 'phase', 'core', 'audience', 'authoring_kind',
  'growth_stage', 'meal_context', 'is_gestalt', 'gestalt_type', 'gestalt_meaning',
  'gestalt_target_words', 'descriptive_clues', 'place_kind', 'status',
];

function csvField(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function joinArray(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.map(x => String(x).trim()).filter(Boolean).join(' | ');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  try {
    const db = sql();
    const rows = await db`
      SELECT id, column_name AS section, category, subcategory, label, pronunciation, prompt_template,
             subject_mode, parent_photo_behavior, phase, core, audience, authoring_kind,
             growth_stage, meal_context, is_gestalt, gestalt_type, gestalt_meaning,
             gestalt_target_words, descriptive_clues, place_kind, status
      FROM taxonomy
      WHERE archived = FALSE
      ORDER BY column_name, category, subcategory NULLS FIRST, id
    `;
    const lines = [HEADER.join(',')];
    for (const r of rows) {
      lines.push([
        csvField(r.id),
        csvField(r.section),
        csvField(r.category),
        csvField(r.subcategory),
        csvField(r.label),
        csvField(r.pronunciation),
        csvField(r.prompt_template),
        csvField(r.subject_mode),
        csvField(r.parent_photo_behavior),
        csvField(r.phase),
        csvField(r.core ? 'true' : 'false'),
        csvField(r.audience),
        csvField(r.authoring_kind),
        csvField(r.growth_stage),
        csvField(r.meal_context),
        csvField(r.is_gestalt ? 'true' : 'false'),
        csvField(r.gestalt_type),
        csvField(r.gestalt_meaning),
        csvField(joinArray(r.gestalt_target_words)),
        csvField(joinArray(r.descriptive_clues)),
        csvField(r.place_kind),
        csvField(r.status),
      ].join(','));
    }
    const body = lines.join('\n') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="seed-core-v1.${new Date().toISOString().slice(0,10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(body);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', detail: String(err.message || err) });
  }
}

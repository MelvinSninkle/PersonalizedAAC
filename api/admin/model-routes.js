// /api/admin/model-routes — routing rules that pick an image model based on
// the tile's scope. Resolution order during generation:
//   1. per-row override (taxonomy row's own model field, if set)
//   2. matching model_routes row, highest-priority first
//   3. lab_settings.model_defaults.default
//
// scope_kind: 'tile' (scope_value = taxonomy id),
//             'category' / 'subcategory' / 'section' / 'audience'
//             (scope_value = the matching field on the row).
//
//   GET                        list all routes
//   POST   { scopeKind, scopeValue, model, priority?, notes? }
//   PATCH  ?id=  { model?, priority?, notes? }
//   DELETE ?id=
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

const VALID_SCOPES = new Set(['tile', 'category', 'subcategory', 'section', 'audience']);
const VALID_MODELS = new Set(['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2']);

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  try {
    const db = sql();
    if (req.method === 'GET')    return await list(req, res, db);
    if (req.method === 'POST')   return await add(req, res, db, gate.email);
    if (req.method === 'PATCH')  return await patch(req, res, db);
    if (req.method === 'DELETE') return await remove(req, res, db);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

function rowOut(r) {
  return {
    id: r.id,
    scopeKind: r.scope_kind,
    scopeValue: r.scope_value,
    model: r.model,
    priority: r.priority,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

async function list(req, res, db) {
  const rows = await db`SELECT id, scope_kind, scope_value, model, priority, notes, created_by, created_at FROM model_routes ORDER BY priority DESC, created_at ASC`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ routes: rows.map(rowOut) });
}

async function add(req, res, db, email) {
  const b = (typeof req.body === 'object' && req.body) || {};
  const scopeKind = String(b.scopeKind || '').toLowerCase();
  const scopeValue = String(b.scopeValue || '').trim().slice(0, 120);
  const model = String(b.model || '').trim();
  const priority = Number.isInteger(b.priority) ? b.priority : 100;
  const notes = typeof b.notes === 'string' ? b.notes.slice(0, 400) : null;
  if (!VALID_SCOPES.has(scopeKind)) { res.status(400).json({ error: 'invalid scopeKind', allowed: [...VALID_SCOPES] }); return; }
  if (!scopeValue) { res.status(400).json({ error: 'scopeValue required' }); return; }
  if (!VALID_MODELS.has(model)) { res.status(400).json({ error: 'invalid model', allowed: [...VALID_MODELS] }); return; }
  const r = await db`
    INSERT INTO model_routes (scope_kind, scope_value, model, priority, notes, created_by)
    VALUES (${scopeKind}, ${scopeValue}, ${model}, ${priority}, ${notes}, ${email})
    RETURNING id, scope_kind, scope_value, model, priority, notes, created_by, created_at
  `;
  res.status(200).json({ ok: true, route: rowOut(r[0]) });
}

async function patch(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const b = (typeof req.body === 'object' && req.body) || {};
  const fields = {};
  if (typeof b.model === 'string' && VALID_MODELS.has(b.model)) fields.model = b.model;
  if (Number.isInteger(b.priority)) fields.priority = b.priority;
  if (typeof b.notes === 'string' || b.notes === null) fields.notes = b.notes ? String(b.notes).slice(0, 400) : null;
  if (!Object.keys(fields).length) { res.status(400).json({ error: 'no fields to update' }); return; }
  const r = await db`
    UPDATE model_routes SET
      model    = COALESCE(${fields.model    ?? null}, model),
      priority = COALESCE(${fields.priority ?? null}, priority),
      notes    = CASE WHEN ${'notes' in fields} THEN ${fields.notes ?? null} ELSE notes END
    WHERE id = ${id}
    RETURNING id, scope_kind, scope_value, model, priority, notes, created_by, created_at
  `;
  if (!r.length) { res.status(404).json({ error: 'not found' }); return; }
  res.status(200).json({ ok: true, route: rowOut(r[0]) });
}

async function remove(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  await db`DELETE FROM model_routes WHERE id = ${id}`;
  res.status(200).json({ ok: true });
}

// Helper for /api/admin/lab-generate: given a taxonomy row, resolve which model
// to use, in priority order (per-row override > matching route > default).
// Exported so the generator can call it directly without round-tripping the API.
export async function resolveModelForRow(db, row, defaults) {
  // 1. per-row override columns we may add later (placeholder for symmetry)
  // 2. routes — query in one shot
  const candidates = [];
  candidates.push({ kind: 'tile', value: row.id });
  if (row.category) candidates.push({ kind: 'category', value: row.category });
  if (row.subcategory) candidates.push({ kind: 'subcategory', value: row.subcategory });
  if (row.column_name) candidates.push({ kind: 'section', value: row.column_name });
  if (row.audience) candidates.push({ kind: 'audience', value: row.audience });
  for (const c of candidates) {
    const r = await db`SELECT model FROM model_routes WHERE scope_kind = ${c.kind} AND scope_value = ${c.value} ORDER BY priority DESC LIMIT 1`;
    if (r.length) return r[0].model;
  }
  return (defaults && defaults.default) || 'gpt-image-1.5';
}

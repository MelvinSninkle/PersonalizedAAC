// /api/admin/lab-settings — the singleton row holding the master wrapper
// prompt + global model defaults that the Lab uses to compose every per-tile
// generation. Tokens supported by /api/admin/lab-generate:
//   {style_image}  — handled implicitly by attaching the chosen style guide
//   {content}      — the per-tile prompt_template body (the WHAT)
//   {label}        — the tile's display label, baked into the image as caption
//   {size}         — image size, defaulting to settings.size_default
//   {no_face_rule} — auto-injected guard for inanimate categories
//   {reference}    — kept for compatibility with existing taxonomy templates
//
//   GET                       returns current settings
//   PUT  { masterPrompt?, modelDefaults?, sizeDefault?, notes? }   partial update
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  try {
    const db = sql();
    if (req.method === 'GET') return await get(req, res, db);
    if (req.method === 'PUT') return await put(req, res, db, gate.email);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

function rowOut(r) {
  return {
    masterPrompt: r.master_prompt || '',
    modelDefaults: r.model_defaults || {},
    sizeDefault: r.size_default || '1024x1024',
    notes: r.notes || null,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

async function get(req, res, db) {
  const rows = await db`SELECT master_prompt, model_defaults, size_default, notes, updated_at, updated_by FROM lab_settings WHERE id = 1`;
  res.setHeader('Cache-Control', 'no-store');
  if (!rows.length) {
    // Lazy-init in case the migration hasn't seeded it.
    await db`INSERT INTO lab_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
    const r2 = await db`SELECT master_prompt, model_defaults, size_default, notes, updated_at, updated_by FROM lab_settings WHERE id = 1`;
    res.status(200).json({ settings: rowOut(r2[0] || {}) });
    return;
  }
  res.status(200).json({ settings: rowOut(rows[0]) });
}

async function put(req, res, db, email) {
  const b = (typeof req.body === 'object' && req.body) || {};
  const fields = {};
  if (typeof b.masterPrompt === 'string') fields.master_prompt = b.masterPrompt.slice(0, 8000);
  if (b.modelDefaults && typeof b.modelDefaults === 'object') fields.model_defaults = b.modelDefaults;
  if (typeof b.sizeDefault === 'string') fields.size_default = b.sizeDefault.trim().slice(0, 32);
  if (typeof b.notes === 'string' || b.notes === null) fields.notes = b.notes ? String(b.notes).slice(0, 2000) : null;
  if (!Object.keys(fields).length) { res.status(400).json({ error: 'no fields to update' }); return; }

  // Ensure row exists, then update only the supplied fields via COALESCE.
  await db`INSERT INTO lab_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
  const r = await db`
    UPDATE lab_settings SET
      master_prompt   = COALESCE(${fields.master_prompt   ?? null}, master_prompt),
      model_defaults  = COALESCE(${fields.model_defaults ? JSON.stringify(fields.model_defaults) : null}::jsonb, model_defaults),
      size_default    = COALESCE(${fields.size_default    ?? null}, size_default),
      notes           = CASE WHEN ${'notes' in fields} THEN ${fields.notes ?? null} ELSE notes END,
      updated_at      = NOW(),
      updated_by      = ${email}
    WHERE id = 1
    RETURNING master_prompt, model_defaults, size_default, notes, updated_at, updated_by
  `;
  res.status(200).json({ ok: true, settings: rowOut(r[0]) });
}

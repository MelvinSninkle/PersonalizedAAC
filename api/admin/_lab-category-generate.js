// POST /api/admin/lab-category-generate  { childId, section, label, parent?, model?, styleGuideId? }
// Generate a category chip image and set it as the category's image on the child's
// board, creating the chip if missing. The chosen style guide (styleGuideId, else
// the first active one) rides along as a reference image AND its saved text
// description is appended to the prompt — the same style referencing tile
// generation uses, so chips match the board's art style. Direct-to-board, no
// candidate review. Admin-gated. Thin wrapper over the shared generateCategoryIcon
// (api/_lib/category-icons.js) — the SAME path the bulk batch + onboarding use.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { generateCategoryIcon } from '../_lib/category-icons.js';
import { isGeminiModel } from '../_lib/gemini.js';

const ALLOWED_MODELS = new Set(['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2']);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = String(b.childId || '').slice(0, 64).trim();
  const section = String(b.section || '').toLowerCase().trim();
  const label = String(b.label || '').trim();
  const parentLabel = String(b.parent || '').trim();
  const modelOverride = typeof b.model === 'string' && (ALLOWED_MODELS.has(b.model) || isGeminiModel(b.model)) ? b.model : null;
  const styleGuideId = b.styleGuideId != null ? parseInt(b.styleGuideId, 10) : null;
  const promptOverride = typeof b.promptOverride === 'string' && b.promptOverride.trim() ? b.promptOverride.trim() : null;
  if (!childId || !section || !label) { res.status(400).json({ error: 'childId, section, label required' }); return; }

  try {
    const db = sql();
    const settingsRows = await db`SELECT model_defaults, size_default FROM lab_settings WHERE id = 1`;
    const settings = settingsRows[0] || { model_defaults: {}, size_default: '1024x1024' };
    const model = modelOverride || (settings.model_defaults && (settings.model_defaults.category || settings.model_defaults.default)) || 'gpt-image-1.5';
    const size = settings.size_default || '1024x1024';

    const r = await generateCategoryIcon({
      db, childId, section, label, parentLabel, promptOverride, styleGuideId,
      model, size, actorEmail: gate.email,
    });
    if (!r.ok) { res.status(r.status || 502).json({ error: 'category-generate failed', detail: r.error }); return; }
    res.status(200).json({ ok: true, created: r.created, id: r.id, imageKey: r.imageKey, costCents: r.costCents });
  } catch (err) {
    res.status(502).json({ error: 'category-generate failed', detail: String(err.message || err) });
  }
}

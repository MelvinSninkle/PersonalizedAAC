// /api/admin/keystone-model — the OpenAI gpt-image model used to generate the
// KEYSTONE images (onboarding portraits + scene) in production. Set from the
// Portrait Lab; read live by family.js / scene.js.
//
//   GET → { current, available, fallback }
//       available = the gpt-image-* models THIS OpenAI account actually exposes.
//   PUT { model } → persist as lab_settings.model_defaults.keystone (drives prod)
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { openaiKeystoneModel, listOpenaiImageModels } from '../_lib/openai-image.js';

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  try {
    if (req.method === 'GET') {
      const [current, available] = await Promise.all([
        openaiKeystoneModel(db),
        listOpenaiImageModels(process.env.OPENAI_API_KEY),
      ]);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ current, available, fallback: process.env.OPENAI_KEYSTONE_MODEL || 'gpt-image-1' });
      return;
    }
    if (req.method === 'PUT') {
      const b = (typeof req.body === 'object' && req.body) || {};
      const model = typeof b.model === 'string' ? b.model.trim() : '';
      if (!/^gpt-image[\w.\-]*$/.test(model)) { res.status(400).json({ error: 'model must be a gpt-image-* id' }); return; }
      const row = (await db`SELECT model_defaults FROM lab_settings WHERE id = 1`)[0];
      const md = (row && row.model_defaults) || {};
      md.keystone = model;
      await db`
        INSERT INTO lab_settings (id, model_defaults, updated_at, updated_by)
        VALUES (1, ${JSON.stringify(md)}::jsonb, NOW(), ${gate.email || null})
        ON CONFLICT (id) DO UPDATE SET model_defaults = ${JSON.stringify(md)}::jsonb, updated_at = NOW(), updated_by = ${gate.email || null}`;
      res.status(200).json({ ok: true, current: model });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'keystone-model failed', detail: String(err.message || err) });
  }
}

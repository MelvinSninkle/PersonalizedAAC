// POST /api/admin/lab-category-fill  { childId, force? }
// Batch-generate the curated icon for every category/subcategory chip on a
// child's board that has none yet (or all of them, with force). Processes a
// capped batch per call and returns `remaining`, so the Lab UI can call it
// repeatedly to drain a big board without blowing the function's time ceiling.
// Anchored to the active style guide so the chips match the tiles. Admin-gated.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { buildIconPrompt, readBlobBuffer, generateCategoryIconPNG, uploadIconPNG } from '../_lib/category-icons.js';
import { mapPool } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 300 };
const LIMIT = 12;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY not configured' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = String(b.childId || (req.query && req.query.childId) || '').slice(0, 64).trim();
  const force = b.force === true || String(b.force || (req.query && req.query.force) || '') === '1';
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    const sg = await db`SELECT id, label, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`;
    const style = sg[0] || null;
    const settingsRows = await db`SELECT model_defaults, size_default FROM lab_settings WHERE id = 1`;
    const settings = settingsRows[0] || { model_defaults: {}, size_default: '1024x1024' };
    const model = (settings.model_defaults && settings.model_defaults.category) || 'gpt-image-1.5';
    const size = settings.size_default || '1024x1024';
    let styleBuf = null;
    if (style && style.blob_key) { try { styleBuf = await readBlobBuffer(style.blob_key); } catch (_) {} }

    // Every chip on the child's board, with its parent label for subcategory icons.
    const all = await db`
      SELECT c.id, c.section, c.label, c.image_key, p.label AS parent_label
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE c.child_id = ${childId}
      ORDER BY (c.parent_id IS NOT NULL), c.display_order`;
    const todo = all.filter((c) => force || !c.image_key);
    const batch = todo.slice(0, LIMIT);

    const results = await mapPool(batch, 3, async (c) => {
      const prompt = buildIconPrompt({ label: c.label, parentLabel: c.parent_label, hasStyle: !!style });
      const { b64 } = await generateCategoryIconPNG({ apiKey, prompt, styleBuf, model, size });
      const blobKey = await uploadIconPNG(c.section, b64);
      await db`UPDATE categories SET image_key = ${blobKey}, updated_at = NOW() WHERE id = ${c.id}`;
      try {
        await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
                 VALUES (${'__lab__'}, ${gate.email}, 'admin', ${'[cat] ' + c.label}, ${style ? style.label : 'lab'},
                         ${prompt}, ${size}, ${model === 'gpt-image-2' ? 21 : 13})`;
      } catch (_) {}
      return { id: Number(c.id), label: c.label, parent: c.parent_label || null };
    });

    const done = results.filter((r) => r.ok).map((r) => r.value);
    const failed = results.filter((r) => !r.ok).length;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      generated: done.length,
      failed,
      remaining: Math.max(0, todo.length - done.length),  // re-call until 0 (missing-mode converges)
      total: todo.length,
      did: done,
    });
  } catch (err) {
    res.status(500).json({ error: 'category-fill failed', detail: String(err.message || err) });
  }
}

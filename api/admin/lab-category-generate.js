// POST /api/admin/lab-category-generate  { childId, section, label, parent?, model?, styleGuideId? }
// Generate a category chip image and set it as the category's image on the child's
// board, creating the chip if missing. The chosen style guide (styleGuideId, else
// the first active one) rides along as a reference image AND its saved text
// description is appended to the prompt — the same style referencing tile
// generation uses, so chips match the board's art style. Direct-to-board, no
// candidate review. Admin-gated.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { buildIconPrompt, readBlobBuffer, generateCategoryIconPNG, uploadIconPNG } from '../_lib/category-icons.js';
import { geminiKey, isGeminiModel, geminiCostCents, geminiGenerateImage } from '../_lib/gemini.js';

const ALLOWED_MODELS = new Set(['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2']);
const PRICE = { text: 5, imageIn: 10, out: 40 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY not configured' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = String(b.childId || '').slice(0, 64).trim();
  const section = String(b.section || '').toLowerCase().trim();
  const label = String(b.label || '').trim();
  const parentLabel = String(b.parent || '').trim();
  const modelOverride = typeof b.model === 'string' && (ALLOWED_MODELS.has(b.model) || isGeminiModel(b.model)) ? b.model : null;
  const explicitStyleId = b.styleGuideId != null ? parseInt(b.styleGuideId, 10) : null;
  if (!childId || !section || !label) { res.status(400).json({ error: 'childId, section, label required' }); return; }

  try {
    const db = sql();
    let parentId = null;
    if (parentLabel) {
      const pr = await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id IS NULL AND lower(label) = lower(${parentLabel}) LIMIT 1`;
      if (!pr.length) { res.status(409).json({ error: `Parent category "${parentLabel}" doesn't exist on ${childId}'s board yet — create it first.` }); return; }
      parentId = pr[0].id;
    }

    // Honor an explicitly chosen style (parity with tile generation); else the
    // first active guide. Pull `description` too so the style can be given in words.
    const sg = explicitStyleId
      ? await db`SELECT id, label, description, blob_key FROM style_guides WHERE id = ${explicitStyleId} LIMIT 1`
      : await db`SELECT id, label, description, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`;
    const style = sg[0] || null;
    const styleDesc = (style && style.description) ? String(style.description).trim() : '';
    const settingsRows = await db`SELECT model_defaults, size_default FROM lab_settings WHERE id = 1`;
    const settings = settingsRows[0] || { model_defaults: {}, size_default: '1024x1024' };
    const model = modelOverride || (settings.model_defaults && (settings.model_defaults.category || settings.model_defaults.default)) || 'gpt-image-1.5';
    const size = settings.size_default || '1024x1024';

    // Use the admin's edited prompt when provided (the Lab surfaces the curated
    // prompt for tweaking), else build the curated/generic one.
    const promptOverride = typeof b.promptOverride === 'string' && b.promptOverride.trim() ? b.promptOverride.trim() : null;
    let prompt = promptOverride || buildIconPrompt({ label, parentLabel, hasStyle: !!style, styleDescription: styleDesc });

    let styleBuf = null;
    if (style && style.blob_key) { try { styleBuf = await readBlobBuffer(style.blob_key); } catch (_) {} }
    // Positional legend so the model knows the attached image is the STYLE ref —
    // mirrors the per-tile generator (style in both words and pixels).
    if (styleBuf) {
      prompt += `\n\nThe attached image is the STYLE reference — copy its art style only, not its content.${styleDesc ? ` (Style: ${styleDesc})` : ''}`;
    }

    let b64, usage;
    try {
      if (isGeminiModel(model)) {
        const gKey = geminiKey();
        if (!gKey) { res.status(500).json({ error: 'GEMINI_API_KEY env var not configured' }); return; }
        const g = await geminiGenerateImage({
          apiKey: gKey, model, prompt, aspectRatio: '1:1',
          images: styleBuf ? [{ buffer: styleBuf.buffer, contentType: styleBuf.contentType }] : [],
        });
        if (!g.ok) { res.status(g.status === 429 ? 429 : 502).json({ error: 'category-generate failed', detail: (g.detail || '').slice(0, 1000) }); return; }
        b64 = g.b64; usage = { gemini: true, input_tokens: g.inputTokens, output_tokens: g.outputTokens };
      } else {
        ({ b64, usage } = await generateCategoryIconPNG({ apiKey, prompt, styleBuf, model, size }));
      }
    } catch (e) { res.status(e.status || 502).json({ error: 'category-generate failed', detail: String(e.message || e) }); return; }

    const u = usage || {};
    let costCents;
    if (u.gemini) {
      costCents = geminiCostCents(model);
    } else if (u.output_tokens != null) {
      const det = u.input_tokens_details || {};
      const dollars = ((det.text_tokens || 0) * PRICE.text + (det.image_tokens || 0) * PRICE.imageIn + (u.output_tokens || 0) * PRICE.out) / 1e6;
      costCents = dollars * 100;
    } else { costCents = model === 'gpt-image-2' ? 21 : (model === 'gpt-image-1.5' ? 13 : 4); }

    const blobKey = await uploadIconPNG(section, b64);

    const ex = parentId == null
      ? await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id IS NULL AND lower(label) = lower(${label}) LIMIT 1`
      : await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id = ${parentId} AND lower(label) = lower(${label}) LIMIT 1`;
    let row, created = false;
    if (ex.length) {
      row = await db`UPDATE categories SET image_key = ${blobKey}, updated_at = NOW() WHERE id = ${ex[0].id} RETURNING id, image_key`;
    } else {
      row = await db`INSERT INTO categories (section, label, parent_id, image_key, keep_aspect, display_order, child_id, updated_at)
        VALUES (${section}, ${label}, ${parentId}, ${blobKey}, FALSE, ${Date.now()}, ${childId}, NOW()) RETURNING id, image_key`;
      created = true;
    }
    try {
      await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, reference_keys, size, input_tokens, output_tokens, cost_cents)
        VALUES (${'__lab__'}, ${gate.email}, 'admin', ${'[cat] ' + label}, ${style ? style.label : 'lab'}, ${prompt},
                ${style && style.blob_key ? [style.blob_key] : []}, ${size}, ${u.input_tokens ?? null}, ${u.output_tokens ?? null}, ${costCents})`;
    } catch (_) {}
    res.status(200).json({ ok: true, created, id: Number(row[0].id), imageKey: row[0].image_key, costCents: Number(costCents) });
  } catch (err) {
    res.status(502).json({ error: 'category-generate failed', detail: String(err.message || err) });
  }
}

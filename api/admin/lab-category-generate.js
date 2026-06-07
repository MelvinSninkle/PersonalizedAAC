// POST /api/admin/lab-category-generate  { childId, section, label, parent?, model? }
// Generate a category chip image with OpenAI (using the active style guide as a
// reference, same as tile generation) and set it as the category's image on the
// child's board, creating the chip if missing. Direct-to-board, no candidate
// review. Admin-gated.
import { put, get } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

const ALLOWED_MODELS = new Set(['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2']);
const PRICE = { text: 5, imageIn: 10, out: 40 };

async function readBlob(key) {
  const r = await get(key);
  const buf = Buffer.from(await r.arrayBuffer());
  return { buffer: buf, contentType: r.contentType || 'image/png' };
}

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
  const modelOverride = typeof b.model === 'string' && ALLOWED_MODELS.has(b.model) ? b.model : null;
  if (!childId || !section || !label) { res.status(400).json({ error: 'childId, section, label required' }); return; }

  try {
    const db = sql();
    let parentId = null;
    if (parentLabel) {
      const pr = await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id IS NULL AND lower(label) = lower(${parentLabel}) LIMIT 1`;
      if (!pr.length) { res.status(409).json({ error: `Parent category "${parentLabel}" doesn't exist on ${childId}'s board yet — create it first.` }); return; }
      parentId = pr[0].id;
    }

    const sg = await db`SELECT id, label, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`;
    const style = sg[0] || null;
    const settingsRows = await db`SELECT model_defaults, size_default FROM lab_settings WHERE id = 1`;
    const settings = settingsRows[0] || { model_defaults: {}, size_default: '1024x1024' };
    const model = modelOverride || (settings.model_defaults && settings.model_defaults.category) || 'gpt-image-1.5';
    const size = settings.size_default || '1024x1024';

    const subjectHint = parentLabel ? `the subcategory "${label}" under "${parentLabel}"` : `the category "${label}"`;
    const prompt = `A clear, friendly category icon representing ${subjectHint} for a young child's AAC communication board. Centered, simple, instantly recognizable from a thumbnail. No text or letters in the image. Square composition with generous padding. ${style ? `Match the style of the reference image.` : ''}`;

    let styleBuf = null;
    if (style && style.blob_key) { try { styleBuf = await readBlob(style.blob_key); } catch (_) {} }

    let data;
    if (styleBuf) {
      const fd = new FormData();
      fd.append('model', model);
      fd.append('prompt', prompt);
      fd.append('size', size);
      fd.append('n', '1');
      fd.append('quality', 'high');
      if (model === 'gpt-image-1' || model === 'gpt-image-1.5') fd.append('input_fidelity', 'high');
      fd.append('image[]', new Blob([styleBuf.buffer], { type: styleBuf.contentType }), 'style.jpg');
      const upstream = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: fd,
      });
      if (!upstream.ok) { const detail = await upstream.text().catch(() => ''); res.status(upstream.status).json({ error: 'OpenAI edits failed', detail: detail.slice(0, 500) }); return; }
      data = await upstream.json();
    } else {
      const upstream = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, size, quality: 'high', n: 1 }),
      });
      if (!upstream.ok) { const detail = await upstream.text().catch(() => ''); res.status(upstream.status).json({ error: 'OpenAI generations failed', detail: detail.slice(0, 500) }); return; }
      data = await upstream.json();
    }
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) { res.status(502).json({ error: 'No image returned' }); return; }

    const u = (data && data.usage) || {};
    const det = u.input_tokens_details || {};
    let costCents;
    if (u.output_tokens != null) {
      const dollars = ((det.text_tokens || 0) * PRICE.text + (det.image_tokens || 0) * PRICE.imageIn + (u.output_tokens || 0) * PRICE.out) / 1e6;
      costCents = dollars * 100;
    } else { costCents = model === 'gpt-image-2' ? 21 : (model === 'gpt-image-1.5' ? 13 : 4); }

    const pngBuffer = Buffer.from(b64, 'base64');
    const blobKey = `lab/categories/${section}/${randomUUID()}.png`;
    await put(blobKey, pngBuffer, { access: 'private', contentType: 'image/png', addRandomSuffix: false });

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

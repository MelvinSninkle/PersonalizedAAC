// POST /api/admin/lab-generate
// Body: { taxonomyId, styleGuideId?, model?, promptOverride?, contentOverride?, size? }
//
// Composes the master wrapper prompt from lab_settings with the per-tile content,
// attaches the chosen style guide image as the visual reference, calls OpenAI
// images/edits, uploads the PNG to Blob, and records the result in
// tile_generations (so the QC gallery picks it up) plus image_generations (cost
// log of record). Returns { ok, generation }.
//
// The /admin/lab.html UI calls this once per (tile, style) combination — single
// or "all active styles" — and shows the cost before each click.
import { put, get } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { resolveModelForRow } from './model-routes.js';

// The slowest gpt-image-2 generation can run ~120s; 300s is Vercel Pro's ceiling.
export const config = { maxDuration: 300 };

const ALLOWED_MODELS = new Set(['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2']);
const PRICE = { text: 5, imageIn: 10, out: 40 }; // $/1M tokens, matches generate-image.js

async function readBlob(key) {
  const result = await get(key, { access: 'private' });
  if (result.statusCode !== 200 || !result.stream) throw new Error('blob read failed for ' + key);
  const reader = result.stream.getReader();
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return { buffer: Buffer.concat(chunks), contentType: result.blob.contentType || 'image/jpeg' };
}

// Replace {token} placeholders in the master template. Unknown tokens are left
// as-is (lets the user write notes in the prompt without them being eaten).
function fillTemplate(template, tokens) {
  return String(template || '').replace(/\{([a-z_]+)\}/gi, (m, key) => {
    return Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : m;
  });
}

// Heuristic: which categories should NEVER have anthropomorphic faces added by
// the image model? Object-like categories (dishes, furniture, vehicles, food)
// get a strict "do not add eyes/mouths/faces" guard appended to the prompt.
const NO_FACE_CATEGORIES = new Set([
  'Things', 'Tools', 'Clothes', 'Vehicles', 'Toys', 'Food', 'Snacks', 'Treats',
  'Drinks', 'Furniture', 'Dishes', 'Kitchen', 'Bathroom', 'Money', 'School',
  'Shapes', 'Numbers', 'Alphabet', 'Colors',
]);
function noFaceRule(category) {
  if (NO_FACE_CATEGORIES.has(category)) {
    return 'IMPORTANT: If the subject is an inanimate object, draw it as a plain object — do NOT add eyes, mouths, faces, smiles, or other cartoon human features.';
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY not configured' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const taxonomyId = String(b.taxonomyId || '').trim();
  if (!taxonomyId) { res.status(400).json({ error: 'taxonomyId required' }); return; }
  const explicitStyleId = b.styleGuideId != null ? parseInt(b.styleGuideId, 10) : null;
  const modelOverride = typeof b.model === 'string' && ALLOWED_MODELS.has(b.model) ? b.model : null;
  const promptOverride = typeof b.promptOverride === 'string' ? b.promptOverride : null;
  const contentOverride = typeof b.contentOverride === 'string' ? b.contentOverride : null;
  const sizeOverride = typeof b.size === 'string' ? b.size.trim() : null;

  let db;
  try { db = sql(); } catch (err) { res.status(500).json({ error: 'DB not configured', detail: String(err.message || err) }); return; }

  // 1. Load taxonomy row (the WHAT we're generating)
  const taxRows = await db`
    SELECT id, column_name, category, subcategory, label, pronunciation, prompt_template,
           subject_mode, parent_photo_behavior, audience, descriptive_clues
    FROM taxonomy WHERE id = ${taxonomyId}
  `;
  if (!taxRows.length) { res.status(404).json({ error: 'taxonomy row not found', taxonomyId }); return; }
  const tax = taxRows[0];

  // 2. Pick the style guide (explicit id, or first active by sort_order)
  let style = null;
  if (explicitStyleId) {
    const sg = await db`SELECT id, label, blob_key FROM style_guides WHERE id = ${explicitStyleId}`;
    if (!sg.length) { res.status(404).json({ error: 'style guide not found', styleGuideId: explicitStyleId }); return; }
    style = sg[0];
  } else {
    const sg = await db`SELECT id, label, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`;
    if (sg.length) style = sg[0];
  }

  // 3. Load lab_settings + resolve model
  const settingsRows = await db`SELECT master_prompt, model_defaults, size_default FROM lab_settings WHERE id = 1`;
  const settings = settingsRows[0] || { master_prompt: '', model_defaults: {}, size_default: '1024x1024' };
  const model = modelOverride || (await resolveModelForRow(db, tax, settings.model_defaults || {}));
  const size = sizeOverride || settings.size_default || '1024x1024';

  // 4. Compose the prompt
  const content = contentOverride || tax.prompt_template || `An illustration of ${tax.label}.`;
  let prompt;
  if (promptOverride) {
    prompt = promptOverride;
  } else if (settings.master_prompt) {
    prompt = fillTemplate(settings.master_prompt, {
      content,
      label: tax.label || '',
      size,
      no_face_rule: noFaceRule(tax.category),
      style_image: style ? `(style reference: ${style.label})` : '',
      reference: style ? `(style reference: ${style.label})` : '',
    });
  } else {
    // Fallback if no master prompt is configured yet.
    prompt = `Generate a child-friendly illustration. Subject: ${content}. Bake the label "${tax.label}" along the bottom edge in clean sans-serif. ${noFaceRule(tax.category)}`;
  }

  // 5. Read the style guide image bytes (if we have one)
  let styleBuf = null;
  if (style && style.blob_key) {
    try { styleBuf = await readBlob(style.blob_key); }
    catch (err) { /* missing blob is not fatal — drop to text-only generation */ }
  }

  // 6. Call OpenAI — edits if we have a style ref, generations otherwise
  let data, costCents = null, inTok = null, outTok = null;
  try {
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
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        res.status(upstream.status).json({ error: 'OpenAI edits failed', detail: detail.slice(0, 500) });
        return;
      }
      data = await upstream.json();
    } else {
      const upstream = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, size, quality: 'high', n: 1 }),
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        res.status(upstream.status).json({ error: 'OpenAI generations failed', detail: detail.slice(0, 500) });
        return;
      }
      data = await upstream.json();
    }

    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) { res.status(502).json({ error: 'No image returned from generator' }); return; }

    const u = (data && data.usage) || {};
    const det = u.input_tokens_details || {};
    inTok = u.input_tokens ?? null;
    outTok = u.output_tokens ?? null;
    if (u.output_tokens != null) {
      const dollars = ((det.text_tokens || 0) * PRICE.text + (det.image_tokens || 0) * PRICE.imageIn + (u.output_tokens || 0) * PRICE.out) / 1e6;
      costCents = dollars * 100;
    } else {
      costCents = model === 'gpt-image-2' ? 21 : (model === 'gpt-image-1.5' ? 13 : 4);
    }

    // 7. Save the PNG to Blob
    const pngBuffer = Buffer.from(b64, 'base64');
    const blobKey = `lab/${taxonomyId}/${randomUUID()}.png`;
    await put(blobKey, pngBuffer, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
    const blobUrl = `/api/media?key=${encodeURIComponent(blobKey)}`;

    // 8. Insert into tile_generations (the QC gallery) AND image_generations (cost log).
    const gen = await db`
      INSERT INTO tile_generations
        (taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key, cost_cents, created_by)
      VALUES
        (${taxonomyId}, ${style ? style.id : null}, ${model}, ${prompt}, ${blobUrl}, ${blobKey}, ${costCents}, ${gate.email})
      RETURNING id, taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key,
                rating, marked_best, notes, cost_cents, created_by, created_at
    `;
    try {
      await db`
        INSERT INTO image_generations
          (child_id, actor_email, actor_role, label, style, prompt, reference_keys, size, input_tokens, output_tokens, cost_cents)
        VALUES (${'__lab__'}, ${gate.email}, 'admin', ${tax.label}, ${style ? style.label : 'lab'},
                ${prompt}, ${style && style.blob_key ? [style.blob_key] : []}, ${size}, ${inTok}, ${outTok}, ${costCents})
      `;
    } catch (_) { /* cost log is best-effort */ }

    res.status(200).json({
      ok: true,
      generation: {
        id: gen[0].id,
        taxonomyId: gen[0].taxonomy_id,
        styleGuideId: gen[0].style_guide_id,
        model: gen[0].model,
        promptUsed: gen[0].prompt_used,
        blobUrl: gen[0].blob_url,
        blobKey: gen[0].blob_key,
        rating: gen[0].rating,
        markedBest: !!gen[0].marked_best,
        costCents: gen[0].cost_cents != null ? Number(gen[0].cost_cents) : null,
        createdBy: gen[0].created_by,
        createdAt: gen[0].created_at,
      },
    });
  } catch (err) {
    res.status(502).json({ error: 'Generator request failed', detail: String(err.message || err) });
  }
}

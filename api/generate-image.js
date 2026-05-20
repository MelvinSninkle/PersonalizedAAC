// POST /api/generate-image?label=&style=&childId= — raw photo bytes in the body.
// Re-illustrates the photo in the chosen art style via OpenAI's image model,
// optionally guided by the child's saved reference images, and returns the PNG
// bytes. Every call is logged to image_generations with the prompt and an
// estimated cost (from the model's token usage). Auth-gated; needs OPENAI_API_KEY.
import { get } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REFS = 3;
// gpt-image-1 pricing, USD per 1M tokens.
const PRICE = { text: 5, imageIn: 10, out: 40 };

async function readBlob(key) {
  const result = await get(key, { access: 'private' });
  if (result.statusCode !== 200 || !result.stream) throw new Error('blob read failed');
  const reader = result.stream.getReader();
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return { buffer: Buffer.concat(chunks), contentType: result.blob.contentType || 'image/jpeg' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY env var not configured' });
    return;
  }

  const label = String((req.query && req.query.label) || '').slice(0, 80).trim();
  const style = String((req.query && req.query.style) || 'illustrated').slice(0, 80).trim();
  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);

  let buffer;
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) { res.status(413).json({ error: 'Photo too large', max: MAX_BYTES }); return; }
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  } catch (err) {
    res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) });
    return;
  }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }

  // Load up to MAX_REFS of the child's reference images (best-effort).
  let refKeys = [];
  const refBufs = [];
  try {
    const db = sql();
    const rows = await db`SELECT blob_key FROM reference_images WHERE child_id = ${childId} ORDER BY created_at DESC LIMIT ${MAX_REFS}`;
    refKeys = rows.map((r) => r.blob_key);
    for (const k of refKeys) {
      try { refBufs.push(await readBlob(k)); } catch (_) { /* skip unreadable ref */ }
    }
  } catch (_) { /* no references table/rows yet */ }

  const subject = label ? `"${label}"` : 'the main subject';
  const refClause = refBufs.length
    ? ` Use the additional reference image(s) only as a guide for the art style — do not copy their content.`
    : '';
  const prompt =
    `Re-illustrate this photograph as a ${style} of ${subject} for a young child's ` +
    `communication app. Keep ${subject} clearly recognizable and centered, on a simple, ` +
    `soft, uncluttered background, with bright friendly colors and a gentle, age-appropriate ` +
    `look. Do not include any text, words, or letters in the image.` + refClause;

  let costCents = null, inTok = null, outTok = null;
  try {
    const fd = new FormData();
    fd.append('model', 'gpt-image-1');
    fd.append('prompt', prompt);
    fd.append('size', '1024x1024');
    fd.append('n', '1');
    fd.append('image[]', new Blob([buffer], { type: req.headers['content-type'] || 'image/jpeg' }), 'photo.jpg');
    refBufs.forEach((rb, i) => fd.append('image[]', new Blob([rb.buffer], { type: rb.contentType }), `ref${i}.jpg`));

    const upstream = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: fd,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      res.status(upstream.status).json({ error: 'Image generation failed', detail: detail.slice(0, 500) });
      return;
    }
    const data = await upstream.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) { res.status(502).json({ error: 'No image returned from generator' }); return; }

    // Estimate cost from token usage (falls back to a flat estimate).
    const u = (data && data.usage) || {};
    const det = u.input_tokens_details || {};
    inTok = u.input_tokens ?? null;
    outTok = u.output_tokens ?? null;
    if (u.output_tokens != null) {
      const dollars = ((det.text_tokens || 0) * PRICE.text + (det.image_tokens || 0) * PRICE.imageIn + (u.output_tokens || 0) * PRICE.out) / 1e6;
      costCents = dollars * 100;
    } else {
      costCents = 4; // ~$0.04 fallback for a 1024² image
    }

    // Log the generation (best-effort; never block the response).
    try {
      const db = sql();
      await db`
        INSERT INTO image_generations
          (child_id, actor_email, actor_role, label, style, prompt, reference_keys, size, input_tokens, output_tokens, cost_cents)
        VALUES (${childId}, ${auth.user.email || null}, ${auth.user.role || null}, ${label || null}, ${style},
                ${prompt}, ${refKeys}, '1024x1024', ${inTok}, ${outTok}, ${costCents})
      `;
    } catch (_) { /* logging is non-fatal */ }

    const out = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', out.length);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(out);
  } catch (err) {
    res.status(502).json({ error: 'Generator request failed', detail: String(err.message || err) });
  }
}

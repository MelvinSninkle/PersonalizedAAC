// POST /api/generate-image?label=&style=&childId= — raw photo bytes in the body.
// Re-illustrates the photo in the chosen art style via OpenAI's image model,
// optionally guided by the child's saved reference images, and returns the PNG
// bytes. Every call is logged to image_generations with the prompt and an
// estimated cost (from the model's token usage). Auth-gated; needs OPENAI_API_KEY.
import { get } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

// gpt-image-1.5 / -2 at high quality + input_fidelity:high can legitimately run
// 60-120s for an edit. 300s is Vercel Pro's hard ceiling for serverless
// functions and gives plenty of headroom for the slowest model/quality combos
// without ever cutting OpenAI off mid-generation.
export const config = { api: { bodyParser: false }, maxDuration: 300 };

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REFS = 3;
// OpenAI image model. gpt-image-1.5 (Dec 2025) is the current value-tier model
// (~$0.13/image at high quality) and is much better at edits — it keeps faces /
// the real object consistent. Same /v1/images/* endpoints + params as the old
// gpt-image-1, so this is a drop-in swap. Bump to 'gpt-image-2' (~$0.21/image,
// newest/best) here if you ever want the top tier.
const IMAGE_MODEL = 'gpt-image-1.5';
// Models the client is allowed to request via ?model= (for experimenting from
// the add-tile UI). Anything else falls back to the default above.
const ALLOWED_MODELS = ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2'];
// Approx pricing for the configured model, USD per 1M tokens (cost log only).
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

// Ask the vision model to describe ONLY the generic physical object in the photo
// (shape, colors, materials, layout), explicitly excluding any branded /
// copyrighted character, mascot, or logo. Used to steer the copyright fallback
// so the generic image still resembles the REAL item (a playset, a toy) — just
// without the part that tripped the safety block.
async function describePhotoNeutral(apiKey, buffer, contentType) {
  const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
  const prompt =
    'Describe the single main physical object in this photo for re-illustration: its overall shape, ' +
    'colors, materials, and layout, in one concise sentence. IMPORTANT: do NOT name, reference, or ' +
    'describe any copyrighted, trademarked, or branded character, mascot, logo, or product — describe ' +
    'only the plain generic object. No brand names. Plain text only.';
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ] }],
        max_tokens: 120,
      }),
    });
    if (!resp.ok) return '';
    const data = await resp.json().catch(() => null);
    const txt = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return typeof txt === 'string' ? txt.trim().slice(0, 400) : '';
  } catch (_) { return ''; }
}

// Fallback for when OpenAI's safety system blocks EDITING the source photo
// (copyrighted / branded subjects — Superman, Mario playsets, branded toys).
// We first have vision describe the REAL object in neutral terms, then generate
// a fresh generic illustration from that description — so the tile still looks
// like the actual toy, just without the branded character — and crucially we do
// NOT seed the prompt with example subjects (that is what made a Mario playset
// come back with a superhero next to it). No input photo (that tripped the
// block). Returns { ok, data?, prompt?, detail? }.
async function generateGenericPlaceholder(apiKey, model, label, style, buffer, contentType) {
  const neutral = await describePhotoNeutral(apiKey, buffer, contentType);
  const subject = label ? `"${label}"` : 'the subject';
  const resemble = neutral ? ` Make it closely resemble this real object: ${neutral}` : '';
  const prompt =
    `Create a simple, friendly ${style} illustration of ${subject} for a young child's communication ` +
    `app.${resemble} Draw ONLY a generic, original, unbranded object — do NOT include any copyrighted, ` +
    `trademarked, or branded character, mascot, logo, or product, and do NOT add any extra characters, ` +
    `figures, or mascots that are not physically part of the object itself. Center the subject on a ` +
    `soft, uncluttered background with bright friendly colors and a gentle, age-appropriate look. ` +
    `Do not include any text, words, or letters. ` +
    // Match the main edit prompt: no face on an inanimate object unless the
    // real thing has one (AAC tiles must look like the real object).
    `If the object is inanimate, do NOT add eyes, mouths, faces, or smiles — draw it as a plain ` +
    `object, not a cartoon character.`;
  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1024x1024', quality: 'high', n: 1 }),
    });
  } catch (err) {
    return { ok: false, detail: String(err.message || err) };
  }
  if (!resp.ok) return { ok: false, detail: (await resp.text().catch(() => '')).slice(0, 300) };
  const data = await resp.json().catch(() => null);
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  return b64 ? { ok: true, data, prompt } : { ok: false, detail: 'No image returned from fallback' };
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
  // Per-request model override from the UI; falls back to the default.
  const reqModel = String((req.query && req.query.model) || '').trim();
  const model = ALLOWED_MODELS.includes(reqModel) ? reqModel : IMAGE_MODEL;

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
    `look. Do not include any text, words, or letters in the image. ` +
    // No anthropomorphizing inanimate objects. Without this, gpt-image models
    // routinely add cartoon eyes/smiles to things like ducks (the rubber-toy
    // kind), rockers, vehicles, food, etc. — fine for some toys, but wrong for
    // an AAC board where the tile must represent the REAL object the child sees.
    `If ${subject} is an inanimate object, draw it exactly as it appears in the photo — do NOT add ` +
    `eyes, mouths, faces, smiles, or other cartoon human features. Only draw a face if a face is ` +
    `physically present on the real object in the photo.` + refClause;

  let costCents = null, inTok = null, outTok = null;
  try {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('size', '1024x1024');
    fd.append('n', '1');
    // Best quality, and (for the older models only) preserve the real photo's
    // likeness/details. `input_fidelity` is a gpt-image-1/-1.5 parameter;
    // gpt-image-2 rejects it ("does not support the 'input_fidelity' parameter")
    // because its agentic pipeline handles edit fidelity differently.
    fd.append('quality', 'high');
    if (model === 'gpt-image-1' || model === 'gpt-image-1.5') {
      fd.append('input_fidelity', 'high');
    }
    fd.append('image[]', new Blob([buffer], { type: req.headers['content-type'] || 'image/jpeg' }), 'photo.jpg');
    refBufs.forEach((rb, i) => fd.append('image[]', new Blob([rb.buffer], { type: rb.contentType }), `ref${i}.jpg`));

    const upstream = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: fd,
    });

    let data, usedPrompt = prompt, genericFallback = false;
    if (upstream.ok) {
      data = await upstream.json();
    } else {
      const detail = await upstream.text().catch(() => '');
      // The safety system blocks editing a photo of a copyrighted/branded
      // subject (Superman, branded toys, logos…). Instead of hard-failing, retry
      // from scratch as a GENERIC illustration of the label — no input photo — so
      // the parent still gets a usable placeholder tile.
      const isSafety = /safety system|content[_ ]?policy|moderation_blocked|rejected|violat/i.test(detail);
      if (!isSafety) {
        res.status(upstream.status).json({ error: 'Image generation failed', detail: detail.slice(0, 500) });
        return;
      }
      const fb = await generateGenericPlaceholder(apiKey, model, label, style, buffer, req.headers['content-type'] || 'image/jpeg');
      if (!fb.ok) {
        res.status(upstream.status).json({
          error: 'Image generation failed',
          detail: 'Photo blocked by the safety system (likely a copyrighted/branded subject), and the generic fallback also failed: ' + (fb.detail || ''),
        });
        return;
      }
      data = fb.data; usedPrompt = fb.prompt; genericFallback = true;
    }

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
                ${usedPrompt}, ${refKeys}, '1024x1024', ${inTok}, ${outTok}, ${costCents})
      `;
    } catch (_) { /* logging is non-fatal */ }

    const out = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', out.length);
    res.setHeader('Cache-Control', 'no-store');
    // Lets the client note (if it wants) that this tile is a generic stand-in
    // because the original photo was blocked for copyright.
    if (genericFallback) res.setHeader('X-Generic-Fallback', '1');
    res.status(200).send(out);
  } catch (err) {
    res.status(502).json({ error: 'Generator request failed', detail: String(err.message || err) });
  }
}

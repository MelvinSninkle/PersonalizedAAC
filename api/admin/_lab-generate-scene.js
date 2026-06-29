// POST /api/admin/lab-generate-scene
// The variable subject/style generator. A generation = ONE style + an ordered list
// of subjects, each resolving to its own image source. Composes a single multi-image
// edits call (style first, then each subject), slotting subjects into the prompt by
// position so the model knows "image 2 is Person A, image 3 is Person B…".
//
// Body: {
//   taxonomyId,                 // the tile this candidate belongs to (content + save target)
//   childId,                    // for resolving person anchors
//   styleGuideId?,              // default: first active style guide  (Q1)
//   model?,                     // override; else the tile's route / default
//   scene?,                     // composition text when >1 subject    (Q4)
//   subjects: [                 // ordered; index → role A,B,C…
//     { label?, source: { type:'person', personId } }   // match their anchor   (Q2/Q5)
//     { label?, source: { type:'photo',  blobKey  } }   // stylize a fresh photo (Q3/Q5)
//     { label?, source: { type:'tile',   generationId } } // match prior tile art (Q2)
//     { label?, source: { type:'fresh' } }              // no ref, text only      (Q5 "none")
//   ]
// }
// Admin-gated. Faces ARE allowed here (people scenes) — the object-tile no_face_rule
// deliberately does NOT apply.
import { put, get } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { resolveModelForRow } from './model-routes.js';
import { geminiKey, isGeminiModel, geminiCostCents, geminiGenerateImage } from '../_lib/gemini.js';

const ALLOWED_MODELS = new Set(['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2']);
const PRICE = { text: 5, imageIn: 10, out: 40 };
const MAX_SUBJECTS = 6;

async function readBlob(key) {
  const r = await get(key, { access: 'private' });
  const buf = Buffer.from(await r.arrayBuffer());
  return { buffer: buf, contentType: r.contentType || 'image/png' };
}
const roleLetter = (i) => String.fromCharCode(65 + i); // 0→A, 1→B…

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY not configured' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const taxonomyId = String(b.taxonomyId || '').trim();
  const childId = String(b.childId || '').slice(0, 64).trim();
  if (!taxonomyId) { res.status(400).json({ error: 'taxonomyId required' }); return; }
  const subjectsIn = Array.isArray(b.subjects) ? b.subjects.slice(0, MAX_SUBJECTS) : [];
  if (!subjectsIn.length) { res.status(400).json({ error: 'subjects[] required (use lab-generate for a plain styled tile)' }); return; }
  const explicitStyleId = b.styleGuideId != null ? parseInt(b.styleGuideId, 10) : null;
  const modelOverride = typeof b.model === 'string' && (ALLOWED_MODELS.has(b.model) || isGeminiModel(b.model)) ? b.model : null;
  const sceneText = typeof b.scene === 'string' ? b.scene.trim() : '';

  let db;
  try { db = sql(); } catch (err) { res.status(500).json({ error: 'DB not configured', detail: String(err.message || err) }); return; }

  // 1. Tile row — gives us content + the save target.
  const taxRows = await db`SELECT id, column_name, category, label, prompt_template FROM taxonomy WHERE id = ${taxonomyId}`;
  if (!taxRows.length) { res.status(404).json({ error: 'taxonomy row not found', taxonomyId }); return; }
  const tax = taxRows[0];

  // 2. Style guide (Q1).
  let style = null;
  if (explicitStyleId) {
    const sg = await db`SELECT id, label, blob_key FROM style_guides WHERE id = ${explicitStyleId}`;
    if (sg.length) style = sg[0];
  } else {
    const sg = await db`SELECT id, label, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`;
    if (sg.length) style = sg[0];
  }

  // 3. Resolve each subject's source → { role, label, buf|null, key|null, note }.
  const resolved = [];
  for (let i = 0; i < subjectsIn.length; i++) {
    const s = subjectsIn[i] || {};
    const src = s.source || {};
    const role = roleLetter(i);
    let label = typeof s.label === 'string' ? s.label.trim() : '';
    let key = null;
    try {
      if (src.type === 'person') {
        const pid = parseInt(src.personId, 10);
        const rows = await db`SELECT display_name, given_name, relationship, reference_key FROM persons WHERE id = ${pid} AND child_id = ${childId}`;
        if (!rows.length) { res.status(404).json({ error: `person ${pid} not found for ${childId}`, role }); return; }
        const p = rows[0];
        if (!label) label = p.given_name || p.display_name || ('Person ' + role);
        key = p.reference_key || null;
      } else if (src.type === 'photo') {
        key = String(src.blobKey || '').trim() || null;
        if (!key) { res.status(400).json({ error: `subject ${role}: photo source needs blobKey` }); return; }
      } else if (src.type === 'tile') {
        const gid = parseInt(src.generationId, 10);
        const rows = await db`SELECT blob_key, taxonomy_id FROM tile_generations WHERE id = ${gid}`;
        if (!rows.length) { res.status(404).json({ error: `generation ${gid} not found`, role }); return; }
        key = rows[0].blob_key || null;
      } else if (src.type === 'fresh') {
        key = null;
      } else {
        res.status(400).json({ error: `subject ${role}: unknown source type ${src.type}` }); return;
      }
    } catch (err) {
      res.status(500).json({ error: `subject ${role} resolve failed`, detail: String(err.message || err) }); return;
    }
    let buf = null, note = key ? 'ref' : 'fresh';
    if (key) {
      try { buf = await readBlob(key); }
      catch (_) { note = 'ref-missing'; key = null; } // anchor gone → fall back to text for this subject
    }
    resolved.push({ role, label: label || ('Person ' + role), buf, key, note });
  }

  // 4. Read the style image bytes (Q1).
  let styleBuf = null;
  if (style && style.blob_key) { try { styleBuf = await readBlob(style.blob_key); } catch (_) {} }

  // 5. Build the ordered image[] and a prompt that slots each input by position.
  const images = [];               // { buf, name }
  const lines = [];
  if (styleBuf) {
    images.push({ buf: styleBuf, name: 'style.jpg' });
    lines.push(`Image ${images.length} is the STYLE REFERENCE — copy its artistic style only (line work, color palette, shading, finish). Do NOT copy its subject or content.`);
  }
  for (const r of resolved) {
    if (r.buf) {
      images.push({ buf: r.buf, name: `subj_${r.role}.jpg` });
      lines.push(`Image ${images.length} shows ${r.label} — this is Person ${r.role}. Keep their face and likeness clearly recognizable.`);
    } else {
      lines.push(`Person ${r.role} is ${r.label} — no reference image; draw a friendly, generic, age-appropriate depiction.`);
    }
  }

  const people = resolved.map(r => `Person ${r.role} (${r.label})`).join(', ');
  // Fall back to the tile's prompt_template, but strip the per-child generator's
  // {style}/{reference}/{parent_photo} tokens so they don't reach OpenAI literally.
  const scene = (sceneText || tax.prompt_template || `${people} together`)
    .replace(/\{style\}/gi, 'picture').replace(/\{reference\}/gi, people).replace(/\{parent_photo\}/gi, '');
  const caption = tax.label
    ? `At the very bottom, add a clean caption band with the text "${tax.label}" spelled EXACTLY, in a simple friendly rounded sans-serif, centered. Put no other text, words, or letters anywhere else.`
    : `Do not include any text, words, or letters in the image.`;
  const prompt = [
    ...lines,
    `Compose a single child-friendly illustration for an AAC communication board featuring ${resolved.length} ${resolved.length === 1 ? 'subject' : 'subjects'}: ${people}.`,
    `Scene: ${scene}.`,
    `Centered, on a soft uncluttered background, bright friendly colors, warm and never frightening; everyone clearly visible and recognizable.`,
    caption,
  ].join(' ');

  // 6. Model + size.
  const settingsRows = await db`SELECT model_defaults, size_default FROM lab_settings WHERE id = 1`;
  const settings = settingsRows[0] || { model_defaults: {}, size_default: '1024x1024' };
  const model = modelOverride || (await resolveModelForRow(db, tax, settings.model_defaults || {}));
  const size = settings.size_default || '1024x1024';

  // 7. Generate. edits if we have any image input (style and/or a subject ref); else text-only.
  let data, costCents = null, inTok = null, outTok = null;
  try {
    if (isGeminiModel(model)) {
      const gKey = geminiKey();
      if (!gKey) { res.status(500).json({ error: 'GEMINI_API_KEY env var not configured' }); return; }
      const g = await geminiGenerateImage({
        apiKey: gKey, model, prompt,
        images: images.map(im => ({ buffer: im.buf.buffer, contentType: im.buf.contentType })),
      });
      if (!g.ok) {
        console.error('[lab-generate-scene] gemini failed', g.status, 'model=' + model, g.detail);
        res.status(g.status === 429 ? 429 : 502).json({ error: 'Gemini generation failed', detail: (g.detail || '').slice(0, 1000) });
        return;
      }
      data = { data: [{ b64_json: g.b64 }] };
      inTok = g.inputTokens; outTok = g.outputTokens; costCents = geminiCostCents(model);
    } else if (images.length) {
      const fd = new FormData();
      fd.append('model', model);
      fd.append('prompt', prompt);
      fd.append('size', size);
      fd.append('n', '1');
      fd.append('quality', 'high');
      if (model === 'gpt-image-1' || model === 'gpt-image-1.5') fd.append('input_fidelity', 'high');
      for (const im of images) fd.append('image[]', new Blob([im.buf.buffer], { type: im.buf.contentType }), im.name);
      const upstream = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: fd,
      });
      if (!upstream.ok) { const detail = await upstream.text().catch(() => ''); console.error('[lab-generate-scene] edits failed', upstream.status, 'model=' + model, 'images=' + images.length, detail); res.status(upstream.status).json({ error: 'OpenAI edits failed', detail: detail.slice(0, 1000) }); return; }
      data = await upstream.json();
    } else {
      const upstream = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, size, quality: 'high', n: 1 }),
      });
      if (!upstream.ok) { const detail = await upstream.text().catch(() => ''); console.error('[lab-generate-scene] generations failed', upstream.status, 'model=' + model, detail); res.status(upstream.status).json({ error: 'OpenAI generations failed', detail: detail.slice(0, 1000) }); return; }
      data = await upstream.json();
    }

    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) { res.status(502).json({ error: 'No image returned from generator' }); return; }

    if (costCents == null) {
      const u = (data && data.usage) || {};
      const det = u.input_tokens_details || {};
      inTok = u.input_tokens ?? null; outTok = u.output_tokens ?? null;
      if (u.output_tokens != null) {
        costCents = (((det.text_tokens || 0) * PRICE.text + (det.image_tokens || 0) * PRICE.imageIn + (u.output_tokens || 0) * PRICE.out) / 1e6) * 100;
      } else {
        costCents = model === 'gpt-image-2' ? 21 : (model === 'gpt-image-1.5' ? 13 : 4);
      }
    }

    // 8. Save PNG → Blob, then into tile_generations (the QC strip) + image_generations (cost log).
    const pngBuffer = Buffer.from(b64, 'base64');
    const blobKey = `lab/${taxonomyId}/scene-${randomUUID()}.png`;
    await put(blobKey, pngBuffer, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
    const blobUrl = `/api/media?key=${encodeURIComponent(blobKey)}`;
    const refKeys = [style && style.blob_key, ...resolved.map(r => r.key)].filter(Boolean);

    const gen = await db`
      INSERT INTO tile_generations (taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key, cost_cents, created_by)
      VALUES (${taxonomyId}, ${style ? style.id : null}, ${model}, ${prompt}, ${blobUrl}, ${blobKey}, ${costCents}, ${gate.email})
      RETURNING id, taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key, rating, marked_best, notes, cost_cents, created_by, created_at`;
    try {
      await db`INSERT INTO image_generations
        (child_id, actor_email, actor_role, label, style, prompt, reference_keys, size, input_tokens, output_tokens, cost_cents)
        VALUES (${childId || '__lab__'}, ${gate.email}, 'admin', ${'[scene] ' + (tax.label || '')}, ${style ? style.label : 'lab'},
                ${prompt}, ${refKeys}, ${size}, ${inTok}, ${outTok}, ${costCents})`;
    } catch (_) {}

    const g = gen[0];
    res.status(200).json({
      ok: true,
      subjects: resolved.map(r => ({ role: r.role, label: r.label, resolved: r.note })),
      generation: {
        id: g.id, taxonomyId: g.taxonomy_id, styleGuideId: g.style_guide_id, model: g.model,
        promptUsed: g.prompt_used, blobUrl: g.blob_url, blobKey: g.blob_key,
        rating: g.rating, markedBest: !!g.marked_best,
        costCents: g.cost_cents != null ? Number(g.cost_cents) : null,
        createdBy: g.created_by, createdAt: g.created_at,
      },
    });
  } catch (err) {
    res.status(502).json({ error: 'Scene generation failed', detail: String(err.message || err) });
  }
}

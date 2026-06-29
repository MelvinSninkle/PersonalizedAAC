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
import { geminiKey, isGeminiModel, geminiCostCents, geminiGenerateImage } from '../_lib/gemini.js';
import { sql } from '../_lib/db.js';
import { resolveModelForRow } from './model-routes.js';
import { SQUARE_RULE, captionRule } from '../_lib/onboarding-render.js';

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
  const childId = String(b.childId || '').slice(0, 64).trim();  // board target → resolve subject anchors
  const explicitStyleId = b.styleGuideId != null ? parseInt(b.styleGuideId, 10) : null;
  const modelOverride = typeof b.model === 'string' && (ALLOWED_MODELS.has(b.model) || isGeminiModel(b.model)) ? b.model : null;
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
    const sg = await db`SELECT id, label, description, blob_key FROM style_guides WHERE id = ${explicitStyleId}`;
    if (!sg.length) { res.status(404).json({ error: 'style guide not found', styleGuideId: explicitStyleId }); return; }
    style = sg[0];
  } else {
    const sg = await db`SELECT id, label, description, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`;
    if (sg.length) style = sg[0];
  }

  // 3. Load lab_settings + resolve model
  const settingsRows = await db`SELECT master_prompt, model_defaults, size_default FROM lab_settings WHERE id = 1`;
  const settings = settingsRows[0] || { master_prompt: '', model_defaults: {}, size_default: '1024x1024' };
  const model = modelOverride || (await resolveModelForRow(db, tax, settings.model_defaults || {}));
  const size = sizeOverride || settings.size_default || '1024x1024';

  // 4. Resolve an optional SUBJECT anchor — an already-created image we reference so
  //    the model holds a consistent likeness. subject_mode is largely unset in the
  //    seed, so the reliable "this depicts a person" signals are: a People-section
  //    tile (a specific named person) OR a {reference} token in the prompt (the child).
  let content = contentOverride || tax.prompt_template || `An illustration of ${tax.label}.`;
  const section = String(tax.column_name || '').toLowerCase();
  const mentionsRef = /\{reference\}/i.test(content);
  const mentionsFam = /\{family_adult\}/i.test(content);
  let subject = null;            // { buf, key, name }
  let famSubject = null;         // { buf, key, name } — a close adult family member
  let subjectExpected = false;   // a person was expected → caller can warn if no anchor
  if (childId && (section === 'people' || mentionsRef)) {
    subjectExpected = true;
    try {
      const prow = section === 'people'
        ? (await db`SELECT given_name, display_name, reference_key FROM persons
                    WHERE child_id = ${childId} AND lower(display_name) = lower(${tax.label}) AND reference_key IS NOT NULL LIMIT 1`)[0]
        : (await db`SELECT given_name, display_name, reference_key FROM persons
                    WHERE child_id = ${childId} AND is_self = TRUE AND reference_key IS NOT NULL LIMIT 1`)[0];
      if (prow && prow.reference_key) {
        try {
          const buf = await readBlob(prow.reference_key);
          subject = { buf, key: prow.reference_key, name: prow.given_name || prow.display_name || 'the child' };
        } catch (_) { /* anchor unreadable → fall back to generic */ }
      }
    } catch (err) {
      // Missing persons table / query error must NOT 500 the whole generation —
      // degrade to a generic subject and carry on.
      console.error('[lab-generate] subject anchor lookup failed (continuing generic):', String(err.message || err));
    }
  }

  // {family_adult} → a close family member's likeness anchor. Body parts and
  // caregiving/comfort concepts read better on the adult the child looks at all
  // day than on the child themselves. STRICTLY close family — parents/step-
  // parents/guardians first, then grandparents — never family friends, outside
  // caregivers, or anyone else on the board. Fallback chain: anchored close
  // adult → the child's own anchor → a generic unnamed adult, so the tile
  // always renders and the generic variant stays shareable across children.
  if (childId && mentionsFam) {
    subjectExpected = true;
    try {
      const prow = (await db`
        SELECT given_name, display_name, reference_key FROM persons
        WHERE child_id = ${childId} AND reference_key IS NOT NULL
          AND relationship IN ('mother','father','stepmother','stepfather','guardian','grandmother','grandfather')
        ORDER BY array_position(ARRAY['mother','father','stepmother','stepfather','guardian','grandmother','grandfather']::text[], relationship)
        LIMIT 1`)[0]
        || (await db`SELECT given_name, display_name, reference_key FROM persons
                     WHERE child_id = ${childId} AND is_self = TRUE AND reference_key IS NOT NULL LIMIT 1`)[0];
      if (prow && prow.reference_key) {
        try {
          const buf = await readBlob(prow.reference_key);
          famSubject = { buf, key: prow.reference_key, name: prow.given_name || prow.display_name || 'a family member' };
        } catch (_) { /* unreadable anchor → generic adult */ }
      }
    } catch (err) {
      console.error('[lab-generate] family anchor lookup failed (continuing generic):', String(err.message || err));
    }
  }

  // {reference} → the named subject when we have an anchor, else a generic child so the
  // token never leaks literally; {family_adult}/{style}/{parent_photo} resolved too.
  const refPhrase = subject ? subject.name : 'a friendly young child';
  const famPhrase = famSubject ? famSubject.name : 'a warm, friendly adult family member';
  // {family_all} → generic phrasing for whole-family scenes (event tiles like
  // Christmas / birthday). We don't pass more than two anchored faces yet —
  // the model fills in believable extras around the anchored child + adult.
  content = fillTemplate(content, { style: 'picture', reference: refPhrase, family_adult: famPhrase, family_all: 'the whole family gathered close around', parent_photo: '' });
  // A short text description of the chosen style (saved with the reference image)
  // so the model gets the style in words as well as in the attached pixels.
  const styleDesc = (style && style.description) ? String(style.description).trim() : '';
  const styleDescPhrase = styleDesc ? `Render it in this art style: ${styleDesc}` : '';
  let prompt;
  if (promptOverride) {
    prompt = promptOverride;
  } else if (settings.master_prompt) {
    prompt = fillTemplate(settings.master_prompt, {
      content,
      label: tax.label || '',
      size,
      no_face_rule: (subject || famSubject || mentionsRef || mentionsFam) ? '' : noFaceRule(tax.category),   // a real person SHOULD have a face
      style_image: style ? '(match the art style of the style-reference image)' : '',
      style_description: styleDescPhrase,
      reference: subject ? `(keep the likeness of ${subject.name} from the reference photo)` : '',
    });
  } else {
    // Fallback if no master prompt is configured yet.
    prompt = `Generate a child-friendly illustration. Subject: ${content}. ${styleDescPhrase} ${subject ? '' : noFaceRule(tax.category)}`;
  }
  // Enforce framing + caption in code so they hold regardless of the editable
  // master prompt (skip when the caller supplies a fully custom promptOverride).
  if (!promptOverride) prompt += SQUARE_RULE + captionRule(tax.label);

  // 5. Read the style guide bytes, then assemble the ordered image[] (style first,
  //    subject second) plus a positional legend so the model knows which is which.
  let styleBuf = null;
  if (style && style.blob_key) {
    try { styleBuf = await readBlob(style.blob_key); }
    catch (err) { /* missing blob is not fatal — drop to text-only generation */ }
  }
  const images = [];
  const legend = [];
  if (styleBuf) { images.push({ buf: styleBuf, name: 'style.jpg' }); legend.push(`Image ${images.length} is the STYLE reference — copy its art style only, not its content.${styleDesc ? ` (Style: ${styleDesc})` : ''}`); }
  if (subject) { images.push({ buf: subject.buf, name: 'subject.jpg' }); legend.push(`Image ${images.length} shows ${subject.name} — keep this person's face and likeness clearly recognizable.`); }
  if (famSubject) { images.push({ buf: famSubject.buf, name: 'family.jpg' }); legend.push(`Image ${images.length} shows ${famSubject.name} — keep this person's face and likeness clearly recognizable.`); }
  if (legend.length) prompt += '\n\n' + legend.join(' ');

  // 6. Call the provider — Gemini for gemini-* models (style/subject references
  //    ride along as inline images, same ordered legend); otherwise OpenAI:
  //    edits if we have any reference image, generations otherwise.
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
        console.error('[lab-generate] gemini failed', g.status, 'model=' + model, g.detail);
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
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        console.error('[lab-generate] edits failed', upstream.status, 'model=' + model, detail);
        res.status(upstream.status).json({ error: 'OpenAI edits failed', detail: detail.slice(0, 1000) });
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
        console.error('[lab-generate] generations failed', upstream.status, 'model=' + model, detail);
        res.status(upstream.status).json({ error: 'OpenAI generations failed', detail: detail.slice(0, 1000) });
        return;
      }
      data = await upstream.json();
    }

    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) { res.status(502).json({ error: 'No image returned from generator' }); return; }

    if (costCents == null) {
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
        VALUES (${childId || '__lab__'}, ${gate.email}, 'admin', ${tax.label}, ${style ? style.label : 'lab'},
                ${prompt}, ${[style && style.blob_key, subject && subject.key].filter(Boolean)}, ${size}, ${inTok}, ${outTok}, ${costCents})
      `;
    } catch (_) { /* cost log is best-effort */ }

    res.status(200).json({
      ok: true,
      subject: {
        expected: subjectExpected, referenced: !!subject, name: subject ? subject.name : null,
        family: mentionsFam ? { referenced: !!famSubject, name: famSubject ? famSubject.name : null } : null,
      },
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

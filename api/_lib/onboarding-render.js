// Shared tile renderer for the onboarding flow. Mirrors the admin Lab's
// composition (api/admin/lab-generate.js) — a style-guide reference image plus
// an optional subject anchor (the child's committed portrait) — but self-
// contained and Gemini-only (Nano Banana), so onboarding can generate the
// People portraits AND the Core starter tiles the same way the Lab does, without
// the admin gate. Keeping it here means both the portrait step and the seed step
// share one prompt-composition path.
import { get as blobGet } from '@vercel/blob';
import { geminiKey, geminiDefaultModel, geminiGenerateImage, geminiCostCents } from './gemini.js';

// Read a private Blob fully into memory as { buffer, contentType }.
export async function readBlobBytes(key) {
  const r = await blobGet(key, { access: 'private' });
  if (r.statusCode !== 200 || !r.stream) throw new Error('blob read failed for ' + key);
  const reader = r.stream.getReader();
  const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
  return { buffer: Buffer.concat(chunks), contentType: (r.blob && r.blob.contentType) || 'image/jpeg' };
}

// Pick the style guide the parent chose (explicit id) or the first active one.
// Returns { id, label, blob_key } | null, with the bytes loaded into `.image`.
export async function loadStyleGuide(db, styleGuideId) {
  let row = null;
  if (styleGuideId) {
    row = (await db`SELECT id, label, description, blob_key FROM style_guides WHERE id = ${styleGuideId} AND active = TRUE LIMIT 1`)[0] || null;
  }
  if (!row) {
    row = (await db`SELECT id, label, description, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`)[0] || null;
  }
  if (!row) return null;
  let image = null;
  if (row.blob_key) { try { image = await readBlobBytes(row.blob_key); } catch (_) { /* missing blob → text-only style */ } }
  return { id: Number(row.id), label: row.label, description: row.description || '', blob_key: row.blob_key, image };
}

// Load the child's committed self-portrait as the subject anchor for any tile
// whose prompt references the child ({reference} / child_as_subject / People).
export async function loadChildAnchor(db, childId) {
  try {
    const prow = (await db`SELECT given_name, display_name, reference_key FROM persons
                           WHERE child_id = ${childId} AND is_self = TRUE AND reference_key IS NOT NULL LIMIT 1`)[0];
    if (!prow || !prow.reference_key) return null;
    const bytes = await readBlobBytes(prow.reference_key);
    return { ...bytes, key: prow.reference_key, name: prow.given_name || prow.display_name || 'the child' };
  } catch (_) { return null; }
}

function fillTemplate(template, tokens) {
  return String(template || '').replace(/\{([a-z_]+)\}/gi, (m, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : m);
}

// Every board tile is shown in a small square cell, so generate square art with the
// one subject blown up to fill it — empty space wastes the cell and makes the tile
// hard to read at a glance. Shared by all the photo/taxonomy generators so every
// tile is framed the same way.
export const SQUARE_RULE =
  ' COMPOSITION: render a perfectly SQUARE 1:1 image. There is exactly ONE main subject and ' +
  'it is the absolute priority: place it dead-center and scale it up so it fills almost the ' +
  'entire frame, leaving only a small even margin. Keep the empty space to a minimum — no wide ' +
  'borders, letterboxing, or blank bands on any side, and no clutter or secondary objects ' +
  'competing for attention. The subject must be instantly, unmistakably recognizable to a toddler.';

// Every tile carries the printed word along the bottom. Pinning the lettering to a
// single, identical treatment — black text on a solid white band — is what keeps the
// caption from drifting in font/color/placement across the board. Appended by every
// generator so the rule is enforced in code, not left to the per-tile template.
export function captionRule(label) {
  const word = String(label || '').trim();
  if (!word) return '';
  return ` LABEL: along the very bottom of the image, print the single caption "${word}", ` +
    'spelled exactly, in BLACK lettering on a solid WHITE band that spans the full width — ' +
    'a clean, bold, rounded sans-serif, large enough to read easily. Use this same ' +
    'black-on-white treatment on every tile. The band sits below the subject and must not ' +
    'cover it. Do NOT add any other text, words, letters, numbers, watermarks, or logos.';
}

// Object-like categories must never grow cartoon faces. Mirrors lab-generate.
const NO_FACE_CATEGORIES = new Set([
  'Things', 'Tools', 'Clothes', 'Vehicles', 'Toys', 'Food', 'Snacks', 'Treats',
  'Drinks', 'Furniture', 'Dishes', 'Kitchen', 'Bathroom', 'Money', 'School',
  'Shapes', 'Numbers', 'Alphabet', 'Colors',
]);
function noFaceRule(category) {
  return NO_FACE_CATEGORIES.has(category)
    ? 'IMPORTANT: If the subject is an inanimate object, draw it as a plain object — do NOT add eyes, mouths, faces, smiles, or other cartoon human features.'
    : '';
}

// Render one taxonomy tile. `styleGuide` is the loaded { image, label } (or null),
// `childAnchor` the loaded { buffer, contentType, name } (or null), `settings`
// the lab_settings row. Returns { ok, b64?, contentType?, prompt?, costCents?, model?, detail? }.
export async function renderTaxonomyTile({ tax, styleGuide, childAnchor, settings }) {
  const section = String(tax.column_name || '').toLowerCase();
  let content = tax.prompt_template || `A friendly illustration of ${tax.label}.`;
  const mentionsRef = /\{reference\}/i.test(content);
  const usePerson = section === 'people' || mentionsRef || tax.subject_mode === 'child_as_subject';
  const subject = (usePerson && childAnchor) ? childAnchor : null;

  const refPhrase = subject ? subject.name : 'a friendly young child';
  content = fillTemplate(content, {
    style: 'picture', reference: refPhrase,
    family_adult: 'a warm, friendly adult family member',
    family_all: 'the whole family gathered close', parent_photo: '',
  });

  // A short text description of the chosen style, saved alongside the reference
  // image, so the model gets the style in words AND in pixels (see the legend).
  const styleDesc = (styleGuide && styleGuide.description) ? String(styleGuide.description).trim() : '';
  const styleDescPhrase = styleDesc ? `Render it in this art style: ${styleDesc}` : '';

  const size = (settings && settings.size_default) || '1024x1024';
  let prompt;
  if (settings && settings.master_prompt) {
    prompt = fillTemplate(settings.master_prompt, {
      content,
      label: tax.label || '',
      size,
      no_face_rule: (subject || mentionsRef || usePerson) ? '' : noFaceRule(tax.category),
      style_image: styleGuide ? '(match the art style of the style-reference image)' : '',
      style_description: styleDescPhrase,
      reference: subject ? `(keep the likeness of ${subject.name} from the reference photo)` : '',
    });
  } else {
    prompt = `Generate a child-friendly illustration. Subject: ${content}. ${styleDescPhrase} ${subject ? '' : noFaceRule(tax.category)}`;
  }

  // Ordered images + positional legend (style first, subject second).
  const images = [];
  const legend = [];
  if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
    images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
    legend.push(`Image ${images.length} is the STYLE reference — copy its art style only, not its content.${styleDesc ? ` (Style: ${styleDesc})` : ''}`);
  }
  if (subject && subject.buffer) {
    images.push({ buffer: subject.buffer, contentType: subject.contentType });
    legend.push(`Image ${images.length} shows ${subject.name} — keep this person's face and likeness clearly recognizable.`);
  }
  // Enforce framing + caption in code so they hold regardless of the editable
  // master prompt: square/centered/frame-filling, then the black-on-white label.
  prompt += SQUARE_RULE + captionRule(tax.label);
  if (legend.length) prompt += '\n\n' + legend.join(' ');

  const gKey = geminiKey();
  if (!gKey) return { ok: false, detail: 'GEMINI_API_KEY not configured' };
  const model = geminiDefaultModel();
  const g = await geminiGenerateImage({ apiKey: gKey, model, prompt, images, aspectRatio: '1:1' });
  if (!g.ok) return { ok: false, status: g.status, detail: g.detail };
  return { ok: true, b64: g.b64, contentType: 'image/png', prompt, costCents: geminiCostCents(model), model };
}

// Run `worker` over `items` with at most `limit` in flight. Best-effort: a
// rejected item resolves to its error so one bad tile never sinks the batch.
export async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = { ok: true, value: await worker(items[idx], idx) }; }
      catch (err) { results[idx] = { ok: false, error: err }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// ── Voice ──────────────────────────────────────────────────────────────────

// The child's chosen TTS voice id from child_settings (null → caller default).
export async function loadChildVoiceId(db, childId) {
  try {
    const row = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const v = row && row.settings && row.settings.voiceId;
    return (typeof v === 'string' && v) ? v : null;
  } catch (_) { return null; }
}

// The child's chosen house art style (a style_guides id) from child_settings.
// This is what keeps every tile the parent adds visually consistent with the
// board — the same exemplar image is attached to every generation.
export async function loadChildStyleGuideId(db, childId) {
  try {
    const row = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const v = row && row.settings && row.settings.styleGuideId;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (_) { return null; }
}

// Synthesize `text` to MP3 via ElevenLabs in the chosen voice. Returns a Buffer
// or null — best-effort, so a TTS hiccup never fails a tile (the board falls
// back to the system voice when a tile has no recorded clip).
export async function synthesizeVoice({ text, voiceId } = {}) {
  const key = process.env.Fletchers_AAC_Device;
  if (!key || !text || !String(text).trim()) return null;
  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const mid = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: String(text).slice(0, 300), model_id: mid }),
    });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch (_) { return null; }
}

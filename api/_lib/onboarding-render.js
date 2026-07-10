// Shared tile renderer for the onboarding flow. Mirrors the admin Lab's
// composition (api/admin/lab-generate.js) — a style-guide reference image plus
// an optional subject anchor (the child's committed portrait) — but self-
// contained and Gemini-only (Nano Banana), so onboarding can generate the
// People portraits AND the Core starter tiles the same way the Lab does, without
// the admin gate. Keeping it here means both the portrait step and the seed step
// share one prompt-composition path.
import { get as blobGet, put as blobPut } from '@vercel/blob';
import { createHash } from 'node:crypto';
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
  // person_ref_key / stuff_ref_key are the per-style world references the Lab
  // uploads for pre-built default boards; fall back to the legacy column set
  // when the migration hasn't run so onboarding never breaks on SELECT.
  const cols = async (q) => { try { return await q(true); } catch (_) { return await q(false); } };
  let row = null;
  if (styleGuideId) {
    row = (await cols((ext) => ext
      ? db`SELECT id, label, description, blob_key, person_ref_key, stuff_ref_key FROM style_guides WHERE id = ${styleGuideId} AND active = TRUE LIMIT 1`
      : db`SELECT id, label, description, blob_key FROM style_guides WHERE id = ${styleGuideId} AND active = TRUE LIMIT 1`))[0] || null;
    // A SPECIFIC style was requested but isn't there (deleted / inactive / wrong
    // id). Parents want THEIR exact style — never substitute or go generic. Fail
    // loud so the caller surfaces it and the parent re-picks / re-uploads.
    if (!row) {
      throw Object.assign(
        new Error("We couldn't find the art style you chose. Go back to the style step and pick or re-upload it."),
        { status: 404, code: 'style_not_found' });
    }
  } else {
    // No style chosen → fall back to the first active global template.
    row = (await cols((ext) => ext
      ? db`SELECT id, label, description, blob_key, person_ref_key, stuff_ref_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`
      : db`SELECT id, label, description, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`))[0] || null;
  }
  if (!row) return null;
  let image = null;
  if (row.blob_key) { try { image = await readBlobBytes(row.blob_key); } catch (_) { /* missing blob → text-only style */ } }
  return { id: Number(row.id), label: row.label, description: row.description || '', blob_key: row.blob_key,
           person_ref_key: row.person_ref_key || null, stuff_ref_key: row.stuff_ref_key || null, image };
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

// A tile is "default-able" when its art is identical for every child — it never
// depends on a specific person's photo — so it can share ONE canonical image
// (rendered once in a standard house style) instead of a per-child generation.
// The disqualifiers are the SUBJECT placeholders that pull in a real person —
// {reference} (the child), {parent_photo}, {family_adult}, {family_all} — plus
// the People section and child_as_subject mode. A plain {style} token does NOT
// disqualify a tile: the object/action ("ball", "in", "big") is the same for
// everyone and only the art style would differ, which is exactly what a shared
// default collapses. Mirrors the `usePerson` logic in renderTaxonomyTile so the
// two never disagree. NB: almost every authored prompt contains {style}, so a
// naive "no {placeholder} at all" test would wrongly match nearly nothing.
const PERSON_PLACEHOLDER = /\{(reference|parent_photo|family_adult|family_all)\}/i;
export function isDefaultableTile(tax) {
  if (!tax) return false;
  const section = String(tax.column_name || '').toLowerCase();
  if (section === 'people') return false;
  if (tax.subject_mode === 'child_as_subject') return false;
  return !PERSON_PLACEHOLDER.test(String(tax.prompt_template || ''));
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

// The no-style fallback portrait (used when no style guide image is attached).
export const PORTRAIT_NO_STYLE_BASE =
  "Re-illustrate this photograph as a warm storybook portrait for a young child's communication board. " +
  "Keep the person's face and likeness clearly recognizable; soft even lighting; clean soft pastel pink " +
  "background; centered head-and-shoulders; bright friendly colors; gentle age-appropriate look. " +
  "Do not add any text, words, or letters.";

// SINGLE SOURCE OF TRUTH for the onboarding people-portrait prompt — used by the
// real onboarding flow (api/onboarding/family.js) AND the admin Portrait Lab, so
// the lab faithfully mirrors production. `styleGuide` is the loadStyleGuide()
// result (with `.image` + `.description`); when it has an image the prompt copies
// that style, otherwise it falls back to the warm-storybook base.
export function buildPortraitPrompt({ styleGuide, attempt = 0, guidance = '', ageGroup = null } = {}) {
  const variant = attempt > 0
    ? ` Vary the framing and expression slightly from any previous attempt (attempt ${attempt + 1}).`
    : '';
  const fix = guidance ? ` Important correction from the parent — apply this exactly: ${guidance}.` : '';
  const styleDesc = (styleGuide && styleGuide.description) ? String(styleGuide.description).trim() : '';
  const hasStyleImg = !!(styleGuide && styleGuide.image && styleGuide.image.buffer);
  // AGE ADAPTATION. The style reference (IMAGE 1) shows CHILDREN, and the
  // eye-treatment instruction below is emphatic — without this paragraph the
  // model gives adults the same saucer eyes as the kids. The guidance is
  // deliberately STYLE-RELATIVE, not prescriptive: most animation styles give
  // adults more natural proportions, but some (anime, say) keep stylized eyes
  // for everyone — the style's own adult convention wins, whatever it is.
  // `ageGroup` comes from the relationship (mother → adult) or the capture
  // UI's kid/grown-up choice; when unknown, fall back to "each at their
  // apparent age" so group photos still behave.
  const agePara =
    ageGroup === 'adult'
      ? "\nAGE: the person in IMAGE 2 is an ADULT. IMAGE 1 shows how this art style draws CHILDREN — do not copy " +
        "those child proportions onto this person. Instead, stay consistent with the art style and draw them the " +
        "way THIS STYLE draws its ADULT characters: if cartoons or images in this art style give adults more " +
        "natural proportions — for example more naturally sized eyes, longer faces, adult builds — follow that " +
        "convention faithfully. The result must be unmistakably the same art style AND unmistakably an adult, as " +
        "if this grown-up stepped out of the same film as IMAGE 1's kids."
      : ageGroup === 'child'
      ? "\nAGE: the person in IMAGE 2 is a CHILD. IMAGE 1's treatment is exactly how this style draws children — " +
        "apply its proportions and eye style as shown."
      : "\nAGE: draw every person at their APPARENT AGE, staying consistent with the art style: give children the " +
        "treatment IMAGE 1 shows, and draw adults the way THIS STYLE draws its adult characters — if this art " +
        "style gives adults more natural proportions, follow that convention. Never carry the child proportions " +
        "onto an adult.";
  let prompt;
  if (hasStyleImg) {
    prompt =
      "TASK: Redraw the real person or people shown in IMAGE 2 in the EXACT art style of IMAGE 1.\n" +
      "IMAGE 1 is the STYLE reference. Copy its art style faithfully and obviously: its linework weight and color, " +
      "its flat cel coloring and shading, its proportions and shapes, and ESPECIALLY its eye treatment — match how " +
      "eyes, pupils, and the whites of the eyes are drawn. Also match its BACKGROUND TREATMENT: give this picture " +
      "the same kind of setting, backdrop, and palette that IMAGE 1 uses, so it feels like a scene from the same " +
      "world — do NOT copy IMAGE 1's specific content or the people in it, and do NOT default to a plain empty backdrop. " +
      (styleDesc ? `The style can be described as: ${styleDesc}. ` : '') +
      "\nIMAGE 2 shows ONE person OR A GROUP. Draw EVERY person present in IMAGE 2 — never drop, merge, or add " +
      "anyone; the count of people in your picture must equal the count in the photo. Keep EACH person's IDENTITY " +
      "unmistakable — same skin tone, hair color and hairstyle, face shape, eyebrows, apparent age and sex, and any " +
      "glasses, freckles, or distinctive features — but DRAW every one of those features in IMAGE 1's art style " +
      "(do not render them realistically or in a different cartoon style)." +
      agePara +
      "\nWHY: this is a tile for a young child's AAC communication device; the child has a developmental disability and " +
      "must instantly recognize BOTH these exact people AND the shared art style that helps them focus — so a faithful " +
      "style match and faithful likenesses matter equally.\n" +
      "FRAMING: one person → a centered head-and-shoulders portrait. A group → frame everyone together from the " +
      "waist up, close and warm, each face clearly visible and large enough to recognize. Bright friendly colors, " +
      "no text or letters." + variant;
  } else {
    prompt = PORTRAIT_NO_STYLE_BASE +
      (ageGroup === 'adult'
        ? ' The person is an adult — draw them the way the chosen storybook style draws its adult characters, never with child-like proportions.'
        : '') + variant;
  }
  return prompt + fix + SQUARE_RULE;
}

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
export async function renderTaxonomyTile({ tax, styleGuide, childAnchor, settings, referenceImageKeys = [], worldRefKeys = [], guidance = '', priorKey = null, model = null }) {
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
  // Per-style WORLD references (the Lab's "stuff" scene for an offered style):
  // more of the same art style, so materials/objects render consistently —
  // unlike related-tile refs below, these must NOT force scene matching.
  for (const key of (worldRefKeys || [])) {
    try {
      const bytes = await readBlobBytes(key);
      images.push({ buffer: bytes.buffer, contentType: bytes.contentType });
      legend.push(`Image ${images.length} is ANOTHER STYLE reference from the same world — match how it renders objects, materials, and backgrounds; do not copy its content.`);
    } catch (_) { /* a missing reference never blocks generation */ }
  }
  // Related already-generated tiles (paired concepts like open/close, big/little):
  // attach them so this tile reuses the same setup/composition for a legible pair.
  for (const key of (referenceImageKeys || [])) {
    try {
      const bytes = await readBlobBytes(key);
      images.push({ buffer: bytes.buffer, contentType: bytes.contentType });
      legend.push(`Image ${images.length} is a RELATED tile already drawn — match its scene, composition, and props exactly; change only what this word requires.`);
    } catch (_) { /* a missing reference never blocks generation */ }
  }
  // Guided retry: the PREVIOUS attempt rides along so the model improves the
  // same picture instead of rolling fresh dice, and the parent's correction is
  // applied verbatim. This is what makes a paid retry worth paying for.
  if (priorKey) {
    try {
      const bytes = await readBlobBytes(priorKey);
      images.push({ buffer: bytes.buffer, contentType: bytes.contentType });
      legend.push(`Image ${images.length} is the PREVIOUS attempt at this exact tile — keep what already works, and change it per the parent's correction; do not repeat its mistakes.`);
    } catch (_) { /* missing prior never blocks the retry */ }
  }
  if (guidance) {
    prompt += ` Important correction from the parent — apply this exactly: ${String(guidance).slice(0, 400)}.`;
  }
  // Enforce framing + caption in code so they hold regardless of the editable
  // master prompt: square/centered/frame-filling, then the black-on-white label.
  prompt += SQUARE_RULE + captionRule(tax.label);
  if (legend.length) prompt += '\n\n' + legend.join(' ');

  const gKey = geminiKey();
  if (!gKey) return { ok: false, detail: 'GEMINI_API_KEY not configured' };
  const useModel = model || geminiDefaultModel();
  const g = await geminiGenerateImage({ apiKey: gKey, model: useModel, prompt, images, aspectRatio: '1:1' });
  if (!g.ok) return { ok: false, status: g.status, detail: g.detail };
  return { ok: true, b64: g.b64, contentType: 'image/png', prompt, costCents: geminiCostCents(useModel), model: useModel };
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
// Pass { db, childId } to book the spend in voice_generations so the admin
// Usage tally covers EVERY ElevenLabs call, not just /api/tts (tile voicing is
// part of board builds — logged, never capped).
export async function synthesizeVoice({ text, voiceId, db = null, childId = null, kind = 'tile' } = {}) {
  const key = process.env.Fletchers_AAC_Device;
  if (!key || !text || !String(text).trim()) return null;
  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const mid = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
  const body = String(text).slice(0, 300);
  // Shared render cache — the SAME key scheme /api/tts uses (default emotion),
  // so tile clips and runtime speech share one ElevenLabs generation per
  // (voice, phrase) across EVERY family. Without this, each new board build
  // re-generated the same stock words per account. Callers still copy the
  // bytes into the child's own blob, so account deletion (which wipes a
  // child's media) never touches the shared file another family relies on.
  const cacheKey = 'tts/' + createHash('sha256')
    .update(`${mid}|${vid}|default|${body}`).digest('hex').slice(0, 40) + '.mp3';
  try {
    const cached = await blobGet(cacheKey, { access: 'private' });
    if (cached && cached.statusCode === 200 && cached.stream) {
      const reader = cached.stream.getReader();
      const chunks = [];
      while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
      if (chunks.length) return Buffer.concat(chunks);   // hit: no spend, no metering
    }
  } catch (_) { /* miss → generate */ }
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: body, model_id: mid }),
    });
    if (!r.ok) return null;
    if (db) {
      try {
        const { logVoiceGeneration } = await import('./voice-usage.js');
        const { boardOwnerId } = await import('./credits.js');
        const uid = childId ? await boardOwnerId(db, childId) : null;
        await logVoiceGeneration(db, { userId: uid, childId, chars: body.length, kind, voiceId: vid, text: body });
      } catch (_) { /* metering is best-effort */ }
    }
    const buf = Buffer.from(await r.arrayBuffer());
    try { await blobPut(cacheKey, buf, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false }); } catch (_) {}
    return buf;
  } catch (_) { return null; }
}

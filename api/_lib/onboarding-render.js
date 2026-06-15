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
    row = (await db`SELECT id, label, blob_key FROM style_guides WHERE id = ${styleGuideId} AND active = TRUE LIMIT 1`)[0] || null;
  }
  if (!row) {
    row = (await db`SELECT id, label, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`)[0] || null;
  }
  if (!row) return null;
  let image = null;
  if (row.blob_key) { try { image = await readBlobBytes(row.blob_key); } catch (_) { /* missing blob → text-only style */ } }
  return { id: Number(row.id), label: row.label, blob_key: row.blob_key, image };
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

  const size = (settings && settings.size_default) || '1024x1024';
  let prompt;
  if (settings && settings.master_prompt) {
    prompt = fillTemplate(settings.master_prompt, {
      content,
      label: tax.label || '',
      size,
      no_face_rule: (subject || mentionsRef || usePerson) ? '' : noFaceRule(tax.category),
      style_image: styleGuide ? '(match the art style of the style-reference image)' : '',
      reference: subject ? `(keep the likeness of ${subject.name} from the reference photo)` : '',
    });
  } else {
    prompt = `Generate a child-friendly illustration. Subject: ${content}. ${subject ? '' : noFaceRule(tax.category)}`;
  }

  // Ordered images + positional legend (style first, subject second).
  const images = [];
  const legend = [];
  if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
    images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
    legend.push(`Image ${images.length} is the STYLE reference — copy its art style only, not its content.`);
  }
  if (subject && subject.buffer) {
    images.push({ buffer: subject.buffer, contentType: subject.contentType });
    legend.push(`Image ${images.length} shows ${subject.name} — keep this person's face and likeness clearly recognizable.`);
  }
  if (legend.length) prompt += '\n\n' + legend.join(' ');

  const gKey = geminiKey();
  if (!gKey) return { ok: false, detail: 'GEMINI_API_KEY not configured' };
  const model = geminiDefaultModel();
  const g = await geminiGenerateImage({ apiKey: gKey, model, prompt, images });
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

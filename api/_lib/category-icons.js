// Curated, child-recognizable icons for the board's category + subcategory
// folder chips — the one-level-up companion to the tile symbol vocabulary.
// lab-category-generate uses these (per chip, and looped by the Lab's "Review &
// generate icons") so a known folder gets an INTENTIONAL, consistent icon
// (anchored to the active style guide) instead of a model-invented one. The Lab
// surfaces the prompt for a read-through + edit. Unknown folders fall back to a
// generic "icon representing X" prompt, and overflow folders ("Extended", "…
// more") inherit their parent category's icon.
import { put, get } from '@vercel/blob';
import { geminiKey, isGeminiModel, geminiCostCents, geminiGenerateImage } from './gemini.js';

const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

// Top-level categories (keyed by lowercased label).
export const CATEGORY_ICONS = {
  'core': 'a friendly green check mark beside a red X (yes and no)',
  'adverbs': 'a small running figure with motion lines',
  'animals': 'a happy puppy, kitten, and bunny together',
  'asking': 'a big friendly question mark',
  'body': 'a simple friendly child figure, full body',
  'clothes': 'a t-shirt next to a pair of shoes',
  'describing': 'a magnifying glass over a big bright star next to a small one',
  'feelings': 'a big friendly smiling face',
  'food': 'a red apple next to a sandwich',
  'health': 'a friendly bandage and a small medicine bottle',
  'holidays': 'a wrapped gift with a party balloon',
  'home': 'a cozy little house',
  'learning': 'colorful ABC and 123 blocks stacked',
  'linking': 'two puzzle pieces joining together',
  'money': 'a gold coin next to a dollar bill',
  'music': 'a music note beside a small drum',
  'nature': 'a green tree under a yellow sun',
  'personalize': 'a gold star with a small heart',
  'places': 'a red map pin on a little map',
  'position': 'an open box with a ball and a bold arrow',
  'quantifiers': 'a few dots beside a big pile of dots',
  'school': 'a pencil, a book, and an apple',
  'social': 'two friendly figures waving with a speech bubble between them',
  'therapy': 'a calm blue circle with a small heart',
  'time': 'a friendly round clock face',
  'tools': 'a hammer and a wrench crossed',
  'toys': 'a teddy bear beside building blocks',
  'vehicles': 'a friendly car beside an airplane',
  'community': 'three friendly helper figures (a doctor, a teacher, a mail carrier)',
  'family': 'a small family of figures holding hands',
  'pronouns': 'a figure pointing to itself beside a figure pointing outward',
  'therapy team': 'a friendly clinician figure holding a clipboard',
  'actions': 'a running figure mid-action with motion lines',
  'events': 'a party hat with confetti and balloons',
};

// Subcategories (keyed by bare lowercased label; ambiguous ones may also be
// keyed "parent|sub"). Abstract/grammar subgroups are intentionally omitted so
// they fall back to the parent category's icon.
export const SUBCATEGORY_ICONS = {
  // Animals
  'pets': 'a happy puppy and a kitten side by side',
  'farm': 'a red barn with a cow and a chicken',
  'jungle': 'a friendly lion and a monkey among green leaves',
  'sea': 'a smiling fish over a blue wave',
  'forest': 'a deer and a fox among trees',
  'polar': 'a polar bear and a penguin on ice',
  'bugs': 'a ladybug and a butterfly',
  'dinosaurs': 'a friendly green dinosaur',
  'reptiles & amphibians': 'a green frog beside a little turtle',
  'more mammals': 'a friendly otter and a hedgehog',
  'fish': 'a bright orange clownfish',
  // Body
  'face': 'a simple friendly face with eyes, nose, and mouth',
  'joints': 'a child figure with a bent arm and knee highlighted',
  // Describing
  'core descriptors': 'a big bright star next to a tiny one',
  'opposites': 'a balance scale, one side up and one side down',
  'character': 'a friendly heart with a smile',
  // Food
  'drinks': 'a cup with a straw beside a juice box',
  'fruit': 'a red apple and a yellow banana',
  'fruit more': 'a bunch of purple grapes',
  'vegetables': 'a carrot and a piece of broccoli',
  'veg more': 'a leafy green vegetable',
  'snacks': 'a cracker with a cube of cheese',
  'meals': 'a plate of food with a fork',
  'meals more': 'a steaming bowl of noodles',
  'treats': 'a frosted cupcake with a cherry',
  'condiments': 'a ketchup bottle',
  'breakfast': 'a stack of pancakes with syrup',
  // Home
  'kitchen': 'a stove with a pot on top',
  'mealtime': 'a plate, a fork, and a cup',
  'bathroom': 'a toothbrush and a bar of soap',
  'tech': 'a phone beside a tablet',
  // Learning
  'colors': 'a fan of bright rainbow color swatches',
  'numbers': 'the numbers 1 2 3 in bright blocks',
  'letters': 'the letters A B C in bright blocks',
  'shapes': 'a circle, a square, and a triangle together',
  // Nature
  'plants': 'a green sprout in soil with a small flower',
  'sky': 'a sun, a cloud, and a star in a blue sky',
  // Places
  'outdoor': 'a swing and a slide at a park',
  'geography': 'a globe beside a small mountain',
  // Position
  'prepositions': 'an open box with a ball shown both inside and on top, with arrows',
  'direction': 'a compass with four bold arrows',
  // Time
  'hours': 'a clock face showing one o’clock',
  'clock': 'a friendly round clock face',
  'months': 'a calendar page',
  'seasons': 'a sun, an orange leaf, and a blue snowflake together',
  'units': 'a calendar beside a small clock',
  // Vehicles
  'emergency': 'a fire truck and an ambulance',
  'work': 'a digger and a dump truck',
  'personal': 'a bicycle beside a scooter',
  'air & sea': 'an airplane above a sailboat',
  // People
  'workers': 'a doctor figure and a firefighter figure',
  // Media (Personalize)
  'media (family-authored)': 'a play button on a friendly screen',
};

// Resolve the best icon for a (category, subcategory). For a top-level chip pass
// (label, null); for a subcategory pass (parentLabel, subLabel). Subcategory-
// specific → bare sub → parent category → null (caller uses the generic prompt).
export function iconFor(category, subcategory) {
  const cat = norm(category), sub = norm(subcategory);
  if (sub) {
    if (SUBCATEGORY_ICONS[`${cat}|${sub}`]) return SUBCATEGORY_ICONS[`${cat}|${sub}`];
    if (SUBCATEGORY_ICONS[sub]) return SUBCATEGORY_ICONS[sub];
  }
  return CATEGORY_ICONS[cat] || null;
}

// Build the generation prompt for a category/subcategory chip. When a style guide
// is attached, `styleDescription` (its saved text description) is concatenated so
// the chosen art style is conveyed in words as well as in the reference image —
// the same style referencing the per-tile generator uses.
export function buildIconPrompt({ label, parentLabel, hasStyle, styleDescription }) {
  const icon = parentLabel ? iconFor(parentLabel, label) : iconFor(label, null);
  const subjectHint = parentLabel ? `the subcategory "${label}" under "${parentLabel}"` : `the category "${label}"`;
  const iconClause = icon ? ` The icon should clearly be: ${icon}.` : '';
  const desc = (styleDescription || '').trim();
  const styleClause = hasStyle
    ? ` Match the art style of the reference image.${desc ? ` Render it in this art style: ${desc}` : ''}`
    : '';
  return `A clear, friendly category icon for ${subjectHint} on a young child's AAC communication board.` +
    iconClause +
    ` Centered, simple, and instantly recognizable from a small thumbnail. No text, words, or letters in the image. ` +
    `Square composition: scale the icon up so it fills the frame, leaving only a small even margin — ` +
    `minimal empty space, no wide padding or borders, so it stays easy to read at thumbnail size.${styleClause}`;
}

export async function readBlobBuffer(key) {
  const r = await get(key);
  return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.contentType || 'image/png' };
}

// Generate one chip PNG via OpenAI (style guide attached as an edit reference
// when present). Returns { b64, usage } or throws. Shared by single + batch.
export async function generateCategoryIconPNG({ apiKey, prompt, styleBuf, model, size }) {
  let resp;
  if (styleBuf) {
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', prompt); fd.append('size', size);
    fd.append('n', '1'); fd.append('quality', 'high');
    if (model === 'gpt-image-1' || model === 'gpt-image-1.5') fd.append('input_fidelity', 'high');
    fd.append('image[]', new Blob([styleBuf.buffer], { type: styleBuf.contentType }), 'style.jpg');
    resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: fd,
    });
  } else {
    resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality: 'high', n: 1 }),
    });
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw Object.assign(new Error('OpenAI image failed: ' + detail.slice(0, 300)), { status: resp.status });
  }
  const data = await resp.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('No image returned');
  return { b64, usage: data.usage || {} };
}

export async function uploadIconPNG(section, b64) {
  const { randomUUID } = await import('node:crypto');
  const buffer = Buffer.from(b64, 'base64');
  const blobKey = `lab/categories/${section}/${randomUUID()}.png`;
  await put(blobKey, buffer, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
  return blobKey;
}

// OpenAI image pricing (cents per million tokens) for the cost estimate.
const OPENAI_PRICE = { text: 5, imageIn: 10, out: 40 };

// Resolve a style guide row + its reference-image bytes once, so a batch can load
// the chosen style a single time and pass it to every chip. Returns
// { style, styleBuf } where style is { id, label, description, blob_key } | null.
export async function loadCategoryStyle(db, styleGuideId) {
  const explicit = styleGuideId != null ? parseInt(styleGuideId, 10) : null;
  const rows = explicit
    ? await db`SELECT id, label, description, blob_key FROM style_guides WHERE id = ${explicit} LIMIT 1`
    : await db`SELECT id, label, description, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`;
  const style = rows[0] || null;
  let styleBuf = null;
  if (style && style.blob_key) { try { styleBuf = await readBlobBuffer(style.blob_key); } catch (_) {} }
  return { style, styleBuf };
}

// Generate ONE category/subcategory chip and set it on the child's board — the
// reusable core shared by the single-chip endpoint, the Lab's "Review & generate
// icons", the bulk batch engine, and new-customer onboarding. It resolves the
// parent chip, builds (or accepts an override of) the prompt with the style in
// both words and pixels, generates via Gemini or OpenAI, uploads the PNG, and
// upserts the categories row (find by child/section/parent/label → UPDATE else
// INSERT). `style`/`styleBuf` may be pre-loaded (batch) or loaded here via
// `styleGuideId`. Returns { ok, created, id, blobKey, costCents, prompt } or
// { ok:false, status, error }.
export async function generateCategoryIcon({
  db, childId, section, label, parentLabel = '', promptOverride = null,
  style = undefined, styleBuf = undefined, styleGuideId = null,
  model, size = '1024x1024', actorEmail = null,
}) {
  childId = String(childId || '').slice(0, 64).trim();
  section = String(section || '').toLowerCase().trim();
  label = String(label || '').trim();
  parentLabel = String(parentLabel || '').trim();
  if (!childId || !section || !label) return { ok: false, status: 400, error: 'childId, section, label required' };

  // Resolve the parent chip (subcategories hang off an existing top-level chip).
  let parentId = null;
  if (parentLabel) {
    const pr = await db`SELECT id FROM categories WHERE child_id = ${childId} AND section = ${section} AND parent_id IS NULL AND lower(label) = lower(${parentLabel}) LIMIT 1`;
    if (!pr.length) return { ok: false, status: 409, error: `Parent category "${parentLabel}" doesn't exist on ${childId}'s board yet — create it first.` };
    parentId = pr[0].id;
  }

  // Load the style once if the caller didn't hand it in pre-loaded.
  if (style === undefined) { ({ style, styleBuf } = await loadCategoryStyle(db, styleGuideId)); }
  const styleDesc = (style && style.description) ? String(style.description).trim() : '';

  let prompt = (typeof promptOverride === 'string' && promptOverride.trim())
    ? promptOverride.trim()
    : buildIconPrompt({ label, parentLabel, hasStyle: !!style, styleDescription: styleDesc });
  if (styleBuf) {
    prompt += `\n\nThe attached image is the STYLE reference — copy its art style only, not its content.${styleDesc ? ` (Style: ${styleDesc})` : ''}`;
  }

  // Generate (Gemini or OpenAI) and estimate cost.
  let b64, usage;
  if (isGeminiModel(model)) {
    const gKey = geminiKey();
    if (!gKey) return { ok: false, status: 500, error: 'GEMINI_API_KEY not configured' };
    const g = await geminiGenerateImage({
      apiKey: gKey, model, prompt, aspectRatio: '1:1',
      images: styleBuf ? [{ buffer: styleBuf.buffer, contentType: styleBuf.contentType }] : [],
    });
    if (!g.ok) return { ok: false, status: g.status === 429 ? 429 : 502, error: (g.detail || 'generation failed').slice(0, 1000) };
    b64 = g.b64; usage = { gemini: true, input_tokens: g.inputTokens, output_tokens: g.outputTokens };
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { ok: false, status: 500, error: 'OPENAI_API_KEY not configured' };
    try { ({ b64, usage } = await generateCategoryIconPNG({ apiKey, prompt, styleBuf, model, size })); }
    catch (e) { return { ok: false, status: e.status || 502, error: String(e.message || e) }; }
  }

  const u = usage || {};
  let costCents;
  if (u.gemini) {
    costCents = geminiCostCents(model);
  } else if (u.output_tokens != null) {
    const det = u.input_tokens_details || {};
    costCents = ((det.text_tokens || 0) * OPENAI_PRICE.text + (det.image_tokens || 0) * OPENAI_PRICE.imageIn + (u.output_tokens || 0) * OPENAI_PRICE.out) / 1e6 * 100;
  } else { costCents = model === 'gpt-image-2' ? 21 : (model === 'gpt-image-1.5' ? 13 : 4); }

  const blobKey = await uploadIconPNG(section, b64);

  // Upsert the chip's image on the child's board.
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
      VALUES (${'__lab__'}, ${actorEmail}, 'admin', ${'[cat] ' + label}, ${style ? style.label : 'lab'}, ${prompt},
              ${style && style.blob_key ? [style.blob_key] : []}, ${size}, ${u.input_tokens ?? null}, ${u.output_tokens ?? null}, ${costCents})`;
  } catch (_) {}

  return { ok: true, created, id: Number(row[0].id), blobKey, imageKey: row[0].image_key, costCents: Number(costCents), prompt };
}

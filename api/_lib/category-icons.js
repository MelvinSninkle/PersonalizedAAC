// Curated, child-recognizable icons for the board's category + subcategory
// folder chips — the one-level-up companion to the tile symbol vocabulary.
// lab-category-generate (single) and lab-category-fill (batch) use these so a
// known folder gets an INTENTIONAL, consistent icon (anchored to the active
// style guide) instead of a model-invented one. Unknown folders fall back to a
// generic "icon representing X" prompt, and overflow folders ("Extended", "…
// more") inherit their parent category's icon.
import { put, get } from '@vercel/blob';

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

// Build the generation prompt for a category/subcategory chip.
export function buildIconPrompt({ label, parentLabel, hasStyle }) {
  const icon = parentLabel ? iconFor(parentLabel, label) : iconFor(label, null);
  const subjectHint = parentLabel ? `the subcategory "${label}" under "${parentLabel}"` : `the category "${label}"`;
  const iconClause = icon ? ` The icon should clearly be: ${icon}.` : '';
  return `A clear, friendly category icon for ${subjectHint} on a young child's AAC communication board.` +
    iconClause +
    ` Centered, simple, and instantly recognizable from a small thumbnail. No text, words, or letters in the image. ` +
    `Square composition with generous padding.${hasStyle ? ' Match the art style of the reference image.' : ''}`;
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

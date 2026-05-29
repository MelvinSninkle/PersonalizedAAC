// taxonomy/build-seed.mjs — author the core-vocabulary seed as data + ONE shared
// prompt formula, then emit taxonomy/seed-core-v1.csv (importable at /admin/taxonomy).
//
// Why a generator? The standard tile library will be large and we generate every
// image from prompt_template, so visual consistency matters more than per-row
// prose. Each entry supplies a vivid `subject` clause; the formula adds the shared
// composition/quality/safety rules. {style} is injected by /api/generate-image as
// e.g. "flat picture-book illustration" / "Pixar-style 3D animated render", so the
// template reads "a {style} of <subject>" (no doubled "illustration"). People use
// {reference} (the child) / {parent_photo} (an uploaded person) for the edit path.
//
//   node taxonomy/build-seed.mjs   # rewrites taxonomy/seed-core-v1.csv
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- Shared prompt tails (the consistency backbone) ----
const OBJECT_TAIL =
  'a single clear subject centered and filling most of the frame on a plain soft pastel background; ' +
  'soft even lighting, bright cheerful colors, simple and uncluttered, instantly recognizable to a toddler; ' +
  'no text, letters, numbers, logos, or extra props.';
const ACTION_TAIL =
  'one clear friendly figure centered on a plain soft pastel background; soft even lighting, bright cheerful colors, ' +
  'the meaning obvious at a glance to a toddler; minimal extra detail; no text, letters, or numbers.';
const PORTRAIT_TAIL =
  'a warm, friendly head-and-shoulders portrait with a gentle smile on a plain soft pastel background; ' +
  'soft even lighting; keep them clearly recognizable and kind-looking; no text or letters.';

function promptFor(e) {
  if (e.parentPhotoBehavior === 'override') return `A {style} portrait based on {parent_photo} — ${PORTRAIT_TAIL}`;
  if (e.subjectMode === 'child_as_subject') return `A {style} portrait based on {reference} — ${PORTRAIT_TAIL}`;
  if (e.subjectMode === 'person')           return `A {style} of a friendly ${e.subject}: ${PORTRAIT_TAIL}`;
  if (e.subjectMode === 'concept')          return `A {style} of ${e.subject}, ${ACTION_TAIL}`;
  return `A {style} of ${e.subject}, ${OBJECT_TAIL}`;
}

const rows = [];
// group(column, category, subcategory, idPrefix, defaults, items[])
// item = [idTail, label, subject, opts?]   (opts can override mode/photo/phase/core/pron/notes)
function group(column, category, subcategory, idPrefix, defaults, items) {
  for (const [idTail, label, subject, opts = {}] of items) {
    rows.push({
      id: `${idPrefix}.${idTail}`,
      column, category: category || '', subcategory: subcategory || '',
      label,
      pronunciation: opts.pron || '',
      subjectMode: opts.mode || defaults.mode || 'object',
      parentPhotoBehavior: opts.photo || defaults.photo || 'none',
      phase: opts.phase || defaults.phase || 'v1_core',
      core: opts.core !== undefined ? opts.core : (defaults.core !== undefined ? defaults.core : true),
      subject,
      notes: opts.notes || defaults.notes || '',
    });
  }
}
const EXT = { phase: 'v1_extended', core: false };   // shorthand for non-core / grows-in-later

// ============================ PEOPLE ============================
group('People', 'Family', '', 'people.family', { mode: 'person', photo: 'override' }, [
  ['me', 'Me', '', { mode: 'child_as_subject', photo: 'none', notes: 'Personalize-required: the child, from the onboarding photo.' }],
  ['mom', 'Mom', '', { notes: 'Personalize-required: uploaded parent photo.' }],
  ['dad', 'Dad', '', { notes: 'Personalize-required: uploaded parent photo.' }],
  ['brother', 'Brother', '', EXT],
  ['sister', 'Sister', '', EXT],
  ['baby', 'Baby', '', { ...EXT }],
  ['grandma', 'Grandma', '', EXT],
  ['grandpa', 'Grandpa', '', EXT],
]);
group('People', 'Community', '', 'people.community', { mode: 'person', photo: 'none', ...EXT }, [
  ['friend', 'Friend', 'child friend the same age'],
  ['teacher', 'Teacher', 'teacher'],
  ['doctor', 'Doctor', 'doctor in a white coat'],
]);
group('People', 'Therapy Team', '', 'people.team', { mode: 'person', photo: 'override', ...EXT }, [
  ['therapist', 'Therapist', '', { notes: 'Personalize-required per family.' }],
]);

// ============================ NEEDS — core strip ============================
// High-frequency core vocabulary. Concepts use a clear gesture / sign metaphor.
group('Needs', '', '', 'needs', { mode: 'concept' }, [
  ['more', 'more', 'two friendly hands bringing the fingertips together (the "more" sign)'],
  ['want', 'I want', 'a child reaching out with an open hand toward something off-frame', { pron: 'I want' }],
  ['like', 'I like', 'a smiling child with a thumbs-up and a small heart', { pron: 'I like' }],
  ['dont_like', "I don't like", 'a child gently turning away with a flat refusing hand', { pron: "I don't like" }],
  ['help', 'help', 'a small child reaching up toward a larger helping hand'],
  ['stop', 'stop', 'a friendly flat raised palm in front of a soft red octagon'],
  ['go', 'go', 'a cheerful child stepping forward beside a soft green arrow'],
  ['all_done', 'all done', 'a child holding both open hands up and turning them outward (the "finished" sign)', { pron: 'all done' }],
  ['yes', 'yes', 'a happy child nodding with a thumbs-up'],
  ['no', 'no', 'a child shaking their head with a gentle flat-hand "no"'],
  ['please', 'please', 'a child rubbing a flat hand in a circle on their chest (the "please" sign)'],
  ['thank_you', 'thank you', 'a child touching their chin and extending the hand forward (the "thank you" sign)', { pron: 'thank you' }],
  ['mine', 'mine', 'a child hugging a favorite toy close to their chest'],
  ['my_turn', 'my turn', 'a child pointing both thumbs at themselves', { pron: 'my turn' }],
  ['look', 'look', 'a child pointing to their eyes and then outward (the "look" gesture)'],
  ['again', 'again', 'a child beside a friendly circular repeat arrow'],
  ['open', 'open', 'two hands opening a lid / box'],
  ['give', 'give', 'a hand offering an object forward to "give"'],
  ['eat', 'eat', 'a child bringing food to their mouth'],
  ['drink', 'drink', 'a child sipping from a cup'],
  ['bathroom', 'bathroom', 'a friendly simple toilet icon', { notes: 'Reused by the scheduled potty check-in.' }],
  ['hurt', 'hurt', 'a child pointing to a small bandage (gentle, not distressing)'],
  ['up', 'up', 'a child reaching both arms up with a soft upward arrow'],
  ['down', 'down', 'a child gesturing downward with a soft downward arrow'],
  ['in', 'in', 'a hand placing a small block into an open box', EXT],
  ['out', 'out', 'a hand taking a small block out of an open box', EXT],
  ['here', 'here', 'a child pointing down to a spot right in front of them', EXT],
  ['wait', 'wait', 'a child holding up a patient "wait a moment" flat hand', EXT],
]);

// ============================ NEEDS — feelings / social / describing ============================
group('Needs', 'Feelings', '', 'needs.feelings', { mode: 'concept' }, [
  ['happy', 'happy', 'a child with a big happy smile and bright eyes'],
  ['sad', 'sad', 'a child with a gentle sad face and a single small tear'],
  ['mad', 'mad', 'a child with crossed arms and a mildly frustrated frown (not scary)'],
  ['scared', 'scared', 'a child with wide eyes holding a blanket, mildly worried (gentle)'],
  ['tired', 'tired', 'a yawning child rubbing one eye'],
  ['sick', 'sick', 'a child resting with a thermometer, looking a little under the weather (gentle)'],
  ['silly', 'silly', 'a child making a playful goofy face', EXT],
  ['calm', 'calm', 'a relaxed child breathing peacefully with a soft smile', EXT],
  ['excited', 'excited', 'a delighted child with arms up and a huge grin', EXT],
]);
group('Needs', 'Social', '', 'needs.social', { mode: 'concept', ...EXT }, [
  ['hi', 'hi', 'a child waving hello with a friendly smile'],
  ['bye', 'bye', 'a child waving goodbye'],
  ['sorry', 'sorry', 'a child with a gentle apologetic face, hand on chest'],
  ['love_you', 'I love you', 'a child making a heart shape with both hands', { pron: 'I love you' }],
  ['hug', 'hug', 'two children sharing a warm friendly hug'],
]);
group('Needs', 'Describing', '', 'needs.describe', { mode: 'object', ...EXT }, [
  ['big', 'big', 'a large beach ball next to a tiny one, emphasizing the BIG one'],
  ['little', 'little', 'a tiny ball next to a large one, emphasizing the LITTLE one'],
  ['hot', 'hot', 'a steaming mug with gentle wavy heat lines'],
  ['cold', 'cold', 'a frosty cup with a few soft snowflakes'],
  ['fast', 'fast', 'a toy car zooming with soft motion lines'],
  ['slow', 'slow', 'a friendly snail moving slowly'],
  ['loud', 'loud', 'a smiling child with hands cupped, sound waves coming out'],
  ['quiet', 'quiet', 'a child holding one finger to their lips for "quiet"'],
  ['dirty', 'dirty', 'a single muddy hand with soft dirt smudges'],
  ['clean', 'clean', 'a single sparkling-clean hand with a soft sparkle'],
]);

// ============================ VERBS ============================
group('Verbs', 'Actions', '', 'verbs.actions', { mode: 'concept' }, [
  ['eat', 'eat', 'a happy young child eating with a spoon'],
  ['drink', 'drink', 'a young child drinking from a cup'],
  ['go', 'go', 'a young child walking forward eagerly'],
  ['stop', 'stop', 'a young child standing still with a flat "stop" hand'],
  ['play', 'play', 'a young child happily playing with a toy'],
  ['look', 'look', 'a young child pointing and looking at something'],
  ['open', 'open', 'a young child opening a box lid'],
  ['help', 'help', 'a young child being helped by a friendly adult hand'],
  ['give', 'give', 'a young child handing a toy to someone'],
  ['come', 'come', 'a young child beckoning "come here"'],
  ['sleep', 'sleep', 'a young child sleeping peacefully'],
  ['wash', 'wash', 'a young child washing their hands at a sink'],
  ['run', 'run', 'a young child running happily'],
  ['jump', 'jump', 'a young child mid-jump with joy'],
  ['sit', 'sit', 'a young child sitting on the floor'],
  ['stand', 'stand', 'a young child standing up tall', EXT],
  ['walk', 'walk', 'a young child taking a step to walk', EXT],
  ['throw', 'throw', 'a young child throwing a soft ball', EXT],
  ['catch', 'catch', 'a young child catching a soft ball', EXT],
  ['kick', 'kick', 'a young child kicking a ball', EXT],
  ['read', 'read', 'a young child looking at a picture book'],
  ['sing', 'sing', 'a young child singing happily with music notes', EXT],
  ['dance', 'dance', 'a young child dancing joyfully', EXT],
  ['wave', 'wave', 'a young child waving their hand', EXT],
  ['push', 'push', 'a young child pushing a toy cart', EXT],
  ['pull', 'pull', 'a young child pulling a wagon', EXT],
  ['draw', 'draw', 'a young child drawing with a crayon', EXT],
  ['build', 'build', 'a young child stacking blocks', EXT],
  ['hug', 'hug', 'a young child giving a warm hug', EXT],
  ['brush_teeth', 'brush teeth', 'a young child brushing their teeth', { ...EXT, pron: 'brush teeth' }],
]);

// ============================ NOUNS ============================
group('Nouns', 'Food', 'Drinks', 'nouns.food.drinks', { mode: 'object' }, [
  ['milk', 'milk', 'a single glass of milk', { notes: 'Scene: fridge' }],
  ['water', 'water', 'a single glass of water'],
  ['juice', 'juice', 'a single cup of juice', { notes: 'Scene: fridge' }],
  ['smoothie', 'smoothie', 'a single fruit smoothie in a cup', EXT],
]);
group('Nouns', 'Food', 'Fruit', 'nouns.food.fruit', { mode: 'object', notes: 'Scene: pantry, fridge' }, [
  ['banana', 'banana', 'a single ripe banana'],
  ['apple', 'apple', 'a single red apple'],
  ['grapes', 'grapes', 'a small bunch of grapes'],
  ['orange', 'orange', 'a single orange'],
  ['strawberry', 'strawberry', 'a single strawberry', EXT],
  ['blueberry', 'blueberries', 'a small handful of blueberries', EXT],
]);
group('Nouns', 'Food', 'Vegetables', 'nouns.food.veg', { mode: 'object', notes: 'Scene: fridge', ...EXT }, [
  ['carrot', 'carrot', 'a single carrot'],
  ['broccoli', 'broccoli', 'a single piece of broccoli'],
  ['corn', 'corn', 'a single ear of corn'],
  ['peas', 'peas', 'a small pile of green peas'],
]);
group('Nouns', 'Food', 'Snacks', 'nouns.food.snacks', { mode: 'object', notes: 'Scene: pantry' }, [
  ['cracker', 'cracker', 'a single cracker'],
  ['cereal', 'cereal', 'a bowl of round cereal'],
  ['cheese', 'cheese', 'a single piece of cheese', { notes: 'Scene: fridge' }],
  ['yogurt', 'yogurt', 'a single cup of yogurt', { notes: 'Scene: fridge' }],
  ['cookie', 'cookie', 'a single round cookie'],
  ['chips', 'chips', 'a small handful of potato chips', EXT],
  ['pretzel', 'pretzel', 'a single pretzel', EXT],
]);
group('Nouns', 'Food', 'Meals', 'nouns.food.meals', { mode: 'object', ...EXT }, [
  ['bread', 'bread', 'a single slice of bread'],
  ['pasta', 'pasta', 'a small bowl of pasta'],
  ['pizza', 'pizza', 'a single slice of pizza'],
  ['egg', 'egg', 'a single cooked egg'],
  ['chicken', 'chicken', 'a single piece of cooked chicken'],
  ['rice', 'rice', 'a small bowl of rice'],
  ['sandwich', 'sandwich', 'a single sandwich'],
]);
group('Nouns', 'Toys', '', 'nouns.toys', { mode: 'object', notes: 'Scene: playroom' }, [
  ['ball', 'ball', 'a single colorful ball'],
  ['book', 'book', 'a single picture book', { notes: 'Scene: playroom, bedroom' }],
  ['blocks', 'blocks', 'a small stack of toy blocks'],
  ['car', 'car', 'a single toy car'],
  ['bear', 'bear', 'a single teddy bear', { notes: 'Scene: playroom, bedroom' }],
  ['doll', 'doll', 'a single friendly doll', EXT],
  ['puzzle', 'puzzle', 'a few large puzzle pieces', EXT],
  ['bubbles', 'bubbles', 'a bubble wand making soft bubbles', EXT],
  ['crayons', 'crayons', 'a few colorful crayons', EXT],
  ['train', 'train', 'a single toy train engine', EXT],
]);
group('Nouns', 'Home', '', 'nouns.home', { mode: 'object' }, [
  ['bed', 'bed', "a child's bed", { notes: 'Scene: bedroom. Personalize-recommended.' }],
  ['potty', 'potty', "a child's potty / toilet", { pron: 'potty', notes: 'Scene: bathroom' }],
  ['bath', 'bath', 'a bathtub', { notes: 'Scene: bathroom' }],
  ['cup', 'cup', "a single child's cup", { notes: 'Scene: kitchen. Personalize-recommended.' }],
  ['spoon', 'spoon', 'a single spoon', { notes: 'Scene: kitchen' }],
  ['fork', 'fork', 'a single fork', { ...EXT, notes: 'Scene: kitchen' }],
  ['plate', 'plate', 'a single plate', { ...EXT, notes: 'Scene: kitchen' }],
  ['table', 'table', 'a small table', EXT],
  ['chair', 'chair', "a small child's chair", EXT],
  ['door', 'door', 'a single closed door', EXT],
  ['light', 'light', 'a glowing ceiling light', EXT],
  ['tv', 'TV', 'a television screen', { ...EXT, pron: 'T V', notes: 'Scene: living room' }],
  ['blanket', 'blanket', 'a soft folded blanket', { notes: 'Scene: bedroom' }],
  ['pillow', 'pillow', 'a soft pillow', { ...EXT, notes: 'Scene: bedroom' }],
  ['towel', 'towel', 'a folded towel', { ...EXT, notes: 'Scene: bathroom' }],
  ['soap', 'soap', 'a bar of soap', { ...EXT, notes: 'Scene: bathroom' }],
]);
group('Nouns', 'Body', '', 'nouns.body', { mode: 'object' }, [
  ['hand', 'hand', "a child's open hand"],
  ['foot', 'foot', "a child's bare foot"],
  ['head', 'head', "a child's head"],
  ['tummy', 'tummy', 'a child pointing to their tummy'],
  ['eye', 'eye', "a single friendly eye"],
  ['ear', 'ear', "a child's ear"],
  ['nose', 'nose', "a child's nose"],
  ['mouth', 'mouth', 'a smiling mouth'],
  ['hair', 'hair', "a child's head of hair", EXT],
  ['arm', 'arm', "a child's arm", EXT],
  ['leg', 'leg', "a child's leg", EXT],
  ['teeth', 'teeth', 'a bright smiling set of teeth', EXT],
]);
group('Nouns', 'Clothes', '', 'nouns.clothes', { mode: 'object', ...EXT, notes: 'Non-core category; grows in later. Scene: bedroom.' }, [
  ['shoes', 'shoes', "a pair of children's shoes"],
  ['socks', 'socks', 'a pair of socks'],
  ['shirt', 'shirt', "a child's shirt"],
  ['pants', 'pants', "a pair of child's pants"],
  ['coat', 'coat', "a child's coat"],
  ['hat', 'hat', "a child's hat"],
  ['pajamas', 'pajamas', "a child's pajamas"],
  ['diaper', 'diaper', 'a clean diaper'],
]);
group('Nouns', 'Animals', '', 'nouns.animals', { mode: 'object', ...EXT, notes: 'Non-core category. Personalize-recommended for real pets.' }, [
  ['dog', 'dog', 'a friendly dog'],
  ['cat', 'cat', 'a friendly cat'],
  ['fish', 'fish', 'a single colorful fish'],
  ['bird', 'bird', 'a small friendly bird'],
  ['cow', 'cow', 'a friendly cow'],
  ['horse', 'horse', 'a friendly horse'],
  ['pig', 'pig', 'a friendly pink pig'],
  ['duck', 'duck', 'a friendly yellow duck'],
  ['rabbit', 'rabbit', 'a friendly rabbit'],
  ['lion', 'lion', 'a friendly cartoon lion (gentle, not scary)'],
  ['elephant', 'elephant', 'a friendly cartoon elephant'],
  ['monkey', 'monkey', 'a friendly cartoon monkey'],
]);
group('Nouns', 'Vehicles', '', 'nouns.vehicles', { mode: 'object', ...EXT, notes: 'Non-core category.' }, [
  ['bus', 'bus', 'a friendly yellow school bus'],
  ['truck', 'truck', 'a friendly truck'],
  ['train', 'train', 'a friendly train engine'],
  ['airplane', 'airplane', 'a friendly airplane'],
  ['boat', 'boat', 'a friendly little boat'],
  ['bike', 'bike', "a child's bicycle"],
]);
group('Nouns', 'Nature', '', 'nouns.nature', { mode: 'object', ...EXT, notes: 'Non-core category. Scene: outside.' }, [
  ['sun', 'sun', 'a bright smiling sun'],
  ['moon', 'moon', 'a friendly crescent moon'],
  ['tree', 'tree', 'a single leafy tree'],
  ['flower', 'flower', 'a single cheerful flower'],
  ['rain', 'rain', 'a friendly cloud with falling raindrops'],
  ['snow', 'snow', 'soft falling snowflakes'],
  ['star', 'star', 'a single bright star'],
]);
group('Nouns', 'Places', '', 'nouns.places', { mode: 'object' }, [
  ['outside', 'outside', 'a sunny outdoor yard with grass and sky', { mode: 'concept' }],
  ['park', 'park', 'a friendly playground with a slide and swing', EXT],
  ['school', 'school', 'a friendly school building', EXT],
  ['home', 'home', 'a warm friendly house', EXT],
  ['store', 'store', 'a friendly little shop storefront', EXT],
]);
group('Nouns', 'Colors', '', 'nouns.colors', { mode: 'object', ...EXT, notes: 'Non-core; great for matching games.' }, [
  ['red', 'red', 'a simple rounded shape filled with solid bright red'],
  ['blue', 'blue', 'a simple rounded shape filled with solid bright blue'],
  ['green', 'green', 'a simple rounded shape filled with solid bright green'],
  ['yellow', 'yellow', 'a simple rounded shape filled with solid bright yellow'],
  ['orange', 'orange', 'a simple rounded shape filled with solid bright orange'],
  ['purple', 'purple', 'a simple rounded shape filled with solid bright purple'],
  ['pink', 'pink', 'a simple rounded shape filled with solid bright pink'],
  ['black', 'black', 'a simple rounded shape filled with solid black'],
  ['white', 'white', 'a simple rounded shape filled with solid white (with a soft outline)'],
  ['brown', 'brown', 'a simple rounded shape filled with solid brown'],
]);

// ---------------------------------------------------------------------------
// Validate (mirror the importer's rules) then emit CSV.
const COLUMNS = new Set(['People', 'Nouns', 'Verbs', 'Needs']);
const MODES = new Set(['child_as_subject', 'object', 'person', 'concept']);
const PHOTO = new Set(['override', 'supplement', 'none']);
const ID = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const seen = new Set();
const problems = [];
for (const r of rows) {
  const prompt = promptFor(r);
  if (!ID.test(r.id)) problems.push('bad id ' + r.id);
  if (seen.has(r.id)) problems.push('dup id ' + r.id);
  seen.add(r.id);
  if (!COLUMNS.has(r.column)) problems.push('bad column ' + r.id);
  if (!MODES.has(r.subjectMode)) problems.push('bad mode ' + r.id);
  if (!PHOTO.has(r.parentPhotoBehavior)) problems.push('bad photo ' + r.id);
  if (!r.label) problems.push('empty label ' + r.id);
  if (!prompt.includes('{style}')) problems.push('no {style} ' + r.id);
  // People that personalize from a photo must carry the right token; generic
  // people (teacher/doctor) and all object/concept tiles must have a real subject.
  const portrait = r.parentPhotoBehavior === 'override' || r.subjectMode === 'child_as_subject';
  if (r.parentPhotoBehavior === 'override' && !prompt.includes('{parent_photo}')) problems.push('override w/o {parent_photo} ' + r.id);
  if (r.subjectMode === 'child_as_subject' && !prompt.includes('{reference}')) problems.push('child w/o {reference} ' + r.id);
  if (!portrait && !String(r.subject).trim()) problems.push('empty subject ' + r.id);
  r._prompt = prompt;
}
if (problems.length) { console.error('VALIDATION FAILED:\n' + problems.join('\n')); process.exit(1); }

const HEADER = ['id', 'column', 'category', 'subcategory', 'label', 'pronunciation',
  'subject_mode', 'parent_photo_behavior', 'phase', 'core', 'status', 'prompt_template', 'notes'];
const cell = (s) => {
  s = String(s == null ? '' : s);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const lines = [HEADER.join(',')];
for (const r of rows) {
  lines.push([
    r.id, r.column, r.category, r.subcategory, r.label, r.pronunciation,
    r.subjectMode, r.parentPhotoBehavior, r.phase, r.core ? 'true' : 'false', 'draft',
    r._prompt, r.notes,
  ].map(cell).join(','));
}
const outPath = path.join(HERE, 'seed-core-v1.csv');
fs.writeFileSync(outPath, lines.join('\n') + '\n');

const bySection = {}, byCore = { core: 0, noncore: 0 };
for (const r of rows) { bySection[r.column] = (bySection[r.column] || 0) + 1; byCore[r.core ? 'core' : 'noncore']++; }
console.log(`Wrote ${rows.length} rows → ${path.relative(process.cwd(), outPath)}`);
console.log('By section:', JSON.stringify(bySection));
console.log(`Core: ${byCore.core} · Non-core: ${byCore.noncore}`);

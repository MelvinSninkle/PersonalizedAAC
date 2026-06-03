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
      growthStage: opts.growthStage || defaults.growthStage || null,   // null → STAGE_BY_ID + section defaults later
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

// =============================================================================
// TIER 1 — GRAMMAR ESSENTIALS (PRD §11 / §4.2B)
// Pronouns, question words, linking words, prepositions. All concept-mode and
// global-standard (parent_photo_behavior=none) — these are gestures and
// abstract relations, not personal items. "I" and "my" are flagged as
// personalize candidates in notes (the actual child making the gesture would
// be ideal) but ship as standard for v1 simplicity + global asset cache.
// =============================================================================

// People · Pronouns — grammatical referents to people. Lives in the People
// column so a user reaching for "who" words finds them there.
const STD = { phase: 'v1_core' };
group('People', 'Pronouns', '', 'people.pronouns', { mode: 'concept', photo: 'none', ...STD }, [
  ['i',    'I',    'a friendly young child pointing to their own chest with a thumb, looking at the viewer with a small smile', { growthStage: 'stage_3', notes: 'Personalize candidate: the actual child making the gesture. Paired with WANT to form "I want".' }],
  ['you',  'you',  'a friendly young child with one arm extended forward, open palm gesturing toward the viewer (the "you" gesture)', { growthStage: 'stage_5plus' }],
  ['my',   'my',   'a friendly young child hugging a favorite stuffed animal close to their chest', { growthStage: 'stage_5plus', notes: 'Personalize candidate: the child with their actual favorite object.' }],
  ['your', 'your', 'a friendly young child handing a small object forward to an imagined other, open palms', { growthStage: 'stage_5plus' }],
  ['we',   'we',   'two friendly young children standing close side by side, both smiling at the viewer with arms around each other', { growthStage: 'stage_5plus' }],
  ['they', 'they', 'a small group of three friendly young children together at a slight distance, all smiling at the viewer', { growthStage: 'stage_5plus' }],
  ['he',   'he',   'a friendly young boy facing the viewer with a small wave', { growthStage: 'stage_5plus' }],
  ['she',  'she',  'a friendly young girl facing the viewer with a small wave', { growthStage: 'stage_5plus' }],
]);

// Needs · Asking — question words. Most powerful single category for unlocking
// real conversation ("where's mom?" "what's that?"). All concept-mode with a
// gentle question-mark cue.
group('Needs', 'Asking', '', 'needs.asking', { mode: 'concept', photo: 'none', ...STD }, [
  ['what',  'what',  'a friendly young child with a tilted head and one open hand, a small friendly question mark above their head', { growthStage: 'stage_4' }],
  ['where', 'where', 'a friendly young child looking around with both hands raised palm-up, a small friendly question mark above their head', { growthStage: 'stage_4' }],
  ['who',   'who',   'a friendly young child pointing toward a soft silhouette of a person, a small friendly question mark above', { growthStage: 'stage_5plus' }],
  ['why',   'why',   'a friendly young child with a thoughtful look, finger to chin, a small friendly question mark above their head', { growthStage: 'stage_5plus' }],
  ['when',  'when',  'a friendly young child looking at a simple friendly clock face, a small friendly question mark above their head', { growthStage: 'stage_5plus' }],
  ['how',   'how',   'a friendly young child with both hands up shrugging gently, a small friendly question mark above their head', { growthStage: 'stage_5plus' }],
]);

// Needs · Linking — the abstract grammar particles. Hard to illustrate; we use
// gestures, simple icons, and contrast metaphors. Honest about their abstraction.
group('Needs', 'Linking', '', 'needs.linking', { mode: 'concept', photo: 'none', ...STD }, [
  ['is',      'is',      'two friendly objects with a soft equals sign between them — a ball on the left and the same ball on the right, showing identity'],
  ['can',     'can',     'a friendly young child with one arm flexed showing a small bicep, confident smile, small green check above'],
  ['will',    'will',    'a friendly young child looking forward with a soft forward-pointing arrow toward a future scene'],
  ['a',       'a',       'a single small object (one cheerful ball) gently spotlit on a plain background, soft circular indicator around it'],
  ['the',     'the',     'a specific cheerful ball with a soft glow around it, distinguishing it from background', { notes: 'Definite article — illustrated as "this specific thing".' }],
  ['this',    'this',    'a friendly young child pointing down at a small cheerful object right in front of them'],
  ['that',    'that',    'a friendly young child pointing forward at a small cheerful object in the distance'],
  ['it',      'it',      'a friendly young child gesturing at a small generic cheerful object on a plain surface'],
  ['and',     'and',     'two cheerful objects (a ball and a star) side by side connected by a soft plus-sign'],
  ['but',     'but',     'two cheerful objects with a small contrast mark between them — one is a sun, the other a small cloud'],
  ['because', 'because', 'a soft causal arrow between two small scenes — one event leading to another'],
  ['with',    'with',    'a friendly young child holding hands with a teddy bear close to their side, "together" feeling'],
  ['for',     'for',     'a friendly young child offering a small cheerful gift forward with open palms'],
  ['to',      'to',      'a soft arrow pointing from a friendly young child toward a destination — a small house or playground'],
]);

// Needs (top-level) — spatial prepositions live alongside the existing "in,
// out, up, down, here, wait" because that's where the kid-board already keeps
// position words. Object-mode with two items in clear spatial relation.
group('Needs', '', '', 'needs', { mode: 'concept', photo: 'none', ...STD }, [
  ['on',       'on',       'a cheerful colorful ball resting on top of a small wooden box, clearly above the box'],
  ['under',    'under',    'a cheerful colorful ball under a small wooden table, clearly beneath'],
  ['over',     'over',     'a happy young child mid-jump over a small log on the ground, clearly above'],
  ['behind',   'behind',   'a friendly young child peeking out from behind a single small tree, half-hidden'],
  ['next_to',  'next to',  'two friendly young children standing directly next to each other, arms touching, equal height', { pron: 'next to' }],
  ['between',  'between',  'a friendly young child standing in the middle of two small trees, one on each side'],
]);

// =============================================================================
// TIER 2 — MISSING CATEGORIES (PRD §4.2 + §11)
// Time/calendar, numbers, weather, school — categories every commercial AAC
// system ships and we had zero of.
// =============================================================================

// Needs · Time — abstract time concepts. Concept-mode with friendly clock/sun/
// moon iconography.
const EXT_S5 = { phase: 'v1_extended', core: false, growthStage: 'stage_5plus' };
group('Needs', 'Time', '', 'needs.time', { mode: 'concept', photo: 'none', phase: 'v1_core' }, [
  ['now',       'now',       'a friendly clock face with both hands pointing straight up at 12, with a soft "right now" indicator', { growthStage: 'stage_5plus' }],
  ['later',     'later',     'a friendly clock with a soft forward arrow indicating time advancing to a future point', { growthStage: 'stage_5plus' }],
  ['soon',      'soon',      'a friendly clock with the minute hand close to the top, with a "soon!" gentle hourglass nearby', { growthStage: 'stage_5plus' }],
  ['today',     'today',     'a friendly calendar page with the current day highlighted in a soft warm color, sun above', { growthStage: 'stage_5plus' }],
  ['tomorrow',  'tomorrow',  'a friendly calendar with the day after today highlighted, sunrise icon above', { growthStage: 'stage_5plus' }],
  ['yesterday', 'yesterday', 'a friendly calendar with the previous day highlighted, with a soft past arrow', { growthStage: 'stage_5plus' }],
  ['morning',   'morning',   'a cheerful sunrise scene with a sun rising over a soft horizon, light pastel sky'],
  ['afternoon', 'afternoon', 'a bright sun high in the middle of a soft blue sky, midday feeling', EXT_S5],
  ['night',     'night',     'a friendly crescent moon and a few bright stars in a soft deep-blue sky'],
  ['before',    'before',    'a soft backward-pointing arrow above a friendly clock, indicating "earlier"', EXT_S5],
  ['after',     'after',     'a soft forward-pointing arrow above a friendly clock, indicating "later"', EXT_S5],
]);

// Needs · Numbers — cardinality 1-10. We show the COUNT (N stars/objects) not
// the digit, per the no-text-in-image rule. Distinctive arrangements help
// subitizing (1, 2-3 in a row, 4 in a square, 5 like a die, etc.).
group('Needs', 'Numbers', '', 'needs.numbers', { mode: 'object', photo: 'none', phase: 'v1_core' }, [
  ['one',   '1',  'one large bright friendly yellow star, centered, cheerful'],
  ['two',   '2',  'two large bright stars side by side, equal size, on a plain pastel background'],
  ['three', '3',  'three bright stars arranged in a clear horizontal row, equal spacing'],
  ['four',  '4',  'four colorful balls arranged in a 2-by-2 square grid, equal size'],
  ['five',  '5',  'five bright stars arranged like the 5-face of a die — four corners and one centered'],
  ['six',   '6',  'six small cheerful stars arranged in 2 rows of 3, evenly spaced',  { core: false }],
  ['seven', '7',  'seven small colorful balls arranged with 3 on top, 4 on bottom',    { core: false }],
  ['eight', '8',  'eight small cheerful stars arranged in 2 rows of 4, evenly spaced', { core: false }],
  ['nine',  '9',  'nine colorful blocks arranged in a 3-by-3 grid',                    { core: false }],
  ['ten',   '10', 'ten small bright stars arranged in 2 rows of 5, evenly spaced',     { core: false }],
]);

// Needs · Describing — weather descriptors. Sit alongside the existing
// big/little/hot/cold so a child describes the day the same way they describe
// any quality. Object-mode with weather scenes.
group('Needs', 'Describing', '', 'needs.describe.weather', { mode: 'object', photo: 'none', phase: 'v1_extended', core: false }, [
  ['sunny',  'sunny',  'a bright cheerful sun shining in a clear soft-blue sky, light beams radiating', { growthStage: 'stage_5plus' }],
  ['cloudy', 'cloudy', 'fluffy white clouds covering most of a soft pale-blue sky', { growthStage: 'stage_5plus' }],
  ['rainy',  'rainy',  'a friendly grey cloud with steady raindrops falling onto a small puddle below', { growthStage: 'stage_5plus' }],
  ['snowy',  'snowy',  'soft white snowflakes falling from a pale sky onto a thin blanket of snow', { growthStage: 'stage_5plus' }],
  ['windy',  'windy',  'leaves and a small kite tail flying sideways through the air, soft motion lines', { growthStage: 'stage_5plus' }],
  ['warm',   'warm',   'a friendly young child in a t-shirt smiling under a gentle sun, comfortable warmth', { growthStage: 'stage_5plus' }],
  ['cool',   'cool',   'a friendly young child in a light jacket with a soft cool breeze, comfortable not cold', { growthStage: 'stage_5plus' }],
]);

// Nouns · School — basic classroom objects + routine concepts. Object-mode for
// the items; the "recess" and "lunch" entries are scenes. Stage 5+ default.
group('Nouns', 'School', '', 'nouns.school', { mode: 'object', photo: 'none', phase: 'v1_extended', core: false }, [
  ['pencil',    'pencil',    'a single classic yellow pencil with a pink eraser, centered on a plain background'],
  ['paper',     'paper',     'a single sheet of clean white paper, slightly tilted, on a plain background'],
  ['marker',    'marker',    'a single colorful marker with the cap on, centered, friendly look'],
  ['scissors',  'scissors',  'a pair of child-safe scissors with rounded tips, plastic friendly handles'],
  ['glue',      'glue',      'a single classic white glue stick with a friendly twist cap'],
  ['backpack',  'backpack',  "a small cheerful child's backpack with two straps, simple cartoon style"],
  ['desk',      'desk',      'a small wooden classroom desk with a single chair attached, plain background'],
  ['classroom', 'classroom', 'a friendly bright classroom interior — desks, a chalkboard, a window with sun streaming in', { mode: 'concept' }],
  ['recess',    'recess',    'a friendly playground scene at school recess — a slide, a swing, a happy young child playing', { mode: 'concept' }],
  ['lunch',     'lunch',     "a child's lunchbox, open, showing a sandwich, an apple, and a juice box neatly arranged"],
]);

// =============================================================================
// TIER 3 — COVERAGE IN EXISTING CATEGORIES (PRD §11.1 breadth)
// More cognitive/communication verbs, more body parts, more emotions, more
// descriptors, plus a small Health subcategory.
// =============================================================================

// Verbs · Actions — cognitive, sensing, communication, and daily routine verbs
// the existing set missed. All concept-mode with a clear figure.
group('Verbs', 'Actions', '', 'verbs.actions.more', { mode: 'concept', photo: 'none', phase: 'v1_extended', core: false }, [
  // Cognitive
  ['think',    'think',    'a friendly young child with a finger to their chin, looking thoughtful, a small soft thought-bubble above', { growthStage: 'stage_5plus' }],
  ['know',     'know',     'a friendly young child with a confident smile, finger pointed up beside their head as if "got it!"', { growthStage: 'stage_5plus' }],
  ['remember', 'remember', 'a friendly young child with a hand on their forehead and a small soft thought-bubble showing a familiar object'],
  // Sensing
  ['see',      'see',      'a friendly young child with a hand visoring their forehead, looking outward attentively', { growthStage: 'stage_5plus', core: true, phase: 'v1_core' }],
  ['hear',     'hear',     'a friendly young child cupping one ear with a hand, leaning slightly forward to listen', { growthStage: 'stage_5plus', core: true, phase: 'v1_core' }],
  ['listen',   'listen',   'a friendly young child with both hands cupped behind their ears, head tilted, attentive'],
  ['feel',     'feel',     'a friendly young child gently touching a soft fuzzy object with one fingertip, exploring texture'],
  // General actions
  ['try',      'try',      'a friendly young child reaching upward with effort, on tiptoes, determined smile'],
  ['make',     'make',     'a friendly young child mid-craft, hands building a small tower of colorful blocks', { growthStage: 'stage_5plus', core: true, phase: 'v1_core' }],
  ['do',       'do',       'a friendly young child mid-action, hands working on a small project, focused face', { growthStage: 'stage_5plus', core: true, phase: 'v1_core' }],
  ['get',      'get',      'a friendly young child reaching out to grab a small cheerful object on a low shelf', { growthStage: 'stage_5plus', core: true, phase: 'v1_core' }],
  ['put',      'put',      'a friendly young child placing a small block carefully onto a stack of blocks'],
  ['take',     'take',     'a friendly young child gently receiving a small wrapped gift in both hands'],
  ['find',     'find',     'a friendly young child peeking around a corner with a happy "found it!" smile'],
  // Handling
  ['hold',     'hold',     'a friendly young child holding a small teddy bear gently with both hands at chest height'],
  ['carry',    'carry',    'a friendly young child walking carefully while carrying a medium cardboard box with both arms'],
  ['share',    'share',    'two friendly young children sitting side by side, passing a single cookie between them, both smiling'],
  // Communication
  ['say',      'say',      'a friendly young child with mouth slightly open speaking, a small soft speech-bubble above'],
  ['tell',     'tell',     'a friendly young child gesturing one hand while speaking to another child, soft speech-bubble above'],
  ['ask',      'ask',      'a friendly young child raising one hand and looking up with a small soft question mark beside them'],
  ['answer',   'answer',   'a friendly young child responding with a small smile and a soft speech-bubble containing a check mark'],
  ['talk',     'talk',     'two friendly young children facing each other mid-conversation, both smiling, small speech-bubbles above'],
  // Daily routine
  ['watch',    'watch',    'a friendly young child sitting comfortably watching a friendly cartoon on a small TV screen'],
  ['cook',     'cook',     'a friendly young child standing on a small step stool, stirring a small pot on a stovetop, happy'],
  ['clean',    'clean',    'a friendly young child wiping a small table with a soft cloth, cheerful expression'],
  ['drive',    'drive',    'a friendly young child pretending to drive a small toy car, hands on a tiny steering wheel'],
  ['fix',      'fix',      'a friendly young child gently using a small toy screwdriver on a broken toy, focused face'],
]);

// Nouns · Body additions — extends the existing Body subcategory.
group('Nouns', 'Body', '', 'nouns.body.more', { mode: 'object', photo: 'none', phase: 'v1_extended', core: false, notes: 'Could be supplement-mode for the child\'s actual body part.' }, [
  ['finger',   'finger',   "a child's pointing index finger, hand visible, friendly soft style"],
  ['toe',      'toe',      "a child's bare big toe and a few smaller toes, soft cartoon"],
  ['knee',     'knee',     "a child's bent knee with a small dot for the kneecap, leg visible"],
  ['elbow',    'elbow',    "a child's bent arm showing the elbow joint clearly"],
  ['shoulder', 'shoulder', "a child's shoulder visible from the side, soft friendly style"],
  ['back',     'back',     "the back of a friendly young child standing, view from behind, shoulders visible"],
  ['chest',    'chest',    "a friendly young child standing facing forward, hands gesturing toward their chest area"],
  ['neck',     'neck',     "a friendly young child's neck visible between the chin and shoulders"],
  ['face',     'face',     "a friendly young child's face, soft smile, head-and-shoulders framing"],
  ['cheek',    'cheek',    'a friendly young child with a finger touching their cheek, small soft blush dot on the cheek'],
  ['chin',     'chin',     'a friendly young child with their hand touching their chin, thoughtful soft expression'],
  ['lip',      'lip',      'a friendly young child smiling, lips clearly visible, soft natural color'],
  ['tongue',   'tongue',   'a friendly young child playfully sticking out their tongue, cheerful expression'],
]);

// Needs · Feelings additions.
group('Needs', 'Feelings', '', 'needs.feelings.more', { mode: 'concept', photo: 'none', phase: 'v1_extended', core: false }, [
  ['surprised',   'surprised',   'a friendly young child with wide round eyes and a small open mouth, gentle surprise (not scary)'],
  ['embarrassed', 'embarrassed', 'a friendly young child with soft red cheeks, looking shyly down, small smile'],
  ['frustrated',  'frustrated',  'a friendly young child with arms crossed and a mild puffed-cheek expression, not scary'],
  ['confused',    'confused',    'a friendly young child with head tilted sideways and one finger to chin, puzzled but calm'],
  ['bored',       'bored',       'a friendly young child resting their chin on their hand, half-smile, mildly bored'],
  ['proud',       'proud',       'a friendly young child standing tall with chest out, big smile, hands on hips'],
  ['nervous',     'nervous',     'a friendly young child biting their bottom lip lightly, hands clasped in front, gentle worry'],
  ['worried',     'worried',     'a friendly young child with hands gently clasped together, soft concerned look (not distressing)'],
  ['lonely',      'lonely',      'a friendly young child sitting alone on a small bench, soft thoughtful expression (gentle, not sad)'],
  ['angry',       'angry',       'a friendly young child with crossed arms and a firm frown, brows down slightly (not scary)'],
]);

// Needs · Describing additions — common adjectives every child wants to use.
group('Needs', 'Describing', '', 'needs.describe.more', { mode: 'object', photo: 'none', phase: 'v1_extended', core: false }, [
  ['wet',    'wet',    'a single wet leaf with shining water droplets glistening on its surface'],
  ['dry',    'dry',    'a single dry crinkly autumn leaf, no shine, soft warm color'],
  ['soft',   'soft',   'a single soft fluffy cloud or cotton ball, gentle airy feel'],
  ['hard',   'hard',   'a single smooth gray river stone, solid and firm, plain background'],
  ['sticky', 'sticky', 'a small jar of honey with a single dripping golden strand'],
  ['sweet',  'sweet',  'a single colorful lollipop with a small sparkle indicating sweetness'],
  ['funny',  'funny',  'a friendly young child laughing with both hands on belly, eyes squeezed shut in giggles', { mode: 'concept' }],
  ['scary',  'scary',  'a soft friendly cartoon ghost (Halloween-style, not frightening), gentle wave', { notes: 'Keep gentle and friendly — no actual scary content for toddlers.' }],
  ['new',    'new',    'a single shiny gift box with a fresh bow, soft sparkle effect, plain background'],
  ['tall',   'tall',   'a single tall stack of colorful blocks reaching toward the top of the frame'],
  ['short',  'short',  'a single short stack of two colorful blocks, low to the ground'],
  ['pretty', 'pretty', 'a single beautiful flower with bright cheerful petals, soft sparkle'],
]);

// Nouns · Health — symptoms + meds. New small category for self-advocacy
// ("itchy", "sore", "throw up") that goes well beyond what current "hurt" covers.
group('Nouns', 'Health', '', 'nouns.health', { mode: 'concept', photo: 'none', phase: 'v1_extended', core: false }, [
  ['itchy',    'itchy',    'a friendly young child gently scratching their arm, small soft wavy lines indicating an itch'],
  ['sore',     'sore',     'a friendly young child holding their arm with the other hand, a small soft red dot indicating soreness'],
  ['dizzy',    'dizzy',    'a friendly young child with a hand on their forehead, small soft spiral above their head (gentle, not distressing)'],
  ['sneeze',   'sneeze',   'a friendly young child sneezing politely into their elbow, head turned aside'],
  ['cough',    'cough',    'a friendly young child coughing into their elbow, considerate expression'],
  ['medicine', 'medicine', 'a small friendly bottle of liquid medicine with a measuring spoon beside it, plain background', { mode: 'object' }],
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

// ---- Growth-stage assignment (PRD §4.2B.3) ----
// Stage 1 = First Contact: persistent strip + food + toys + immediate family
// Stage 2 = More & Done   : adds more, all_done
// Stage 3 = Want          : adds want
// Stage 4 = Places + Go/Stop
// Stage 5+= Broadening (help, full verbs, body parts, feelings, social, etc.)
const STAGE_BY_ID = new Map(Object.entries({
  // Stage 1: persistent strip + immediate motivation
  'needs.yes': 'stage_1', 'needs.no': 'stage_1',
  'needs.eat': 'stage_1', 'needs.drink': 'stage_1',
  'needs.bathroom': 'stage_1', 'needs.hurt': 'stage_1',
  'people.family.me': 'stage_1', 'people.family.mom': 'stage_1', 'people.family.dad': 'stage_1',
  // Stage 2: the connector words that attach to the requesting the child already does
  'needs.more': 'stage_2', 'needs.all_done': 'stage_2',
  // Stage 3: first syntax move
  'needs.want': 'stage_3',
  // Stage 4: places + go/stop arrive together (PRD §4.2B.3)
  'needs.go': 'stage_4', 'needs.stop': 'stage_4',
  // Stage 5+: help is explicitly stage 5+ per PRD
  'needs.help': 'stage_5plus',
}));
// Section-level defaults applied when no explicit override above.
function defaultGrowthStage(r) {
  // Per-row override (set by Tier 1/2/3 group() opts) wins over the section
  // defaults — these are the explicit PRD §4.2B mappings authored at entry time.
  if (r.growthStage) return r.growthStage;
  if (STAGE_BY_ID.has(r.id)) return STAGE_BY_ID.get(r.id);
  if (r.column === 'Nouns' && r.category === 'Food')   return 'stage_1';
  if (r.column === 'Nouns' && r.category === 'Toys')   return 'stage_1';
  if (r.column === 'Nouns' && r.category === 'Places') return 'stage_4';
  // Everything else (verbs, body, clothes, animals, vehicles, colors, feelings,
  // social, describing, extended people) defaults to broadening — available but
  // not auto-prominent for an early-stage child.
  return 'stage_5plus';
}
// ---- Meal context for food items (PRD §4.2 + Nouns/Food taxonomy) ----
const MEAL_BY_ID = new Map(Object.entries({
  'nouns.food.drinks.milk': 'anytime',
  'nouns.food.drinks.water': 'anytime',
  'nouns.food.drinks.juice': 'anytime',
  'nouns.food.drinks.smoothie': 'anytime',
  'nouns.food.fruit.banana': 'anytime',
  'nouns.food.fruit.apple': 'anytime',
  'nouns.food.fruit.grapes': 'anytime',
  'nouns.food.fruit.orange': 'anytime',
  'nouns.food.fruit.strawberry': 'anytime',
  'nouns.food.fruit.blueberry': 'anytime',
  'nouns.food.veg.carrot': 'dinner',
  'nouns.food.veg.broccoli': 'dinner',
  'nouns.food.veg.corn': 'dinner',
  'nouns.food.veg.peas': 'dinner',
  'nouns.food.snacks.cracker': 'snack',
  'nouns.food.snacks.cereal': 'breakfast',
  'nouns.food.snacks.cheese': 'snack',
  'nouns.food.snacks.yogurt': 'snack',
  'nouns.food.snacks.cookie': 'snack',
  'nouns.food.snacks.chips': 'snack',
  'nouns.food.snacks.pretzel': 'snack',
  'nouns.food.meals.bread': 'breakfast',
  'nouns.food.meals.pasta': 'dinner',
  'nouns.food.meals.pizza': 'dinner',
  'nouns.food.meals.egg': 'breakfast',
  'nouns.food.meals.chicken': 'dinner',
  'nouns.food.meals.rice': 'dinner',
  'nouns.food.meals.sandwich': 'lunch',
}));

for (const r of rows) {
  r._growthStage = defaultGrowthStage(r);
  r._mealContext = MEAL_BY_ID.get(r.id) || '';
}

const HEADER = ['id', 'column', 'category', 'subcategory', 'label', 'pronunciation',
  'subject_mode', 'parent_photo_behavior', 'phase', 'core',
  'growth_stage', 'meal_context', 'is_gestalt', 'gestalt_type',
  'gestalt_meaning', 'gestalt_target_words', 'descriptive_clues',
  'status', 'prompt_template', 'notes'];
const cell = (s) => {
  s = String(s == null ? '' : s);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const lines = [HEADER.join(',')];
for (const r of rows) {
  lines.push([
    r.id, r.column, r.category, r.subcategory, r.label, r.pronunciation,
    r.subjectMode, r.parentPhotoBehavior, r.phase, r.core ? 'true' : 'false',
    r._growthStage, r._mealContext,
    'false', '', '', '', '',                                                // gestalts + clues left for SLP authoring
    'draft', r._prompt, r.notes,
  ].map(cell).join(','));
}
const outPath = path.join(HERE, 'seed-core-v1.csv');
fs.writeFileSync(outPath, lines.join('\n') + '\n');

const bySection = {}, byCore = { core: 0, noncore: 0 };
const byStage = {};
for (const r of rows) {
  bySection[r.column] = (bySection[r.column] || 0) + 1;
  byCore[r.core ? 'core' : 'noncore']++;
  byStage[r._growthStage] = (byStage[r._growthStage] || 0) + 1;
}
console.log('By stage:', JSON.stringify(byStage));
console.log(`Wrote ${rows.length} rows → ${path.relative(process.cwd(), outPath)}`);
console.log('By section:', JSON.stringify(bySection));
console.log(`Core: ${byCore.core} · Non-core: ${byCore.noncore}`);

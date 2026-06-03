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
  if (e.promptOverride) return e.promptOverride;
  if (e.parentPhotoBehavior === 'override') return `A {style} portrait based on {parent_photo} — ${PORTRAIT_TAIL}`;
  if (e.subjectMode === 'child_as_subject') return `A {style} portrait based on {reference} — ${PORTRAIT_TAIL}`;
  if (e.subjectMode === 'person')           return `A {style} of a friendly ${e.subject}: ${PORTRAIT_TAIL}`;
  if (e.subjectMode === 'concept')          return `A {style} of ${e.subject}, ${ACTION_TAIL}`;
  return `A {style} of ${e.subject}, ${OBJECT_TAIL}`;
}

const rows = [];
// group(column, category, subcategory, idPrefix, defaults, items[])
// item = [idTail, label, subject, opts?]   (opts can override mode/photo/phase/core/pron/notes,
//        plus audience/authoringKind, gestalt-related fields, and a custom prompt for skeletons)
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
      audience: opts.audience || defaults.audience || 'universal',
      authoringKind: opts.authoringKind || defaults.authoringKind || 'canonical',
      isGestalt: opts.isGestalt === true || defaults.isGestalt === true,
      gestaltType: opts.gestaltType || defaults.gestaltType || '',
      gestaltMeaning: opts.gestaltMeaning || defaults.gestaltMeaning || '',
      gestaltTargets: opts.gestaltTargets || defaults.gestaltTargets || [],
      promptOverride: opts.promptOverride || '',
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

// =============================================================================
// TIER 4 — GESTALTS (PRD §11 gestalt language processing track)
// "Whole chunks" the child says as units while they break them apart. Each
// tile carries gestalt_type / gestalt_meaning / gestalt_targets so the engine
// can tally the underlying single-words as they emerge. Concept-mode portraits
// of the social moment, not a literal transcription.
// =============================================================================
group('Needs', 'Social', 'Gestalts', 'needs.gestalts', { mode: 'concept', photo: 'none', phase: 'v1_extended', core: false, isGestalt: true, gestaltType: 'compositional' }, [
  ['good_morning',     'good morning',     'two friendly young children waving at each other at the start of the day, a soft sunrise behind them', { gestaltMeaning: 'morning greeting', gestaltTargets: ['good', 'morning', 'hi'] }],
  ['good_night',       'good night',       'a friendly young child in pajamas waving sleepily from a doorway, soft crescent moon nearby', { gestaltMeaning: 'bedtime farewell', gestaltTargets: ['good', 'night', 'sleep', 'bye'] }],
  ['have_a_good_day',  'have a good day',  'a friendly young child waving as another walks toward a school door with a backpack, soft sunshine', { gestaltMeaning: 'departure well-wish', gestaltTargets: ['have', 'good', 'day', 'bye'] }],
  ['see_you_later',    'see you later',    'a friendly young child waving cheerfully toward someone walking away, soft fade in the background', { gestaltMeaning: 'casual farewell', gestaltTargets: ['see', 'you', 'later', 'bye'] }],
  ['lets_go',          "let's go",         'a friendly young child grinning and pointing forward with one arm, the other reaching back as if pulling someone along', { gestaltMeaning: 'invitation to move', gestaltTargets: ['lets', 'go'], pron: "let's go" }],
  ['ready_to_play',    'ready to play',    'a friendly young child standing with toys laid out around them, beaming, arms wide open', { gestaltMeaning: 'announcing play', gestaltTargets: ['ready', 'play'] }],
  ['i_want_that',      'I want that',      'a friendly young child reaching with one hand toward a small cheerful object on a high shelf, eager smile', { gestaltMeaning: 'desire request', gestaltTargets: ['i', 'want', 'that'], pron: 'I want that' }],
  ['i_need_help',      'I need help',      'a friendly young child reaching upward both hands, looking toward a larger helping hand coming down from above', { gestaltMeaning: 'help request', gestaltTargets: ['i', 'need', 'help'], pron: 'I need help' }],
  ['more_please',      'more please',      'a friendly young child holding an empty cup forward with both hands, soft sparkle indicating please', { gestaltMeaning: 'polite continuation', gestaltTargets: ['more', 'please'] }],
  ['all_done_eat',     'all done eating',  'a friendly young child seated at a small table holding both hands up palms out next to a clean empty plate', { gestaltMeaning: 'finished a meal', gestaltTargets: ['all', 'done', 'eat'] }],
  ['where_are_you',    'where are you',    'a friendly young child peeking around a doorway with both hands cupped to their mouth, calling out', { gestaltMeaning: 'asking for location', gestaltTargets: ['where', 'are', 'you'] }],
  ['whats_that',       "what's that",      'a friendly young child pointing at a small cheerful object with one hand, the other hand on chin, curious look', { gestaltMeaning: 'asking to name', gestaltTargets: ['what', 'is', 'that'], pron: "what's that" }],
  ['i_love_you',       'I love you',       'a friendly young child making a heart shape with both hands held in front of their chest, big smile', { gestaltMeaning: 'expressing love', gestaltTargets: ['i', 'love', 'you'], pron: 'I love you' }],
  ['yes_please',       'yes please',       'a friendly young child nodding with both hands together in a polite gesture, small heart above', { gestaltMeaning: 'polite acceptance', gestaltTargets: ['yes', 'please'] }],
  ['no_thank_you',     'no thank you',     'a friendly young child gently shaking their head with one open hand raised politely', { gestaltMeaning: 'polite refusal', gestaltTargets: ['no', 'thank', 'you'] }],
  ['excuse_me',        'excuse me',        'a friendly young child with one hand gently raised, leaning forward politely to interrupt', { gestaltMeaning: 'polite interruption', gestaltTargets: ['excuse', 'me'] }],
  ['wait_a_minute',    'wait a minute',    'a friendly young child holding up one finger with a gentle "one moment" gesture, soft patient look', { gestaltMeaning: 'asking to pause', gestaltTargets: ['wait', 'minute'] }],
  ['sorry_about_that', 'sorry about that', 'a friendly young child with hand on chest, slightly bowed head, gentle apologetic smile', { gestaltMeaning: 'apology', gestaltTargets: ['sorry', 'that'] }],
  ['i_see_you',        'I see you',        'a friendly young child pointing at the viewer with a big delighted smile, eyes bright', { gestaltMeaning: 'connection greeting', gestaltTargets: ['i', 'see', 'you'], pron: 'I see you' }],
  ['time_to',          'time to',          'a friendly young child standing beside a soft clock with a forward arrow toward an activity scene', { gestaltMeaning: 'transitioning to an activity', gestaltTargets: ['time', 'to'], notes: 'Often paired with a specific activity tile.' }],
  ['happy_birthday',   'happy birthday',   'a friendly young child standing beside a small birthday cake with candles, party hat on, big smile', { gestaltMeaning: 'birthday greeting', gestaltTargets: ['happy', 'birthday'] }],
  ['i_miss_you',       'I miss you',       'a friendly young child holding a small photo of a family member close to their chest with both hands, soft warm expression', { gestaltMeaning: 'expressing missing someone', gestaltTargets: ['i', 'miss', 'you'], pron: 'I miss you' }],
]);

// =============================================================================
// TIER 5 — ALPHABET (A-Z)
// Canonical letter tiles with a familiar object cue. Children build their own
// personalized "A is for Aiden" variant on top via the per-child override; the
// canonical row carries the universal "A is for Apple"-style cue so a brand
// new child has a working alphabet from minute one.
// =============================================================================
const LETTER_SUBJECTS = {
  A: 'a single bright red apple beside a friendly capital A shape',
  B: 'a single cheerful ball beside a friendly capital B shape',
  C: 'a single fluffy cat beside a friendly capital C shape',
  D: 'a friendly dog beside a friendly capital D shape',
  E: 'a single cooked egg beside a friendly capital E shape',
  F: 'a single colorful fish beside a friendly capital F shape',
  G: 'a small bunch of green grapes beside a friendly capital G shape',
  H: 'a friendly little house beside a friendly capital H shape',
  I: 'a small block of ice with a sparkle beside a friendly capital I shape',
  J: 'a single jar of jam beside a friendly capital J shape',
  K: 'a single bright kite beside a friendly capital K shape',
  L: 'a single bright yellow lemon beside a friendly capital L shape',
  M: 'a single full moon with a friendly face beside a friendly capital M shape',
  N: 'a single soft bird nest beside a friendly capital N shape',
  O: 'a single bright orange beside a friendly capital O shape',
  P: 'a single piece of pizza beside a friendly capital P shape',
  Q: 'a soft cozy quilt folded beside a friendly capital Q shape',
  R: 'a friendly little rabbit beside a friendly capital R shape',
  S: 'a single bright yellow sun beside a friendly capital S shape',
  T: 'a single leafy tree beside a friendly capital T shape',
  U: 'an open umbrella beside a friendly capital U shape',
  V: 'a small bright violet flower beside a friendly capital V shape',
  W: 'a single sparkling drop of water beside a friendly capital W shape',
  X: 'a small xylophone with a mallet beside a friendly capital X shape',
  Y: 'a small ball of yellow yarn beside a friendly capital Y shape',
  Z: 'a friendly cartoon zebra beside a friendly capital Z shape',
};
group('Needs', 'Alphabet', '', 'needs.abc', { mode: 'object', photo: 'none', ...EXT, notes: 'Personalize candidate: swap to "A is for Aiden" using the child\'s name + a personal photo.' }, [
  ...Object.entries(LETTER_SUBJECTS).map(([letter, subj]) => [letter.toLowerCase(), letter, subj]),
]);

// =============================================================================
// TIER 6 — NUMBERS 11-30 + tens to 100
// Visual count-objects extending the 1-10 row. After 20 we keep the explicit
// rows but include only the tens (30, 40 … 100); a 47-stars tile is not useful.
// All non-core / stage 5+. Subject phrasing follows the existing 1-10 style.
// =============================================================================
const NUMBER_ROWS = [];
for (let n = 11; n <= 30; n++) {
  NUMBER_ROWS.push([
    'n_' + n,
    String(n),
    `${n} small cheerful colorful stars arranged in a tidy grid, equal spacing, plain pastel background`,
    EXT,
  ]);
}
for (const n of [40, 50, 60, 70, 80, 90, 100]) {
  NUMBER_ROWS.push([
    'n_' + n,
    String(n),
    `${n} tiny bright dots arranged in a clear grid, evenly spaced, plain pastel background`,
    EXT,
  ]);
}
group('Needs', 'Numbers', '', 'needs.numbers', { mode: 'object', photo: 'none' }, NUMBER_ROWS);

// =============================================================================
// TIER 7 — EXTENDED COLORS
// =============================================================================
group('Nouns', 'Colors', '', 'nouns.colors.more', { mode: 'object', photo: 'none', ...EXT }, [
  ['gray',   'gray',   'a simple rounded shape filled with solid medium gray'],
  ['gold',   'gold',   'a simple rounded shape filled with rich warm gold with a soft sheen'],
  ['silver', 'silver', 'a simple rounded shape filled with shiny cool silver with a soft sheen'],
  ['lime',   'lime',   'a simple rounded shape filled with solid bright lime green'],
  ['teal',   'teal',   'a simple rounded shape filled with solid cool teal'],
  ['navy',   'navy',   'a simple rounded shape filled with solid deep navy blue'],
  ['peach',  'peach',  'a simple rounded shape filled with soft warm peach'],
  ['tan',    'tan',    'a simple rounded shape filled with warm light tan'],
]);

// =============================================================================
// TIER 8 — SHAPES
// =============================================================================
group('Nouns', 'Shapes', '', 'nouns.shapes', { mode: 'object', photo: 'none', ...EXT, notes: 'Great for matching games + early geometry.' }, [
  ['circle',    'circle',    'a single bright bold circle, evenly outlined, centered'],
  ['square',    'square',    'a single bright bold square, evenly outlined, centered'],
  ['triangle',  'triangle',  'a single bright bold equilateral triangle, evenly outlined, centered'],
  ['rectangle', 'rectangle', 'a single bright bold rectangle, evenly outlined, centered'],
  ['oval',      'oval',      'a single bright bold oval, evenly outlined, centered'],
  ['diamond',   'diamond',   'a single bright bold diamond (rotated square), evenly outlined, centered'],
  ['heart',     'heart',     'a single bright bold red heart shape, centered'],
  ['star',      'star',      'a single bright bold five-pointed yellow star, centered (the shape, distinct from nouns.nature.star)'],
  ['crescent',  'crescent',  'a single bright bold crescent (smiling moon shape), centered'],
  ['hexagon',   'hexagon',   'a single bright bold hexagon, evenly outlined, centered'],
  ['octagon',   'octagon',   'a single bright bold octagon (like a stop sign), evenly outlined, centered'],
  ['pentagon',  'pentagon',  'a single bright bold pentagon, evenly outlined, centered'],
  ['arrow',     'arrow',     'a single bright bold right-pointing arrow, centered'],
  ['cross',     'cross',     'a single bright bold plus-shaped cross, centered'],
]);

// =============================================================================
// TIER 9 — WEATHER EXTENSION (alongside Tier 2 weather descriptors)
// =============================================================================
group('Needs', 'Describing', '', 'needs.describe.weather.more', { mode: 'object', photo: 'none', ...EXT }, [
  ['stormy',    'stormy',    'a friendly gray cloud with gentle rain and a single soft cartoon lightning bolt (not scary)'],
  ['foggy',     'foggy',     'a soft pale gray fog drifting over a small house and tree, gentle and calm'],
  ['lightning', 'lightning', 'a single soft cartoon lightning bolt against a dark blue cloud (friendly, not scary)'],
  ['tornado',   'tornado',   'a soft cartoon swirling spiral funnel touching down on a tiny field, gentle stylized (not scary)'],
  ['rainbow',   'rainbow',   'a bright friendly arching rainbow over a soft pastel landscape, fluffy clouds at the ends'],
]);

// =============================================================================
// TIER 10 — ANIMALS (sub-grouped: pets, farm, jungle, sea, forest, polar, bugs, dinos)
// All extended / non-core. Personalize for real pets via the notes pointer.
// =============================================================================
group('Nouns', 'Animals', 'Pets', 'nouns.animals.pets', { mode: 'object', photo: 'none', ...EXT, notes: 'Personalize candidate for real family pets.' }, [
  ['hamster',    'hamster',    'a friendly cartoon hamster sitting up holding a small seed, soft fur'],
  ['guinea_pig', 'guinea pig', 'a friendly cartoon guinea pig with round body and short legs, soft brown and white fur', { pron: 'guinea pig' }],
  ['gerbil',     'gerbil',     'a friendly cartoon gerbil standing on hind legs, soft sandy fur, alert ears'],
  ['parrot',     'parrot',     'a friendly cartoon parrot with bright red blue and green feathers on a small perch'],
  ['turtle',     'turtle',     'a friendly cartoon turtle with a green patterned shell and a small smile'],
  ['snake',      'snake',      'a friendly cartoon green snake coiled in a soft S-shape, small smile (not scary)'],
  ['lizard',     'lizard',     'a friendly cartoon green lizard with a long tail, perched on a small branch'],
  ['ferret',     'ferret',     'a friendly cartoon ferret in soft cream and brown, long body, curious face'],
]);
group('Nouns', 'Animals', 'Farm', 'nouns.animals.farm', { mode: 'object', photo: 'none', ...EXT }, [
  ['goat',    'goat',    'a friendly cartoon white-and-brown goat with small horns, standing on grass'],
  ['sheep',   'sheep',   'a friendly cartoon fluffy white sheep, gentle smile, standing on green grass'],
  ['donkey',  'donkey',  'a friendly cartoon gray donkey with long ears, standing calmly'],
  ['rooster', 'rooster', 'a friendly cartoon rooster with a bright red comb and colorful tail feathers, standing tall'],
  ['chicken', 'chicken', 'a friendly cartoon brown hen with a small red comb, standing on grass'],
  ['turkey',  'turkey',  'a friendly cartoon turkey with a fanned tail of warm autumn colors, standing tall'],
  ['llama',   'llama',   'a friendly cartoon llama with long fluffy white fur and tall ears, gentle smile'],
  ['alpaca',  'alpaca',  'a friendly cartoon alpaca with very fluffy cream fur and big eyes, gentle smile'],
]);
group('Nouns', 'Animals', 'Jungle', 'nouns.animals.jungle', { mode: 'object', photo: 'none', ...EXT }, [
  ['tiger',    'tiger',    'a friendly cartoon orange-and-black striped tiger with a gentle smile (not scary)'],
  ['giraffe',  'giraffe',  'a friendly cartoon giraffe with a long neck and warm yellow-and-brown spots'],
  ['zebra',    'zebra',    'a friendly cartoon zebra with bold black-and-white stripes, gentle smile'],
  ['kangaroo', 'kangaroo', 'a friendly cartoon kangaroo with a tiny joey peeking from her pouch'],
  ['koala',    'koala',    'a friendly cartoon gray koala clinging to a small eucalyptus branch, sleepy smile'],
  ['panda',    'panda',    'a friendly cartoon panda sitting and holding a small green bamboo stalk'],
  ['gorilla',  'gorilla',  'a friendly cartoon gorilla sitting calmly with a gentle smile, soft dark fur'],
  ['hippo',    'hippo',    'a friendly cartoon purple-gray hippo with a round body and small smile'],
]);
group('Nouns', 'Animals', 'Sea', 'nouns.animals.sea', { mode: 'object', photo: 'none', ...EXT }, [
  ['whale',     'whale',     'a friendly cartoon blue whale with a small water spout above, gentle smile'],
  ['dolphin',   'dolphin',   'a friendly cartoon gray dolphin mid-leap, small smile, soft splash below'],
  ['shark',     'shark',     'a friendly cartoon blue shark with a small smile (not scary)'],
  ['octopus',   'octopus',   'a friendly cartoon purple octopus with eight curly arms, big eyes, small smile'],
  ['seal',      'seal',      'a friendly cartoon gray seal balancing playfully on its tail, small smile'],
  ['walrus',    'walrus',    'a friendly cartoon brown walrus with two small tusks and a fluffy mustache, gentle smile'],
  ['jellyfish', 'jellyfish', 'a friendly cartoon pink translucent jellyfish with soft trailing tentacles'],
  ['starfish',  'starfish',  'a friendly cartoon orange starfish with a small smile, plain background'],
  ['crab',      'crab',      'a friendly cartoon red crab with two small claws raised cheerfully'],
  ['lobster',   'lobster',   'a friendly cartoon red lobster with two small claws, antennae raised'],
]);
group('Nouns', 'Animals', 'Forest', 'nouns.animals.forest', { mode: 'object', photo: 'none', ...EXT }, [
  ['deer',     'deer',     'a friendly cartoon brown deer with small white spots, gentle smile'],
  ['fox',      'fox',      'a friendly cartoon orange fox with a fluffy white-tipped tail, gentle smile'],
  ['bear',     'bear',     'a friendly cartoon brown bear sitting on its haunches, small smile'],
  ['raccoon',  'raccoon',  'a friendly cartoon gray raccoon with a black mask and ringed tail, small smile'],
  ['squirrel', 'squirrel', 'a friendly cartoon brown squirrel holding a small acorn, fluffy tail'],
  ['owl',      'owl',      'a friendly cartoon brown owl with big round eyes on a small branch'],
  ['wolf',     'wolf',     'a friendly cartoon gray wolf with a gentle smile (not scary)'],
]);
group('Nouns', 'Animals', 'Polar', 'nouns.animals.polar', { mode: 'object', photo: 'none', ...EXT }, [
  ['polar_bear', 'polar bear', 'a friendly cartoon white polar bear sitting on a small ice floe, gentle smile', { pron: 'polar bear' }],
  ['penguin',    'penguin',    'a friendly cartoon black-and-white penguin standing on ice with a small smile'],
  ['arctic_fox', 'arctic fox', 'a friendly cartoon fluffy white fox in soft snow, gentle smile', { pron: 'arctic fox' }],
  ['narwhal',    'narwhal',    'a friendly cartoon gray narwhal with a single straight tusk, swimming gently'],
  ['puffin',     'puffin',     'a friendly cartoon black-and-white puffin with a bright orange beak, standing on a rock'],
]);
group('Nouns', 'Animals', 'Bugs', 'nouns.animals.bugs', { mode: 'object', photo: 'none', ...EXT }, [
  ['bee',         'bee',         'a friendly cartoon black-and-yellow bee with tiny wings, small smile'],
  ['butterfly',   'butterfly',   'a friendly cartoon butterfly with colorful symmetrical wings (orange and blue)'],
  ['ant',         'ant',         'a friendly cartoon red ant with three round body segments and a small smile'],
  ['ladybug',     'ladybug',     'a friendly cartoon red ladybug with five small black dots and tiny legs'],
  ['spider',      'spider',      'a friendly cartoon round black spider with eight tiny legs, small smile (not scary)'],
  ['caterpillar', 'caterpillar', 'a friendly cartoon green caterpillar with several round body segments, small smile'],
  ['snail',       'snail',       'a friendly cartoon snail with a spiral patterned shell, small smile'],
  ['dragonfly',   'dragonfly',   'a friendly cartoon dragonfly with four delicate transparent wings, gentle blue body'],
]);
group('Nouns', 'Animals', 'Dinosaurs', 'nouns.animals.dinos', { mode: 'object', photo: 'none', ...EXT, notes: 'Friendly toddler-safe cartoon style — never scary.' }, [
  ['t_rex',         'T-rex',         'a friendly cartoon green T-rex with tiny arms and a small smile (not scary)', { pron: 'tee rex' }],
  ['triceratops',   'triceratops',   'a friendly cartoon green triceratops with three small horns and a frill, small smile'],
  ['brontosaurus',  'brontosaurus',  'a friendly cartoon long-necked brontosaurus with a small smile, soft green'],
  ['stegosaurus',   'stegosaurus',   'a friendly cartoon stegosaurus with rounded plates along the back, small smile'],
  ['pterodactyl',   'pterodactyl',   'a friendly cartoon pterodactyl with stretched-out wings, small smile in flight'],
  ['velociraptor',  'velociraptor',  'a friendly cartoon velociraptor with green skin and a small smile (not scary)'],
]);

// =============================================================================
// TIER 11 — FRUITS + VEGETABLES extension
// =============================================================================
group('Nouns', 'Food', 'Fruit', 'nouns.food.fruit.more', { mode: 'object', photo: 'none', ...EXT }, [
  ['watermelon', 'watermelon', 'a single slice of bright red watermelon with small black seeds'],
  ['peach',      'peach',      'a single ripe peach with a soft fuzzy skin and a small green leaf'],
  ['pineapple',  'pineapple',  'a single golden pineapple with green spiky leaves on top'],
  ['mango',      'mango',      'a single ripe orange-yellow mango'],
  ['kiwi',       'kiwi',       'a single sliced kiwi showing the bright green inside with tiny black seeds'],
  ['cherry',     'cherry',     'two bright red cherries connected by a single green stem'],
  ['pear',       'pear',       'a single ripe green pear with a small leaf at the top'],
]);
group('Nouns', 'Food', 'Vegetables', 'nouns.food.veg.more', { mode: 'object', photo: 'none', ...EXT }, [
  ['tomato',    'tomato',    'a single bright red tomato with a small green stem on top'],
  ['potato',    'potato',    'a single brown potato with a few small "eyes", plain background'],
  ['cucumber',  'cucumber',  'a single dark green cucumber'],
  ['lettuce',   'lettuce',   'a single leafy head of bright green lettuce'],
  ['onion',     'onion',     'a single yellow onion with a small green sprout at the top'],
  ['pepper',    'pepper',    'a single bright red bell pepper with a small green stem'],
  ['mushroom',  'mushroom',  'a single friendly cartoon mushroom with a red cap and white spots'],
  ['celery',    'celery',    'a single bright green celery stalk with a few small leaves at the top'],
]);

// =============================================================================
// TIER 12 — BODY parts (head/face extensions)
// =============================================================================
group('Nouns', 'Body', 'Face', 'nouns.body.face', { mode: 'object', photo: 'none', ...EXT }, [
  ['eyebrow',  'eyebrow',  'a friendly young child\'s face with one eyebrow gently arched, soft cartoon style'],
  ['eyelash',  'eyelash',  'a friendly close-up of a single eye with long curled eyelashes, gentle soft style'],
  ['freckle',  'freckle',  'a friendly young child\'s face with a few small soft freckles across the nose and cheeks'],
  ['dimple',   'dimple',   'a friendly young child smiling broadly with a small dimple in one cheek'],
  ['beard',    'beard',    'a friendly cartoon man with a soft trimmed beard, head-and-shoulders'],
  ['wrist',    'wrist',    'a friendly young child\'s wrist with their hand visible, slight bend, soft cartoon style'],
]);

// =============================================================================
// TIER 13 — PLANTS
// =============================================================================
group('Nouns', 'Nature', 'Plants', 'nouns.nature.plants', { mode: 'object', photo: 'none', ...EXT }, [
  ['cactus',    'cactus',    'a friendly cartoon green cactus in a small terracotta pot, with a tiny pink flower on top'],
  ['fern',      'fern',      'a single bright green fern with delicate fronds in a small pot'],
  ['daisy',     'daisy',     'a single cheerful white daisy with a yellow center and a small green stem'],
  ['rose',      'rose',      'a single red rose with a small green stem and a few soft leaves'],
  ['sunflower', 'sunflower', 'a single bright yellow sunflower with a brown center and a tall green stem'],
  ['tulip',     'tulip',     'a single bright pink tulip with a smooth green stem and two leaves'],
  ['grass',     'grass',     'a small patch of bright green grass with a few tall blades'],
  ['leaf',      'leaf',      'a single bright green leaf with soft veins, plain background'],
]);

// =============================================================================
// TIER 14 — CLOTHES extension
// =============================================================================
group('Nouns', 'Clothes', '', 'nouns.clothes.more', { mode: 'object', photo: 'none', ...EXT }, [
  ['t_shirt',     'T-shirt',      "a single colorful child's T-shirt laid flat", { pron: 'tee shirt' }],
  ['jeans',       'jeans',        "a single pair of small child's blue jeans laid flat"],
  ['sweater',     'sweater',      "a single cozy knit sweater laid flat"],
  ['jacket',      'jacket',       "a single child's jacket laid flat"],
  ['scarf',       'scarf',        "a single colorful knit scarf coiled neatly"],
  ['mittens',     'mittens',      "a pair of warm mittens connected by a string"],
  ['beanie',      'beanie',       "a single cozy knit beanie hat with a small pom on top"],
  ['baseball_cap','baseball cap', "a single classic baseball cap", { pron: 'baseball cap' }],
  ['sneakers',    'sneakers',     "a single pair of small child's sneakers"],
  ['rain_boots',  'rain boots',   "a single pair of small yellow rain boots", { pron: 'rain boots' }],
]);

// =============================================================================
// TIER 15 — SCHOOL extension
// =============================================================================
group('Nouns', 'School', '', 'nouns.school.more', { mode: 'object', photo: 'none', ...EXT }, [
  ['whiteboard', 'whiteboard', 'a single classroom whiteboard mounted on a wall with a small marker tray, blank surface'],
  ['eraser',     'eraser',     'a single pink rectangular eraser, centered on a plain background'],
  ['notebook',   'notebook',   'a single spiral notebook with a colorful cover, closed, on a plain background'],
  ['ruler',      'ruler',      'a single yellow plastic ruler with small markings, centered'],
  ['bookshelf',  'bookshelf',  'a small classroom bookshelf with a few colorful picture books standing upright'],
]);

// =============================================================================
// TIER 16 — TIME: hours + clock concepts + months
// =============================================================================
const HOUR_ROWS = [];
for (let h = 1; h <= 12; h++) {
  HOUR_ROWS.push([
    'hour_' + h,
    h + " o'clock",
    `a friendly round clock face with the hour hand pointing exactly at the ${h} and the minute hand pointing at the 12, plain pastel background`,
    EXT,
  ]);
}
group('Needs', 'Time', 'Hours', 'needs.time.hours', { mode: 'object', photo: 'none' }, HOUR_ROWS);

group('Needs', 'Time', 'Clock', 'needs.time.clock', { mode: 'object', photo: 'none', ...EXT }, [
  ['noon',      'noon',      'a friendly clock face with both hands straight up at 12, bright cheerful sun behind'],
  ['midnight',  'midnight',  'a friendly clock face with both hands straight up at 12, soft crescent moon and stars behind'],
  ['oclock',    "o'clock",   "a friendly clock face with the minute hand pointing exactly at the 12, hour hand straight, soft sparkle indicating 'on the hour'", { pron: "oh clock" }],
  ['half_past', 'half past', 'a friendly clock face with the minute hand pointing exactly at the 6 (halfway around)', { pron: 'half past' }],
  ['quarter',   'quarter',   'a friendly clock face with the minute hand pointing exactly at the 3 (one quarter past the hour)'],
  ['minute',    'minute',    'a friendly clock face with a soft highlight on the longer minute hand'],
  ['hour',      'hour',      'a friendly clock face with a soft highlight on the shorter hour hand'],
]);

group('Needs', 'Time', 'Months', 'needs.time.months', { mode: 'object', photo: 'none', ...EXT }, [
  ['january',   'January',   'a friendly calendar page labeled by a snowflake icon at the top, soft winter scene'],
  ['february',  'February',  'a friendly calendar page with a small pink heart icon at the top'],
  ['march',     'March',     'a friendly calendar page with a small green clover and an early spring flower'],
  ['april',     'April',     'a friendly calendar page with a small umbrella icon and a few raindrops'],
  ['may',       'May',       'a friendly calendar page with a cluster of small spring flowers at the top'],
  ['june',      'June',      'a friendly calendar page with a bright sun and a small kite at the top'],
  ['july',      'July',      'a friendly calendar page with a small American-style fireworks burst at the top'],
  ['august',    'August',    'a friendly calendar page with a bright sun and a small beach umbrella at the top'],
  ['september', 'September', 'a friendly calendar page with a small backpack and a pencil at the top'],
  ['october',   'October',   'a friendly calendar page with a small friendly pumpkin and a falling leaf at the top'],
  ['november',  'November',  'a friendly calendar page with a small autumn leaf and a tiny pie slice at the top'],
  ['december',  'December',  'a friendly calendar page with a small evergreen tree and a snowflake at the top'],
]);

// =============================================================================
// TIER 17 — HOLIDAYS
// Personalize-friendly: every family celebrates differently; canonical art is
// the icon, real photos can override per-child.
// =============================================================================
group('Needs', 'Holidays', '', 'needs.holidays', { mode: 'object', photo: 'none', ...EXT, notes: 'Personalize candidate: swap in a real family-event photo per child.' }, [
  ['birthday',         'birthday',         'a single small birthday cake with three lit candles and a soft sparkle, plain background'],
  ['christmas',        'Christmas',        'a single small decorated evergreen tree with a star on top and a few wrapped gifts at the base'],
  ['hanukkah',         'Hanukkah',         'a single friendly menorah with nine candles, the center one taller than the rest, soft warm glow'],
  ['halloween',        'Halloween',        'a single friendly smiling jack-o-lantern on a plain background (cheerful, not scary)'],
  ['thanksgiving',     'Thanksgiving',     'a single small autumn pumpkin beside a small bundle of wheat and a warm-colored leaf'],
  ['easter',           'Easter',           'a single small cheerful Easter basket with two pastel painted eggs and a soft ribbon'],
  ['valentines',       "Valentine's Day",  'a single red heart with a small ribbon, plain pastel background', { pron: 'valentines day' }],
  ['fourth_of_july',   'Fourth of July',   'a single small American flag beside a soft cartoon firework burst', { pron: 'fourth of July' }],
  ['new_year',         'New Year',         "a single party hat and a soft starburst with the words ✨ at the top (no letters)", { pron: 'new year' }],
  ['mothers_day',      "Mother's Day",     'a single small bouquet of flowers tied with a soft ribbon, plain pastel background', { pron: "mother's day" }],
  ['fathers_day',      "Father's Day",     'a single small wrapped gift with a soft ribbon beside a coffee mug, plain background', { pron: "father's day" }],
]);


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
  'audience', 'authoring_kind',
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
    r.isGestalt ? 'true' : 'false',
    r.gestaltType || '',
    r.gestaltMeaning || '',
    (r.gestaltTargets || []).join(', '),
    '',                                                                     // descriptive_clues left for SLP authoring
    r.audience || 'universal', r.authoringKind || 'canonical',
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

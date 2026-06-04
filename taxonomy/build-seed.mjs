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
  ['i_love_you',       'I love you',       'a friendly young child making a heart shape with both hands held in front of their chest, big smile', { gestaltMeaning: 'expressing love', gestaltTargets: ['i', 'love', 'you'], pron: 'I love you', audience: 'parent', notes: 'Family-context phrase. Surface as a parent-authoring suggestion only — the tile itself is available everywhere, but teachers/therapists shouldn\'t be prompted to add it to their boards.' }],
  ['yes_please',       'yes please',       'a friendly young child nodding with both hands together in a polite gesture, small heart above', { gestaltMeaning: 'polite acceptance', gestaltTargets: ['yes', 'please'] }],
  ['no_thank_you',     'no thank you',     'a friendly young child gently shaking their head with one open hand raised politely', { gestaltMeaning: 'polite refusal', gestaltTargets: ['no', 'thank', 'you'] }],
  ['excuse_me',        'excuse me',        'a friendly young child with one hand gently raised, leaning forward politely to interrupt', { gestaltMeaning: 'polite interruption', gestaltTargets: ['excuse', 'me'] }],
  ['wait_a_minute',    'wait a minute',    'a friendly young child holding up one finger with a gentle "one moment" gesture, soft patient look', { gestaltMeaning: 'asking to pause', gestaltTargets: ['wait', 'minute'] }],
  ['sorry_about_that', 'sorry about that', 'a friendly young child with hand on chest, slightly bowed head, gentle apologetic smile', { gestaltMeaning: 'apology', gestaltTargets: ['sorry', 'that'] }],
  ['i_see_you',        'I see you',        'a friendly young child pointing at the viewer with a big delighted smile, eyes bright', { gestaltMeaning: 'connection greeting', gestaltTargets: ['i', 'see', 'you'], pron: 'I see you' }],
  ['time_to',          'time to',          'a friendly young child standing beside a soft clock with a forward arrow toward an activity scene', { gestaltMeaning: 'transitioning to an activity', gestaltTargets: ['time', 'to'], notes: 'Often paired with a specific activity tile.' }],
  ['happy_birthday',   'happy birthday',   'a friendly young child standing beside a small birthday cake with candles, party hat on, big smile', { gestaltMeaning: 'birthday greeting', gestaltTargets: ['happy', 'birthday'] }],
  ['i_miss_you',       'I miss you',       'a friendly young child holding a small photo of a family member close to their chest with both hands, soft warm expression', { gestaltMeaning: 'expressing missing someone', gestaltTargets: ['i', 'miss', 'you'], pron: 'I miss you', audience: 'parent', notes: 'Family-context phrase. Same audience treatment as "I love you".' }],
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
// TIER 6 — NUMBERS 11-100
// Visual count-objects extending the 1-10 row. For 11-30 we render a tidy grid
// of the actual count; for 31-99 we use a numeric card (digit on a friendly
// card) — past about 30 a literal star-grid is no longer subitizable for a
// toddler and the digit becomes the useful cue. 100 gets the "10 rows of 10"
// hundreds-grid as a hundredths-chart anchor.
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
for (let n = 31; n <= 99; n++) {
  NUMBER_ROWS.push([
    'n_' + n,
    String(n),
    `a single large friendly numeric card showing the bold digits "${n}" centered on a soft pastel background, gentle rounded sans-serif`,
    EXT,
  ]);
}
NUMBER_ROWS.push([
  'n_100',
  '100',
  '100 tiny bright dots arranged as a 10-by-10 hundreds-chart grid, evenly spaced, plain pastel background',
  EXT,
]);
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

// =============================================================================
// TIER 18 — SKELETONS (train the trainers)
// "personal_skeleton" tiles are not real tiles in the library — they are
// authoring prompts that the relevant teammate sees in their build flow:
// "you may want to make a tile for this. Snap a photo and we'll name it."
// They never go through image generation (the prompt is human instructions),
// they're filtered out of standard tile lookups by authoring_kind, and they
// surface in the matching role's "build a board" picker.
// =============================================================================
const SK = { authoringKind: 'personal_skeleton', mode: 'concept', photo: 'none', ...EXT };

// --- school_team skeletons -------------------------------------------------
group('Nouns', 'School', 'School (teacher authoring)', 'personal.school', { ...SK, audience: 'school_team' }, [
  ['fire_drill',     'Fire Drill',     '', { promptOverride: 'SKELETON for the school team: take a photo of your fire-drill rally point — the spot outside where your class gathers. A predictable visual makes the drill enormously less scary. Pair the tile with the language you use ("we go to our spot").' }],
  ['lockdown_drill', 'Lockdown Drill', '', { promptOverride: 'SKELETON for the school team: take a photo of the calm corner of your classroom where students gather during a lockdown drill. Keep the image friendly and unambiguous — this is about predictability, not alarm.' }],
  ['field_trip',     'Field Trip',     '', { promptOverride: 'SKELETON for the school team: snap a photo of the school bus or your class lining up at the door for a field trip. Use the same photo across trips; what changes is the destination tile that follows.' }],
  ['library_day',    'Library Day',    '', { promptOverride: 'SKELETON for the school team: photo of your school library entrance, or the librarian, or the rug where storytime happens. Schedule it as a recurring tile on library days.' }],
  ['picture_day',    'Picture Day',    '', { promptOverride: 'SKELETON for the school team: photo of the photo-backdrop area, or a friendly camera icon. Surface this only on picture day so the student knows what to expect.' }],
  ['show_and_tell',  'Show and Tell',  '', { promptOverride: 'SKELETON for the school team: photo of the rug, podium, or "presenter spot" your class uses. Pair with a sentence-starter strip if the student needs scaffolding.' }],
  ['specials_pe',    'PE',             '', { promptOverride: 'SKELETON for the school team: photo of the gym door or PE teacher. PE is loud and physical — a predictable visual helps an AAC user transition into it.' }],
  ['specials_art',   'Art',            '', { promptOverride: 'SKELETON for the school team: photo of the art room or art teacher. Pair with material tiles (paint, clay, glue) the student can request.' }],
  ['specials_music', 'Music',          '', { promptOverride: 'SKELETON for the school team: photo of the music room, music teacher, or a familiar instrument. Music is often a strong reinforcer for AAC learners — make it requestable.' }],
  ['lunchroom',      'Lunchroom',      '', { promptOverride: 'SKELETON for the school team: photo of your cafeteria (or the table the student\'s class sits at). Use the same lunchroom image, then layer the menu choices as separate tiles.' }],
  ['arrival',        'Arrival',        '', { promptOverride: 'SKELETON for the school team: photo of the classroom entrance from the hallway side, OR the drop-off door. Helps the student name the start of the school day.' }],
  ['dismissal',      'Dismissal',      '', { promptOverride: 'SKELETON for the school team: photo of the dismissal door, OR the bus loop, OR the line-up spot. Pair with "Bye" gestalt for an end-of-day script.' }],
  ['centers',        'Centers',        '', { promptOverride: 'SKELETON for the school team: photo of your centers rotation chart, or the rug/table where centers happen. If you can, make one tile per center (reading center, math center, etc.) and link them all to this one.' }],
  ['line_up',        'Line up',        '', { promptOverride: 'SKELETON for the school team: photo of the line-up spot at the door, ideally with the painted line or floor marker visible. Pair with "follow" or "go" gestalts.' }],
  ['quiet_time',     'Quiet time',     '', { promptOverride: 'SKELETON for the school team: photo of the cozy corner, rest mat, or whatever signals quiet time in your room. Pair with a "calm" tile for self-regulation language.' }],
  ['calm_corner',    'Calm corner',    '', { promptOverride: 'SKELETON for the school team: photo of the calm-down spot in your room (beanbag, sensory bin, etc.). Make the tile available as a request so the student can ask to go there.' }],
  ['my_teacher',     'My teacher',     '', { promptOverride: 'SKELETON for the school team: head-and-shoulders photo of the lead teacher. Each year this tile updates — keep the slug, swap the image.', mode: 'person' }],
  ['my_para',        'My aide',        '', { promptOverride: 'SKELETON for the school team: head-and-shoulders photo of the paraprofessional/aide working with the student. Replace per year / per assignment.', mode: 'person' }],
  ['class_pet',      'Class pet',      '', { promptOverride: 'SKELETON for the school team: photo of your class pet (or class mascot stuffie). Strong daily-vocabulary anchor.' }],
  ['class_job',      'My class job',   '', { promptOverride: 'SKELETON for the school team: photo of the chart spot showing this student\'s class job (line leader, paper passer, etc.). Update weekly with the rotation.' }],
]);

// --- therapist skeletons ---------------------------------------------------
group('Nouns', 'Therapy', 'Therapy (clinician authoring)', 'personal.therapy', { ...SK, audience: 'therapist' }, [
  ['therapy_room',     'Therapy room',     '', { promptOverride: 'SKELETON for the therapist: photo of YOUR therapy room from the doorway. The single most useful transition cue for an AAC user.' }],
  ['session_start',    'Session start',    '', { promptOverride: 'SKELETON for the therapist: photo of your session-start routine (greeting board, name card, whatever you open with). Bracket the session in visuals so the child knows what to expect.' }],
  ['session_end',      'Session end',      '', { promptOverride: 'SKELETON for the therapist: photo of your end-of-session marker (timer hitting zero, "all done" card, the door). Pair with the "all done" gestalt.' }],
  ['reinforcer',       'My reinforcer',    '', { promptOverride: 'SKELETON for the therapist: photo of THIS child\'s strongest reinforcer (the bubble machine, their iPad video, the spinner). Make it requestable; reinforce by handing over what they asked for.' }],
  ['sensory_bin',      'Sensory bin',      '', { promptOverride: 'SKELETON for the therapist: photo of the sensory bin the child engages with. If you swap the contents weekly, photo each variant as a separate tile (rice bin, bean bin, water bin) and link them.' }],
  ['visual_schedule',  'Visual schedule',  '', { promptOverride: 'SKELETON for the therapist: photo of your printed/laminated visual schedule. Surface this tile when transitioning between activities — "let\'s check the schedule".' }],
  ['target_word',      'Target word',      '', { promptOverride: 'SKELETON for the therapist: this is a placeholder you duplicate per session target — photo of the actual referent you\'re working on (a specific toy, a specific snack). Update the label per target.' }],
  ['co_treat',         'Co-treat partner', '', { promptOverride: 'SKELETON for the therapist: head-and-shoulders photo of the OT/SLP/BCBA you co-treat with. Helps the child anchor multi-person sessions.', mode: 'person' }],
  ['quiet_space',      'Quiet space',      '', { promptOverride: 'SKELETON for the therapist: photo of the calm corner / sensory tent / whatever de-escalation space you use. Available as a request — children CAN ask for a break.' }],
  ['therapy_toy',      'Favorite toy here','', { promptOverride: 'SKELETON for the therapist: photo of the toy in YOUR room the child reliably reaches for. Different from a home favorite — this is what works in YOUR space.' }],
]);

// --- parent skeletons ------------------------------------------------------
group('Nouns', 'Personalize', 'Family-authored', 'personal.family', { ...SK, audience: 'parent' }, [
  ['bedtime_routine', 'Bedtime',          '', { promptOverride: 'SKELETON for parents: photo of your bedtime routine\'s anchor moment (bath, brush teeth, books in the rocker). Pair with the "good night" gestalt for a complete bedtime script.' }],
  ['grandma_house',   "Grandma's house",  '', { promptOverride: 'SKELETON for parents: photo of grandma\'s front door, OR grandma herself, OR the room your child plays in there. Helps the child name where they\'re going.' }],
  ['grandpa_house',   "Grandpa's house",  '', { promptOverride: 'SKELETON for parents: photo of grandpa\'s house OR grandpa himself. Make one tile per grandparent the child sees regularly.' }],
  ['comfort_object',  'My lovey',         '', { promptOverride: 'SKELETON for parents: photo of THE comfort object (the specific blanket, the specific stuffie). Use the child\'s actual word for it as the label.' }],
  ['family_pet',      'Our pet',          '', { promptOverride: 'SKELETON for parents: photo of YOUR family pet (not a stock dog/cat). Use the pet\'s real name as the label.' }],
  ['family_car',      'Our car',          '', { promptOverride: 'SKELETON for parents: photo of YOUR car (interior with the child\'s car seat visible works great). Pair with "go" + a destination tile.' }],
  ['our_park',        'Our park',         '', { promptOverride: 'SKELETON for parents: photo of the playground or park you visit most. Adds a "where" answer the child can actually request.' }],
  ['special_snack',   'Special snack',    '', { promptOverride: 'SKELETON for parents: photo of THE snack — the one you keep on the top shelf, the one that\'s the reinforcer. Specific is far better than generic.' }],
  ['bath_time',       'Bath time',        '', { promptOverride: 'SKELETON for parents: photo of your bathtub with the bath toys / bubbles your child knows. Pair with "more" and "all done" for full bath-time language.' }],
  ['favorite_book',   'Favorite book',    '', { promptOverride: 'SKELETON for parents: photo of the cover of THE book — the one you\'ve read a hundred times. Pair with "read" or "again".' }],
]);

// --- universal placeholders (media) ---------------------------------------
// Specific titles/IP do NOT live in the canonical library, but every family
// has "their show" and "their song". These are universal skeletons — every
// audience sees them — so any teammate can author the right placeholder when
// the family tells them.
group('Nouns', 'Personalize', 'Media (family-authored)', 'personal.media', { ...SK, audience: 'universal' }, [
  ['favorite_show',     'My show',        '', { promptOverride: 'SKELETON: photo (or screenshot) of the show your child reaches for. We do not bundle specific titles here for licensing reasons — every family fills this in with their own.' }],
  ['favorite_movie',    'My movie',       '', { promptOverride: 'SKELETON: photo (or poster) of the movie the child requests over and over. Same idea as "my show" but for a specific movie.' }],
  ['favorite_song',     'My song',        '', { promptOverride: 'SKELETON: image of the album cover, the speaker, or even just a friendly music note for THE song. Pair with "more" + "again" for full requesting language.' }],
  ['favorite_character','My character',   '', { promptOverride: 'SKELETON: image of the character (toy figure photo works great). The character your child names everything after.' }],
  ['favorite_app',      'My app',         '', { promptOverride: 'SKELETON: photo of the iPad showing the app icon, or the icon itself. Specific app, not "an app" — the one that gets asked for.' }],
]);

// =============================================================================
// TIER 19 — TD SNAP CORE PARITY: GRAMMAR EXTENSIONS
// Helping verbs, more prepositions, conjunctions, negation, quantifiers,
// pronoun extensions. All Stage 5+ broadening vocabulary, concept-mode, no
// photo. Targets parity with the TD Snap Core First syntax layer.
// =============================================================================
group('Needs', 'Linking', 'Helping verbs', 'needs.linking.helping', { mode: 'concept', photo: 'none', ...EXT }, [
  ['am',     'am',     'a friendly young child pointing to themselves with one thumb, simple equals sign next to them indicating "I am ___"'],
  ['are',    'are',    'two friendly young children side by side, each pointing at the other, a soft equals sign between them indicating "you/we are ___"'],
  ['was',    'was',    'a friendly young child looking back over their shoulder with a soft backward arrow indicating past tense'],
  ['have',   'have',   'a friendly young child holding a single small cheerful object with both hands at chest height, "I have ___"'],
  ['has',    'has',    'a friendly young child gesturing toward a teddy bear next to another child, "she/he has ___"'],
  ['had',    'had',    'a friendly young child looking thoughtfully at an empty hand, with a soft past-tense backward arrow above'],
  ['could',  'could',  'a friendly young child shrugging gently with both palms up, a soft "maybe" curved arrow above them'],
  ['would',  'would',  'a friendly young child considering two small cheerful objects in front of them, finger tapping chin'],
]);

group('Needs', 'Linking', 'Conjunctions', 'needs.linking.conj', { mode: 'concept', photo: 'none', ...EXT }, [
  ['or',  'or',  'two cheerful objects (a small ball and a small star) on either side of a soft forked path icon'],
  ['so',  'so',  'a soft arrow leading from a small cheerful event icon to a friendly young child reacting with a small "got it!" face'],
  ['if',  'if',  'a small cheerful question mark hovering above a forked path, gentle "what if?" feeling'],
]);

group('Needs', 'Linking', 'Negation', 'needs.linking.neg', { mode: 'concept', photo: 'none', ...EXT }, [
  ['not',     'not',     'a friendly young child gently shaking their head with one finger raised and a soft red diagonal "no" line near a small cheerful object'],
  ['dont',    "don't",   'a friendly young child holding up both flat hands in a polite refusing gesture, soft red diagonal line nearby', { pron: 'dont' }],
]);

group('Needs', '', 'Prepositions', 'needs.prep', { mode: 'concept', photo: 'none', ...EXT }, [
  ['at',       'at',       'a friendly young child standing at a clearly marked spot (a small painted X on the floor), pointing down to it'],
  ['from',     'from',     'a soft arrow leaving a small cheerful house and heading outward, indicating origin'],
  ['of',       'of',       'a cheerful gift box being gently unwrapped by a friendly young child, revealing a small toy inside ("part of")'],
  ['through',  'through',  'a friendly young child stepping through a small open doorway, soft motion lines'],
  ['around',   'around',   'a friendly young child running in a soft circular path around a small tree, dotted-circle indicator'],
  ['inside',   'inside',   'a friendly young child peeking out from inside a small cheerful cardboard box, both hands on the rim'],
  ['outside',  'outside',  'a friendly young child standing on green grass outside a small house, sun above'],
]);

group('Needs', 'Quantifiers', '', 'needs.quant', { mode: 'concept', photo: 'none', ...EXT }, [
  ['all',     'all',     'a friendly young child standing beside a row of cheerful colorful blocks, both arms wide open indicating "all of them"'],
  ['some',    'some',    'a small handful of cheerful colorful blocks gathered together, with several more remaining off to the side'],
  ['many',    'many',    'a large group of cheerful colorful balls piled together, plain background'],
  ['few',     'few',     'three small cheerful colorful balls standing alone on a plain background'],
  ['much',    'much',    'a small cheerful overflowing cup with a sparkle above, gesture of "this much!"'],
  ['any',     'any',     'a friendly young child shrugging gently with palms up, beside a soft question-mark icon — "any?"'],
  ['none',    'none',    'an empty cheerful cup with a small soft "0" sparkle above, plain background'],
  ['every',   'every',   'a friendly young child holding a single block out of a complete neat row, indicating "each one"'],
]);

group('People', 'Pronouns', 'Extended', 'people.pronouns.more', { mode: 'concept', photo: 'none', ...EXT }, [
  ['him',     'him',     'a friendly young child pointing toward a small boy figure off to the side, palm open'],
  ['her',     'her',     'a friendly young child pointing toward a small girl figure off to the side, palm open'],
  ['his',     'his',     'a friendly young boy holding a small toy close, an arrow pointing back to him indicating possession'],
  ['hers',    'hers',    'a friendly young girl holding a small toy close, an arrow pointing back to her indicating possession'],
  ['these',   'these',   'a friendly young child gesturing down at a small cluster of three nearby cheerful objects with both hands'],
  ['those',   'those',   'a friendly young child pointing forward toward a small cluster of three cheerful objects in the distance'],
]);

// =============================================================================
// TIER 20 — DESCRIPTOR PARITY (good/bad/same/different/full/empty/...)
// =============================================================================
group('Needs', 'Describing', 'Core descriptors', 'needs.describe.core', { mode: 'object', photo: 'none', ...EXT }, [
  ['good',      'good',      'a cheerful round green check mark with a small sparkle, plain background'],
  ['bad',       'bad',       'a soft cheerful red X with a small frown, plain background (gentle, not harsh)'],
  ['same',      'same',      'two identical cheerful round blue balls side by side on a plain background'],
  ['different', 'different', 'a cheerful round blue ball beside a bright yellow star, plain background'],
  ['full',      'full',      'a cheerful cup filled to the brim with bright orange juice'],
  ['empty',     'empty',     'a cheerful empty cup with a small sparkle indicating "nothing inside"'],
  ['on',        'on',        'a small bright lamp glowing warmly, switch flipped up, "powered on" feel', { notes: 'Power state "on" — distinct from spatial "on" preposition.' }],
  ['off',       'off',       'a small dim lamp with a darkened bulb, switch flipped down, "powered off" feel'],
  ['broken',    'broken',    'a small toy car with a single wheel detached and a soft cartoon crack line — needs fixing (not distressing)'],
  ['easy',      'easy',      'a friendly young child smiling broadly while gently completing a simple two-piece puzzle, thumbs up'],
  ['heavy',     'heavy',     'a friendly young child straining lightly to lift a single large box, small effort lines (not distressing)'],
  ['light',     'light_wt',  'a friendly young child easily lifting a single small feather above their head with one finger', { notes: 'Weight "light" — distinct from the visual "light" (lamp) in Home.' }],
]);

// =============================================================================
// TIER 21 — VEHICLES EXPANSION (Priddy First-100-Trucks parity)
// =============================================================================
group('Nouns', 'Vehicles', 'Emergency', 'nouns.vehicles.emerg', { mode: 'object', photo: 'none', ...EXT }, [
  ['fire_truck',  'fire truck',  'a friendly cartoon red fire truck with a small ladder on top, cheerful style', { pron: 'fire truck' }],
  ['police_car',  'police car',  'a friendly cartoon black-and-white police car with a small light bar on top', { pron: 'police car' }],
  ['ambulance',   'ambulance',   'a friendly cartoon white ambulance with a small red cross on the side and a small light on top'],
  ['helicopter',  'helicopter',  'a friendly cartoon blue helicopter with spinning rotor blades, hovering low'],
]);
group('Nouns', 'Vehicles', 'Work', 'nouns.vehicles.work', { mode: 'object', photo: 'none', ...EXT }, [
  ['tractor',       'tractor',       'a friendly cartoon green tractor with large wheels in a small field'],
  ['dump_truck',    'dump truck',    'a friendly cartoon yellow dump truck with the bed slightly tilted, small rocks tumbling out', { pron: 'dump truck' }],
  ['garbage_truck', 'garbage truck', 'a friendly cartoon green garbage truck with an arm lifting a small bin', { pron: 'garbage truck' }],
  ['crane',         'crane',         'a friendly cartoon yellow construction crane with a long arm and a hook lowering'],
  ['cement_mixer',  'cement mixer',  'a friendly cartoon orange cement mixer truck with a rotating drum', { pron: 'cement mixer' }],
  ['bulldozer',     'bulldozer',     'a friendly cartoon yellow bulldozer with a wide front blade pushing a small pile of dirt'],
]);
group('Nouns', 'Vehicles', 'Personal', 'nouns.vehicles.personal', { mode: 'object', photo: 'none', ...EXT }, [
  ['motorcycle', 'motorcycle', 'a friendly cartoon red motorcycle with two wheels, parked, plain background'],
  ['scooter',    'scooter',    "a friendly cartoon child's kick scooter with two small wheels"],
  ['skateboard', 'skateboard', 'a friendly cartoon colorful skateboard with four small wheels'],
  ['taxi',       'taxi',       'a friendly cartoon yellow taxi cab with a small "taxi" sign on top'],
  ['race_car',   'race car',   'a friendly cartoon red race car with a small number circle on the side, soft motion lines', { pron: 'race car' }],
  ['rv',         'RV',         'a friendly cartoon brown-and-white camper / RV with small windows', { pron: 'R V' }],
]);
group('Nouns', 'Vehicles', 'Air & Sea', 'nouns.vehicles.airsea', { mode: 'object', photo: 'none', ...EXT }, [
  ['rocket',     'rocket',     'a friendly cartoon white rocket with a small red nose cone and gentle exhaust flames at the bottom'],
  ['submarine',  'submarine',  'a friendly cartoon yellow submarine with a small periscope on top, underwater bubbles around it'],
  ['sailboat',   'sailboat',   'a friendly cartoon white sailboat with a single triangular sail on calm blue water'],
  ['ship',       'ship',       'a friendly cartoon blue cargo ship with a small smokestack on calm blue water'],
  ['hot_air',    'hot air balloon', 'a friendly cartoon red-and-yellow hot air balloon with a small basket, drifting in a soft blue sky', { pron: 'hot air balloon' }],
]);

// =============================================================================
// TIER 22 — SPORTS (NEW)
// =============================================================================
group('Nouns', 'Sports', '', 'nouns.sports', { mode: 'object', photo: 'none', ...EXT, notes: 'Equipment-focused — the canonical tile shows the ball/equipment; the doing-the-sport verb lives elsewhere.' }, [
  ['soccer',      'soccer',      'a single classic black-and-white soccer ball, centered'],
  ['basketball',  'basketball',  'a single bright orange basketball with black seam lines, centered'],
  ['baseball',    'baseball',    'a single white baseball with red stitching, centered'],
  ['football',    'football',    'a single brown American football with white laces, centered'],
  ['tennis',      'tennis',      'a single bright yellow-green tennis ball, centered'],
  ['hockey',      'hockey',      'a single black hockey puck and a small wooden stick beside it, plain background'],
  ['golf',        'golf',        'a single white golf ball on a small wooden tee, plain background'],
  ['bowling',     'bowling',     'a single black bowling ball beside a small white pin, plain background'],
  ['skating',     'skating',     'a single pair of white ice skates with silver blades, plain background'],
  ['swimming',    'swimming',    'a friendly young child swimming with a kickboard, soft water around them', { mode: 'concept' }],
  ['gymnastics',  'gymnastics',  'a friendly young child mid-cartwheel on a soft mat, cheerful expression', { mode: 'concept' }],
  ['dancing',     'dancing',     'a friendly young child dancing joyfully with arms raised, soft music notes around them', { mode: 'concept' }],
]);

// =============================================================================
// TIER 23 — MUSICAL INSTRUMENTS (NEW)
// =============================================================================
group('Nouns', 'Music', '', 'nouns.music', { mode: 'object', photo: 'none', ...EXT }, [
  ['drum',       'drum',       'a single small cheerful drum with two crossed drumsticks on top'],
  ['guitar',     'guitar',     'a single bright wooden acoustic guitar with six strings, plain background'],
  ['piano',      'piano',      'a single small upright piano with black and white keys showing, plain background'],
  ['violin',     'violin',     'a single small wooden violin with a bow beside it, plain background'],
  ['trumpet',    'trumpet',    'a single bright brass trumpet, plain background'],
  ['flute',      'flute',      'a single silver flute lying horizontally, plain background'],
  ['xylophone',  'xylophone',  'a single small colorful child\'s xylophone with rainbow-colored bars and two small mallets'],
  ['tambourine', 'tambourine', 'a single small tambourine with a colorful ribbon and small jingle disks'],
  ['maracas',    'maracas',    'a single pair of small colorful maracas with curved handles, plain background'],
  ['harmonica',  'harmonica',  'a single small silver harmonica, plain background'],
]);

// =============================================================================
// TIER 24 — TOOLS (NEW)
// =============================================================================
group('Nouns', 'Tools', '', 'nouns.tools', { mode: 'object', photo: 'none', ...EXT, notes: 'Friendly toddler-safe cartoon style.' }, [
  ['hammer',      'hammer',      'a single small friendly cartoon hammer with a wooden handle and a steel head, plain background'],
  ['screwdriver', 'screwdriver', 'a single small friendly cartoon screwdriver with a red handle, plain background'],
  ['wrench',      'wrench',      'a single small friendly cartoon adjustable wrench, plain background'],
  ['saw',         'saw',         'a single small friendly cartoon handsaw with a wooden handle, plain background'],
  ['drill',       'drill',       'a single small friendly cartoon power drill with a yellow body and a small bit, plain background'],
  ['paintbrush',  'paintbrush',  'a single small friendly paintbrush with a wooden handle and bright bristles, dab of paint on the tip'],
  ['toolbox',     'toolbox',     'a single small friendly red toolbox with a sturdy handle on top, lid closed'],
]);

// =============================================================================
// TIER 25 — KITCHEN APPLIANCES (Home/Kitchen extension)
// =============================================================================
group('Nouns', 'Home', 'Kitchen', 'nouns.home.kitchen', { mode: 'object', photo: 'none', ...EXT, notes: 'Scene: kitchen' }, [
  ['refrigerator', 'refrigerator', 'a single friendly cartoon white refrigerator with a small handle, plain background', { pron: 'refrigerator' }],
  ['oven',         'oven',         'a single friendly cartoon white oven with a small window in the door, plain background'],
  ['stove',        'stove',        'a single friendly cartoon stovetop with four small burner circles, plain background'],
  ['microwave',    'microwave',    'a single friendly cartoon white microwave with a small window and button panel'],
  ['sink',         'sink',         'a single friendly cartoon kitchen sink with a small faucet, plain background'],
  ['dishwasher',   'dishwasher',   'a single friendly cartoon white dishwasher with a small handle on the front'],
  ['blender',      'blender',      'a single friendly cartoon blender with a small clear pitcher and a colorful smoothie inside'],
  ['toaster',      'toaster',      'a single friendly cartoon silver toaster with two small slots and a slice of bread peeking out'],
  ['bowl',         'bowl',         'a single small cheerful empty bowl on a plain background'],
  ['pot',          'pot',          'a single small cooking pot with a single handle, plain background'],
  ['pan',          'pan',          'a single small frying pan with a single handle, plain background'],
  ['knife',        'knife',        'a single small child-safe butter knife, plain background'],
]);

// Mealtime gear that an AAC toddler actually reaches for at the table —
// the bib / straw / sippy cup layer that lives between "cup" and "fork".
group('Nouns', 'Home', 'Mealtime', 'nouns.home.mealtime', { mode: 'object', photo: 'none', ...EXT, notes: 'Scene: kitchen, table.' }, [
  ['napkin',       'napkin',       'a single folded paper napkin on a plain background'],
  ['straw',        'straw',        'a single colorful striped drinking straw, plain background'],
  ['bib',          'bib',          "a single small child's bib with a cheerful pattern, plain background"],
  ['sippy_cup',    'sippy cup',    "a single small toddler sippy cup with a spout lid and two handles, plain background", { pron: 'sippy cup' }],
  ['water_bottle', 'water bottle', "a single small child's reusable water bottle with a spout lid, plain background", { pron: 'water bottle' }],
  ['mug',          'mug',          'a single small cheerful mug with a handle, plain background'],
  ['tray',         'tray',         'a single small cheerful tray with raised edges, plain background'],
  ['pitcher',      'pitcher',      'a single small clear pitcher with a handle and a spout, plain background'],
  ['placemat',     'placemat',     'a single small cheerful placemat with a fun pattern, plain background'],
  ['lunchbox',     'lunchbox',     "a single small cheerful child's lunchbox with a handle, closed, plain background"],
  ['thermos',      'thermos',      'a single small insulated thermos with a screw-on cap, plain background'],
]);

// =============================================================================
// TIER 26 — BATHROOM ITEMS
// =============================================================================
group('Nouns', 'Home', 'Bathroom', 'nouns.home.bathroom', { mode: 'object', photo: 'none', ...EXT, notes: 'Scene: bathroom' }, [
  ['toothbrush', 'toothbrush', "a single small child's toothbrush with colorful bristles, plain background"],
  ['toothpaste', 'toothpaste', 'a single small tube of toothpaste with the cap on, plain background'],
  ['comb',       'comb',       'a single small plastic comb, plain background'],
  ['brush',      'hairbrush',  'a single small hairbrush with a wooden handle and soft bristles, plain background'],
  ['mirror',     'mirror',     'a single small framed bathroom mirror reflecting a soft light, plain background'],
  ['shampoo',    'shampoo',    'a single small friendly bottle of shampoo with a cheerful label, plain background'],
  ['shower',     'shower',     'a single friendly cartoon shower head with a few soft water droplets falling'],
  ['faucet',     'faucet',     'a single small friendly chrome faucet with a soft stream of water flowing'],
]);

// =============================================================================
// TIER 27 — OUTDOOR / YARD
// =============================================================================
group('Nouns', 'Places', 'Outdoor', 'nouns.places.outdoor', { mode: 'object', photo: 'none', ...EXT, notes: 'Scene: outside' }, [
  ['sandbox',   'sandbox',   "a single small wooden sandbox with bright sand and a small bucket and shovel inside"],
  ['swing',     'swing',     "a single small playground swing hanging from soft ropes"],
  ['slide',     'slide',     'a single small bright red playground slide with a small ladder', { notes: 'The play slide — distinct from the verb "slide".' }],
  ['sprinkler', 'sprinkler', 'a single friendly garden sprinkler with soft water arcs in the air'],
  ['hose',      'hose',      'a single coiled green garden hose with a small nozzle, plain background'],
  ['sidewalk',  'sidewalk',  'a single section of friendly sidewalk with soft chalk drawings, plain background'],
  ['driveway',  'driveway',  'a single small friendly driveway leading up to a small house, plain background'],
  ['mailbox',   'mailbox',   'a single small friendly red mailbox with the flag up, plain background'],
]);

// =============================================================================
// TIER 28 — SKY / SPACE
// =============================================================================
group('Nouns', 'Nature', 'Sky', 'nouns.nature.sky', { mode: 'object', photo: 'none', ...EXT }, [
  ['cloud',     'cloud',     'a single soft fluffy white cloud on a pale blue sky background'],
  ['planet',    'planet',    'a single friendly cartoon blue-and-green planet with a soft ring around it, plain dark background'],
  ['comet',     'comet',     'a single friendly cartoon comet with a long soft tail, plain dark background'],
  ['astronaut', 'astronaut', 'a single friendly cartoon astronaut in a white spacesuit, floating gently'],
  ['galaxy',    'galaxy',    'a single soft swirling spiral galaxy with twinkling stars, plain dark background'],
]);

// =============================================================================
// TIER 29 — SEASONS
// =============================================================================
group('Needs', 'Time', 'Seasons', 'needs.time.seasons', { mode: 'object', photo: 'none', ...EXT }, [
  ['spring', 'spring', 'a friendly soft pastel scene — a single tree with new green leaves and a few small pink flowers on the ground'],
  ['summer', 'summer', 'a friendly soft pastel scene — a bright sun in a clear sky over a small beach with a sand bucket'],
  ['fall',   'fall',   'a friendly soft pastel scene — a single tree with warm orange and red leaves, a few leaves falling'],
  ['winter', 'winter', 'a friendly soft pastel scene — a single tree with bare branches and soft snow on the ground'],
]);

// =============================================================================
// TIER 30 — TREATS / SWEETS / CONDIMENTS (Food extension)
// =============================================================================
group('Nouns', 'Food', 'Treats', 'nouns.food.treats', { mode: 'object', photo: 'none', ...EXT, notes: 'Scene: kitchen, party.' }, [
  ['ice_cream',  'ice cream',  'a single scoop of vanilla ice cream in a small waffle cone, plain background', { pron: 'ice cream' }],
  ['cake',       'cake',       'a single small slice of birthday cake with a single candle on top'],
  ['candy',      'candy',      'a single wrapped piece of candy with twisted ends, plain background'],
  ['popcorn',    'popcorn',    'a single small striped popcorn bag with a few popped kernels spilling out'],
  ['donut',      'donut',      'a single round donut with pink frosting and rainbow sprinkles'],
  ['lollipop',   'lollipop',   'a single round lollipop with rainbow swirls on a white stick'],
  ['chocolate',  'chocolate',  'a single small bar of chocolate broken into squares'],
]);
group('Nouns', 'Food', 'Condiments', 'nouns.food.condiments', { mode: 'object', photo: 'none', ...EXT }, [
  ['ketchup', 'ketchup', 'a single small red ketchup bottle with a cheerful label'],
  ['butter',  'butter',  'a single small stick of butter on a small dish'],
  ['syrup',   'syrup',   'a single small bottle of golden maple syrup with a cheerful label'],
  ['jam',     'jam',     'a single small jar of red strawberry jam with a cheerful label'],
  ['salt',    'salt',    'a single small salt shaker with white granules visible inside'],
  ['pepper',  'pepper',  'a single small pepper shaker with dark granules visible inside'],
]);
group('Nouns', 'Food', 'Breakfast', 'nouns.food.breakfast', { mode: 'object', photo: 'none', ...EXT }, [
  ['pancake', 'pancake', 'a single small stack of three pancakes with a pat of butter and a drizzle of syrup'],
  ['waffle',  'waffle',  'a single round waffle with a small pat of butter in the center'],
  ['muffin',  'muffin',  'a single blueberry muffin in a paper liner, plain background'],
  ['bagel',   'bagel',   'a single round bagel sliced in half, plain background'],
  ['oatmeal', 'oatmeal', 'a single small bowl of warm oatmeal with a few blueberries on top'],
]);

// =============================================================================
// TIER 31 — TOY EXTENSIONS (Priddy parity)
// =============================================================================
group('Nouns', 'Toys', 'Extended', 'nouns.toys.more', { mode: 'object', photo: 'none', ...EXT, notes: 'Scene: playroom' }, [
  ['lego',         'building bricks', 'a small handful of colorful plastic building bricks of various shapes and sizes', { pron: 'building bricks', notes: 'Generic label — avoids the trademarked name.' }],
  ['stroller',     'stroller',        "a single small toy stroller for a doll, plain background"],
  ['dollhouse',    'dollhouse',       'a single small open dollhouse showing tiny furniture inside, friendly cartoon style'],
  ['kite',         'kite',            'a single colorful diamond-shaped kite with a small ribbon tail'],
  ['jumprope',     'jump rope',       'a single colorful jump rope with two small wooden handles', { pron: 'jump rope' }],
  ['hula_hoop',    'hula hoop',       'a single colorful hula hoop standing upright, plain background', { pron: 'hula hoop' }],
  ['play_doh',     'play dough',      'a small handful of colorful play dough in three small rounded balls', { pron: 'play dough' }],
  ['stickers',     'stickers',        'a small sheet of colorful star and heart stickers'],
  ['robot_toy',    'robot',           'a single small friendly cartoon toy robot with antenna and a cheerful face'],
  ['action_figure','action figure',   'a single small generic plastic toy figure standing upright, plain background', { pron: 'action figure' }],
  ['marble',       'marble',          'a small glass marble with swirling blue and yellow inside'],
  ['slinky',       'slinky',          'a small spring-toy slinky stretched between two surfaces, soft metallic'],
]);

// =============================================================================
// TIER 32 — VERB EXTENSION (action verbs from first-words books)
// =============================================================================
group('Verbs', 'Actions', 'More', 'verbs.actions.extra', { mode: 'concept', photo: 'none', ...EXT }, [
  ['kiss',     'kiss',     'a friendly young child blowing a kiss with one hand, a small soft heart floating from their hand'],
  ['climb',    'climb',    'a friendly young child carefully climbing a small wooden ladder, both hands gripping'],
  ['hop',      'hop',      'a friendly young child mid-hop on one foot, soft motion lines below'],
  ['skip',     'skip',     'a friendly young child mid-skip, one knee raised, soft motion lines below'],
  ['swim',     'swim',     'a friendly young child swimming in calm water with goggles on, soft splashes around'],
  ['blow',     'blow',     'a friendly young child blowing softly at a dandelion, small fluff drifting away'],
  ['paint',    'paint',    'a friendly young child painting on a small easel with a colorful brush, focused smile'],
  ['dig',      'dig',      'a friendly young child kneeling in sand using a small shovel, small pile beside them'],
  ['splash',   'splash',   'a friendly young child splashing in a small puddle, soft water droplets in the air'],
  ['color',    'color',    'a friendly young child coloring on a sheet of paper with a small bright crayon, focused smile'],
  ['cut',      'cut',      'a friendly young child carefully using child-safe scissors on a small piece of paper'],
  ['glue',     'glue',     'a friendly young child gently applying glue from a small glue stick to a piece of paper'],
  ['pour',     'pour',     'a friendly young child carefully pouring water from a small pitcher into a cup'],
  ['stir',     'stir',     'a friendly young child stirring a small bowl with a wooden spoon, focused smile'],
  ['ride',     'ride',     'a friendly young child riding a small tricycle, hands on the handlebars'],
  ['fly',      'fly',      'a friendly young child holding a small toy airplane up high, pretending to make it fly'],
  ['fall',     'fall_v',   'a friendly young child gently sitting down on a soft mat, surprised but unhurt', { notes: 'Verb "fall" — distinct from the season.' }],
  ['fix',      'fix',      'a friendly young child gently using a small toy screwdriver on a small toy, focused face'],
]);

// =============================================================================
// TIER 33 — FAMILY-CONTEXT AFFECTION (audience='parent')
// Day-roleplay analysis: phrases like kiss/snuggle/tickle/carry-me belong to
// caregiver-child intimate context. Tiles live in the canonical library so the
// child CAN use them anywhere (e.g. "I love you" said to mom at school pickup),
// but the AUDIENCE field flags them as parent-authoring suggestions only —
// teachers/therapists won't be prompted to add them when building boards.
// =============================================================================
group('Needs', 'Social', 'Family', 'needs.social.family', { mode: 'concept', photo: 'none', ...EXT, audience: 'parent' }, [
  ['family_hug',     'family hug',      'a friendly young child in the middle of a warm group hug with two adults, soft smiles'],
  ['kiss_affection', 'goodnight kiss',  'a friendly parent gently kissing a sleepy young child on the forehead, soft warm light', { pron: 'goodnight kiss' }],
  ['snuggle',        'snuggle',         'a friendly young child snuggled under a soft blanket close to a parent figure, warm smile'],
  ['cuddle',         'cuddle',          'a friendly young child being held closely by a parent figure, both smiling softly'],
  ['tickle',         'tickle',          'a friendly young child laughing brightly while being tickled by a parent figure (gentle, joyful)'],
  ['piggyback',      'piggyback',       'a friendly young child riding piggyback on a parent figure, both grinning broadly'],
]);

// Family-context gestalts surfaced only to parent-role authoring. Same logic
// as TIER 4 gestalts (gestalt_type / meaning / targets), but the audience is
// 'parent' so school/therapy authoring doesn't suggest them.
group('Needs', 'Social', 'Family gestalts', 'needs.gestalts.family', { mode: 'concept', photo: 'none', ...EXT, audience: 'parent', isGestalt: true, gestaltType: 'compositional' }, [
  ['carry_me',         'carry me',         'a friendly young child reaching both arms up toward a parent figure, eager pleading smile', { gestaltMeaning: 'asking to be picked up', gestaltTargets: ['carry', 'me', 'up'] }],
  ['hold_me',          'hold me',          'a friendly young child holding both arms out toward a parent figure, wanting comfort', { gestaltMeaning: 'asking for comfort', gestaltTargets: ['hold', 'me'] }],
  ['one_more_book',    'one more book',    'a friendly young child in pajamas in bed holding up a picture book with both hands, gentle pleading smile', { gestaltMeaning: 'asking to extend bedtime reading', gestaltTargets: ['one', 'more', 'book'] }],
  ['snuggle_with_me',  'snuggle with me',  'a friendly young child patting the spot next to them on a soft blanket, inviting a parent to sit', { gestaltMeaning: 'inviting a cuddle', gestaltTargets: ['snuggle', 'with', 'me'] }],
  ['tuck_me_in',       'tuck me in',       'a friendly young child in bed pulling a blanket up to their chin, gentle smile, a parent figure adjusting it', { gestaltMeaning: 'bedtime ritual request', gestaltTargets: ['tuck', 'me', 'in'] }],
  ['read_to_me',       'read to me',       'a friendly young child handing a picture book up to a parent figure, eager smile', { gestaltMeaning: 'asking to be read to', gestaltTargets: ['read', 'to', 'me'] }],
]);

// =============================================================================
// TIER 34 — UNIVERSAL DAILY GESTALTS (meal + transition)
// Day-roleplay surfaced: hungry/thirsty/yummy/yucky are universal phrases the
// child says to ANY caregiver. Stay audience='universal'.
// =============================================================================
group('Needs', 'Social', 'Daily gestalts', 'needs.gestalts.daily', { mode: 'concept', photo: 'none', ...EXT, isGestalt: true, gestaltType: 'compositional' }, [
  ['im_hungry',     "I'm hungry",      'a friendly young child rubbing their stomach with one hand, slightly droopy look, soft "hungry" feeling', { gestaltMeaning: 'requesting food', gestaltTargets: ['i', 'am', 'hungry'], pron: "I'm hungry" }],
  ['im_thirsty',    "I'm thirsty",     'a friendly young child holding an empty cup forward, gentle "I need a drink" expression', { gestaltMeaning: 'requesting a drink', gestaltTargets: ['i', 'am', 'thirsty'], pron: "I'm thirsty" }],
  ['yummy',         'yummy',           'a friendly young child rubbing their tummy with one hand, big delighted smile after a bite', { gestaltMeaning: 'expressing food enjoyment', gestaltTargets: ['yummy', 'good'] }],
  ['yucky',         'yucky',           'a friendly young child gently pushing a small plate away with one hand, slight wrinkled-nose expression (not distressed)', { gestaltMeaning: 'expressing food refusal', gestaltTargets: ['yucky', 'no'] }],
  ['i_did_it',      'I did it',        'a friendly young child standing proudly beside a small completed tower of blocks, arms up in celebration', { gestaltMeaning: 'announcing accomplishment', gestaltTargets: ['i', 'did', 'it'], pron: 'I did it' }],
  ['i_need_a_break','I need a break',  'a friendly young child gently raising one open palm with a soft "pause" face, calm not distressed', { gestaltMeaning: 'requesting a break', gestaltTargets: ['i', 'need', 'break'], pron: 'I need a break' }],
  ['try_again',     'try again',       'a friendly young child looking determined while reaching toward a small puzzle piece, soft "again" arrow above'],
  ['good_job',      'good job',        'a friendly adult hand giving a thumbs-up beside a friendly young child smiling, soft sparkle'],
  ['my_turn',       'my turn now',     'a friendly young child smiling and pointing at themselves with both thumbs, eager but polite', { gestaltMeaning: 'turn-taking request', gestaltTargets: ['my', 'turn'] }],
  ['your_turn',     'your turn',       'a friendly young child handing a small toy forward toward another child, polite smile', { gestaltMeaning: 'turn-taking offer', gestaltTargets: ['your', 'turn'] }],
]);

// =============================================================================
// TIER 35 — SCHOOL-CONTEXT TILES (audience='school_team', canonical not skeleton)
// Day-roleplay: phrases that mostly fire at school. Canonical because every
// school uses them — only the photo differs from the classroom-specific
// skeletons in TIER 18.
// =============================================================================
group('Needs', 'Social', 'Classroom', 'needs.social.school', { mode: 'concept', photo: 'none', ...EXT, audience: 'school_team' }, [
  ['raise_hand',     'raise my hand',  'a friendly young child sitting at a small desk raising one hand high, eager to participate'],
  ['may_i',          'may I',          'a friendly young child gently raising one finger with a polite tilted head, "may I?" feeling'],
  ['line_leader',    'line leader',    'a friendly young child at the front of a small line of students, hand on hip, proud smile'],
  ['quiet_please',   'quiet please',   'a friendly young child holding one finger to their lips with a polite smile'],
  ['my_turn_share',  'sharing time',   'a friendly young child holding a small show-and-tell object out to the viewer with both hands, big smile'],
  ['circle_time',    'circle time',    'a friendly young child sitting cross-legged on a colorful rug among other children, attentive smile'],
  ['centers_time',   'centers',        'a friendly young child at a small classroom table with manipulatives, focused smile', { notes: 'Canonical illustration; school-team skeleton in TIER 18 lets the teacher swap to their actual room.' }],
]);

// =============================================================================
// TIER 36 — LONG-TAIL BREADTH (TD Snap symbol-library parity, age-appropriate)
// Categories filled in after sanity-checking what a 3-7 year old reaches for
// daily that we still didn't have: L/R, tech the kid sees on the iPad, more
// foods, more animals, professions, geography, money, more time slices.
// All Stage 5+ broadening; everything audience='universal' unless noted.
// =============================================================================

// Directional / spatial — L/R is the surprisingly absent gap.
group('Needs', '', 'Direction', 'needs.direction', { mode: 'concept', photo: 'none', ...EXT }, [
  ['left',   'left',   'a friendly young child standing facing the viewer pointing clearly to their left with one hand, a soft directional arrow following'],
  ['right',  'right',  'a friendly young child standing facing the viewer pointing clearly to their right with one hand, a soft directional arrow following'],
  ['top',    'top',    'a friendly young child reaching up toward the top of a small stack of three colorful blocks, the top block highlighted'],
  ['bottom', 'bottom', 'a friendly young child crouching beside a small stack of three colorful blocks, the bottom block highlighted'],
  ['middle', 'middle', 'a friendly young child standing between two small trees, with a soft circle around them indicating "in the middle"'],
  ['front',  'front',  'a friendly young child standing in front of a small house with a forward-pointing soft arrow at their feet'],
  ['back',   'back',   'a friendly young child standing behind a small tree, peeking around, with a soft backward arrow indicating "back"'],
  ['side',   'side',   'a friendly young child standing beside a small tree with one hand touching it, soft "next to" indicator'],
]);

// Expressive verbs the existing verbs.actions set misses.
group('Verbs', 'Actions', 'Expressive', 'verbs.actions.expr', { mode: 'concept', photo: 'none', ...EXT }, [
  ['laugh',   'laugh',   'a friendly young child laughing brightly with both hands on belly, eyes squeezed shut in giggles'],
  ['cry',     'cry',     'a friendly young child with a gentle sad face and a single soft tear (gentle, not distressing)'],
  ['smile',   'smile',   'a friendly young child with a wide warm smile, head-and-shoulders framing'],
  ['frown',   'frown',   'a friendly young child with a small gentle frown and downturned mouth (not distressed)'],
  ['shout',   'shout',   'a friendly young child with cupped hands around their mouth, calling out loudly, soft sound waves'],
  ['whisper', 'whisper', 'a friendly young child leaning in with one hand cupped beside their mouth, sharing a secret'],
  ['squeeze', 'squeeze', 'a friendly young child gently squeezing a small stuffed animal with both hands'],
  ['pinch',   'pinch',   'a friendly young child gently pinching a small soft object between thumb and finger'],
  ['bounce',  'bounce',  'a friendly young child mid-bounce on a soft mat, soft motion lines, joyful smile'],
  ['roll',    'roll',    'a friendly young child rolling sideways on a soft grassy lawn, soft motion lines, giggling'],
]);

// Tech / devices the AAC kid sees every day.
group('Nouns', 'Home', 'Tech', 'nouns.home.tech', { mode: 'object', photo: 'none', ...EXT }, [
  ['phone',      'phone',      "a single small friendly smartphone with a colorful screen, plain background"],
  ['laptop',     'laptop',     'a single small friendly laptop computer with the lid open and a colorful screen, plain background'],
  ['tablet',     'tablet',     'a single small friendly tablet with a colorful screen, plain background'],
  ['headphones', 'headphones', 'a single pair of friendly over-ear headphones in a cheerful color, plain background'],
  ['charger',    'charger',    'a single small friendly phone charger cable with a plug on one end, plain background'],
  ['remote',     'remote',     'a single small TV remote with a few colorful buttons, plain background'],
  ['camera',     'camera',     'a single small friendly cartoon camera with a soft round lens, plain background'],
  ['button',     'button',     'a single large round friendly button, slightly raised, plain background'],
  ['screen',     'screen',     'a single small friendly device screen showing a soft colorful gradient, plain background'],
  ['speaker',    'speaker',    'a single small friendly bluetooth speaker with a cheerful color, plain background'],
]);

// Long-tail animals (the next chunk after the existing Pets/Farm/Sea/Forest/…).
group('Nouns', 'Animals', 'Reptiles & Amphibians', 'nouns.animals.reptiles', { mode: 'object', photo: 'none', ...EXT }, [
  ['frog',       'frog',       'a friendly cartoon green frog with big eyes, sitting on a small lily pad'],
  ['toad',       'toad',       'a friendly cartoon brown toad with bumpy skin, small smile, plain background'],
  ['alligator',  'alligator',  'a friendly cartoon green alligator with a small smile (not scary), short legs visible'],
  ['crocodile',  'crocodile',  'a friendly cartoon green crocodile with a small smile (not scary), short legs visible'],
  ['gecko',      'gecko',      'a friendly cartoon spotted gecko clinging to a small branch, big curious eyes'],
  ['chameleon',  'chameleon',  'a friendly cartoon green chameleon with a curled tail, soft color gradient, big eyes'],
]);
group('Nouns', 'Animals', 'More mammals', 'nouns.animals.mammals.more', { mode: 'object', photo: 'none', ...EXT }, [
  ['beaver',     'beaver',     'a friendly cartoon brown beaver with a flat tail and small front teeth, gentle smile'],
  ['otter',      'otter',      'a friendly cartoon brown otter floating on its back, holding a small stone on its tummy'],
  ['hedgehog',   'hedgehog',   'a friendly cartoon brown hedgehog with soft spines and a tiny round nose'],
  ['cheetah',    'cheetah',    'a friendly cartoon spotted cheetah with a long tail, mid-run with soft motion lines'],
  ['leopard',    'leopard',    'a friendly cartoon spotted leopard sitting on a small branch, gentle smile'],
  ['jaguar',     'jaguar',     'a friendly cartoon spotted jaguar sitting calmly, gentle smile'],
  ['sloth',      'sloth',      'a friendly cartoon brown sloth hanging from a small branch with a sleepy smile'],
  ['mouse_a',    'mouse',      'a friendly cartoon gray mouse with round ears and a small smile, plain background', { notes: 'The animal — distinct from the computer mouse device.' }],
  ['bat',        'bat',        'a friendly cartoon brown bat with small wings, hanging upside-down with a small smile'],
  ['chipmunk',   'chipmunk',   'a friendly cartoon brown chipmunk with stripes on its back, holding a tiny acorn'],
  ['skunk',      'skunk',      'a friendly cartoon black-and-white skunk with a bushy tail and a small smile (gentle)'],
  ['opossum',    'opossum',    'a friendly cartoon gray opossum with a long tail and a gentle smile'],
]);

// Long-tail food meals — the cultural-staples chunk.
group('Nouns', 'Food', 'Meals more', 'nouns.food.meals.more', { mode: 'object', photo: 'none', ...EXT }, [
  ['hamburger',  'hamburger',  'a single classic hamburger with a sesame seed bun, lettuce, and cheese visible'],
  ['hot_dog',    'hot dog',    'a single hot dog in a bun with a small line of ketchup on top', { pron: 'hot dog' }],
  ['taco',       'taco',       'a single soft taco with colorful filling visible, folded'],
  ['burrito',    'burrito',    'a single rolled burrito wrapped in a soft tortilla, plain background'],
  ['soup',       'soup',       'a single small bowl of warm soup with a friendly steam swirl above'],
  ['salad',      'salad',      'a single small bowl of fresh mixed salad with bright green leaves and red tomato'],
  ['noodles',    'noodles',    'a single small bowl of noodles with a soft steam swirl above, chopsticks beside'],
  ['fries',      'fries',      'a single small paper cup of golden french fries'],
  ['dumpling',   'dumpling',   'a single small steamed dumpling with a soft pleated top, plain background'],
  ['sushi',      'sushi',      'a single piece of sushi (rice topped with a small piece of salmon), plain background'],
]);

// Long-tail fruits + vegetables.
group('Nouns', 'Food', 'Fruit more', 'nouns.food.fruit.extra', { mode: 'object', photo: 'none', ...EXT }, [
  ['lemon',       'lemon',       'a single bright yellow lemon with a small green leaf'],
  ['lime',        'lime',        'a single bright green lime with a small green leaf'],
  ['avocado',     'avocado',     'a single avocado halved, showing the bright green flesh and round pit'],
  ['coconut',     'coconut',     'a single whole brown coconut with three small dots on the shell'],
  ['plum',        'plum',        'a single purple plum with a small green leaf'],
  ['pomegranate', 'pomegranate', 'a single bright red pomegranate cut open showing ruby seeds inside'],
]);
group('Nouns', 'Food', 'Veg more', 'nouns.food.veg.extra', { mode: 'object', photo: 'none', ...EXT }, [
  ['spinach',     'spinach',     'a single small bunch of fresh dark green spinach leaves'],
  ['eggplant',    'eggplant',    'a single large purple eggplant with a small green stem'],
  ['zucchini',    'zucchini',    'a single long green zucchini, plain background'],
  ['cauliflower', 'cauliflower', 'a single head of white cauliflower with a few small green leaves'],
  ['squash',      'squash',      'a single bright orange butternut squash, plain background'],
  ['asparagus',   'asparagus',   'a single small bundle of green asparagus spears tied with a small string'],
]);

// Clothing extension.
group('Nouns', 'Clothes', 'Extended', 'nouns.clothes.extra', { mode: 'object', photo: 'none', ...EXT }, [
  ['dress',      'dress',      "a single small cheerful child's dress on a hanger"],
  ['skirt',      'skirt',      'a single small bright skirt on a hanger'],
  ['shorts',     'shorts',     'a single pair of small bright cotton shorts'],
  ['swimsuit',   'swimsuit',   "a single small one-piece child's swimsuit with a fun pattern"],
  ['hoodie',     'hoodie',     "a single cozy child's hoodie with the hood up, laid flat"],
  ['slippers',   'slippers',   "a single pair of small fluffy child's slippers"],
  ['boots',      'boots',      "a single pair of small child's boots, plain background"],
  ['sandals',    'sandals',    "a single pair of small child's sandals"],
  ['gloves',     'gloves',     'a single pair of warm winter gloves, plain background'],
  ['robe',       'robe',       "a single cozy small child's bathrobe with a tied belt"],
]);

// Professions / community workers.
group('People', 'Community', 'Workers', 'people.community.workers', { mode: 'person', photo: 'none', ...EXT }, [
  ['dentist',      'dentist',      'a friendly cartoon dentist in a white coat holding a small toothbrush, gentle smile'],
  ['vet',          'vet',          'a friendly cartoon veterinarian in a blue coat gently holding a small cartoon puppy', { pron: 'vet' }],
  ['mechanic',     'mechanic',     'a friendly cartoon mechanic in coveralls holding a small wrench, soft smile'],
  ['librarian',    'librarian',    'a friendly cartoon librarian holding a small stack of picture books, soft smile'],
  ['chef',         'chef',         'a friendly cartoon chef in a tall white hat holding a small wooden spoon, big smile'],
  ['farmer',       'farmer',       'a friendly cartoon farmer in overalls holding a small basket of vegetables, big smile'],
  ['mail_carrier', 'mail carrier', 'a friendly cartoon mail carrier with a satchel of letters, big friendly wave', { pron: 'mail carrier' }],
  ['plumber',      'plumber',      'a friendly cartoon plumber holding a small wrench beside a small sink, soft smile'],
  ['firefighter',  'firefighter',  'a friendly cartoon firefighter in a bright red helmet, holding a small hose, big smile'],
  ['police',       'police officer','a friendly cartoon police officer with a friendly wave, soft uniform, gentle smile', { pron: 'police officer' }],
]);

// Time precision additions.
group('Needs', 'Time', 'Units', 'needs.time.units', { mode: 'concept', photo: 'none', ...EXT }, [
  ['second',   'second',   'a friendly stopwatch with the second hand sweeping, a single tick marked'],
  ['week',     'week',     'a friendly small weekly calendar showing seven boxes in a row, one highlighted'],
  ['year',     'year',     'a friendly small twelve-month calendar wheel, soft pastel colors'],
  ['weekend',  'weekend',  'a friendly calendar with Saturday and Sunday highlighted in warm color, sun above'],
  ['weekday',  'weekday',  'a friendly calendar with Monday through Friday highlighted in cool color'],
  ['tonight',  'tonight',  'a friendly calendar with today highlighted plus a small crescent moon icon indicating evening'],
]);

// Additional feelings — the layer above the 19 we have.
group('Needs', 'Feelings', 'Extended', 'needs.feelings.extra', { mode: 'concept', photo: 'none', ...EXT }, [
  ['jealous',      'jealous',      'a friendly young child watching another child enjoy a toy with a small thoughtful look (gentle)'],
  ['disappointed', 'disappointed', 'a friendly young child looking down at an empty hand with a small soft sigh, gentle expression'],
  ['grateful',     'grateful',     'a friendly young child with hands clasped at chest and a warm soft smile, small soft heart above'],
  ['brave',        'brave',        'a friendly young child standing tall with chest out and a confident determined smile, soft cape on the shoulders'],
  ['curious',      'curious',      'a friendly young child leaning forward with wide eyes inspecting a small flower, finger to chin'],
  ['hopeful',      'hopeful',      'a friendly young child looking up at the sky with a small soft star above, gentle hopeful smile'],
  ['shy',          'shy',          'a friendly young child peeking out from behind a parent\'s leg with a small bashful smile'],
]);

// Adverbs as a NEW category — manner + frequency words.
group('Needs', 'Adverbs', '', 'needs.adverbs', { mode: 'concept', photo: 'none', ...EXT }, [
  ['quickly',    'quickly',    'a friendly young child mid-run with strong soft motion lines indicating speed'],
  ['slowly',     'slowly',     'a friendly young child taking a single careful step, with a small soft sleepy snail beside them'],
  ['carefully',  'carefully',  'a friendly young child carefully carrying a stack of three blocks, tongue out in focus'],
  ['gently',     'gently',     'a friendly young child softly petting a small cartoon bunny with one finger'],
  ['loudly',     'loudly',     'a friendly young child cupping hands around mouth shouting out, large soft sound waves'],
  ['quietly',    'quietly',    'a friendly young child tiptoeing on bare feet with a finger to lips'],
  ['always',     'always',     'a friendly clock face with both hands sweeping continuously, soft motion circle around it'],
  ['never',      'never',      'a soft cheerful red diagonal "no" line through a small clock face'],
  ['sometimes',  'sometimes',  'a friendly clock face with a small soft shrug-emoji beside it'],
  ['almost',     'almost',     'a friendly young child nearly reaching a small cheerful object on a shelf, fingertips just short'],
]);

// Geography mini.
group('Nouns', 'Places', 'Geography', 'nouns.places.geo', { mode: 'object', photo: 'none', ...EXT }, [
  ['country',  'country',  'a single small friendly globe with one country highlighted in a warm color'],
  ['city',     'city',     'a single small friendly skyline of a few tall buildings, soft sky behind'],
  ['town',     'town',     'a single small friendly cluster of small buildings with a church steeple, plain background'],
  ['street',   'street',   'a single small friendly empty street with sidewalks and a stoplight, plain background'],
  ['map',      'map',      'a single small friendly folded paper map with a few colorful regions and a small star'],
  ['flag',     'flag',     'a single small friendly cartoon flag on a pole, plain background (generic — no specific country)'],
  ['ocean',    'ocean',    'a single calm ocean horizon with soft blue water and a few gentle waves'],
  ['mountain', 'mountain', 'a single tall friendly cartoon mountain with a soft snow cap, plain background'],
  ['river',    'river',    'a single calm blue river winding through soft green banks, plain background'],
  ['beach',    'beach',    'a single small friendly beach scene — soft sand, a small bucket, calm waves at the edge'],
  ['lake',     'lake',     'a single small calm lake surrounded by soft green grass, plain background'],
  ['forest',   'forest',   'a single small friendly forest scene — a few tall trees and a soft green floor'],
]);

// Money / shopping basics.
group('Nouns', 'Money', '', 'nouns.money', { mode: 'object', photo: 'none', ...EXT }, [
  ['money',    'money',    'a small friendly stack of paper bills with a few coins beside it'],
  ['dollar',   'dollar',   'a single small friendly cartoon dollar bill, plain background'],
  ['coin',     'coin',     'a single small friendly silver coin with a soft sparkle'],
  ['wallet',   'wallet',   'a single small friendly leather wallet, plain background'],
  ['receipt',  'receipt',  'a single small paper receipt with a few short lines on it'],
  ['list',     'list',     'a single small notepad with a few items checked off in a small list'],
  ['cart',     'cart',     'a single small friendly shopping cart with a few groceries inside'],
  ['change',   'change',   'a small handful of coins of different sizes, plain background'],
]);

// Body parts extension — the ones still missing.
group('Nouns', 'Body', 'Joints', 'nouns.body.joints', { mode: 'object', photo: 'none', ...EXT }, [
  ['ankle',    'ankle',    "a friendly young child's bare foot showing the ankle joint clearly, soft cartoon style"],
  ['hip',      'hip',      "a friendly young child with one hand on their hip, standing in a relaxed pose"],
  ['waist',    'waist',    "a friendly young child standing with both hands on their waist"],
  ['knuckle',  'knuckle',  "a friendly young child's clenched hand showing the knuckles clearly, soft cartoon style"],
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
  // Skeletons carry human-authoring instructions instead of an image-generation
  // template, so they are exempt from the {style}/{reference}/{parent_photo}/
  // subject checks that gate canonical tiles.
  const isSkeleton = r.authoringKind === 'personal_skeleton';
  if (!isSkeleton) {
    if (!prompt.includes('{style}')) problems.push('no {style} ' + r.id);
    // People that personalize from a photo must carry the right token; generic
    // people (teacher/doctor) and all object/concept tiles must have a real subject.
    const portrait = r.parentPhotoBehavior === 'override' || r.subjectMode === 'child_as_subject';
    if (r.parentPhotoBehavior === 'override' && !prompt.includes('{parent_photo}')) problems.push('override w/o {parent_photo} ' + r.id);
    if (r.subjectMode === 'child_as_subject' && !prompt.includes('{reference}')) problems.push('child w/o {reference} ' + r.id);
    if (!portrait && !String(r.subject).trim()) problems.push('empty subject ' + r.id);
  }
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

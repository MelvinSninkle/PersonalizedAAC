// taxonomy/fill-acquisition-age.mjs
//
// Backfills the `acquisition_age` column on seed-core-v1.csv with the
// approximate developmental band a typical child acquires each word in.
// Purpose: support early-intervention boards by hiding clutter the child
// hasn't grown into yet — the column is advisory, never a gate.
//
// Five bands (chosen to give clear granularity at the early end, where
// filtering matters most for a 12-month-old just starting):
//
//   12-18m  · first words            — the first 30-50 words in MacArthur-Bates
//                                      CDI inventories; immediate family, basic
//                                      requests, core animals/foods/toys
//   18-30m  · vocabulary burst       — explosion to ~300-500 words; most common
//                                      nouns/actions/feelings, first pronouns,
//                                      first question word (what)
//   2-3y    · sentence emergence     — 500-1000 words, two- and three-word
//                                      combinations, more pronouns, where/who,
//                                      simple time/position
//   3-4y    · grammar developing     — full sentences, why/when, complex
//                                      pronouns, past tense, conditionals start
//   4y+     · refined language       — abstract concepts, conditionals (if/
//                                      could/would), clock time, adverbs,
//                                      never/always
//
// Methodology, in priority order:
//   1. SPECIFIC label override — hand-curated lists grounded in MacArthur-Bates
//      CDI, Banajee et al. core-vocabulary research, and Brown's grammatical
//      stages. The early bands are the most important and the most carefully
//      drawn.
//   2. SUBCATEGORY default — e.g. Learning/Colors is 2-3y, Learning/Numbers is
//      3-4y for 1-10 and 4y+ for the rest.
//   3. CATEGORY default — e.g. Animals defaults 18-30m, Adverbs 4y+.
//
// These bands are statistical averages from typical development; individual
// variation is wide, AAC users often follow different trajectories, and the
// values are meant to drive UX (which words show up by default) not to gate
// access. Every value is editable in the taxonomy workbench.
//
// Idempotent: rows that already carry an acquisition_age are left alone, so
// hand edits in the workbench survive re-runs.
//
// Usage:
//   node taxonomy/fill-acquisition-age.mjs --dry    # preview counts + samples
//   node taxonomy/fill-acquisition-age.mjs          # write the CSV

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'seed-core-v1.csv');
const DRY = process.argv.includes('--dry');

// ---- tiny RFC4180 CSV (same as the other fill scripts) ----
function parseCSV(t) {
  const rows = []; let f = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { f.push(cur); cur = ''; }
    else if (c === '\n') { f.push(cur); rows.push(f); f = []; cur = ''; }
    else if (c === '\r') { /* skip */ }
    else cur += c;
  }
  if (cur !== '' || f.length) { f.push(cur); rows.push(f); }
  return rows;
}
function csvCell(s) {
  s = s == null ? '' : String(s);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(rows) { return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'; }
const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

const BANDS = ['12-18m', '18-30m', '2-3y', '3-4y', '4y+'];
const set = (band, words) => Object.fromEntries(words.map(w => [norm(w), band]));

// ---- SPECIFIC LABEL OVERRIDES -------------------------------------------
// These take precedence over category defaults. Curated against MacArthur-
// Bates CDI norms (8-30 months), Banajee core vocab, Brown's stages.
const SPECIFIC = Object.assign(
  {},
  // Band 1 — first 30-50 words. Tight on purpose.
  set('12-18m', [
    // protest/request/social
    'more', 'no', 'yes', 'mine', 'look', 'again', 'all done', 'hi', 'bye',
    'eat', 'drink', 'go', 'stop', 'up', 'down', 'hurt', 'help',
    // immediate family
    'mom', 'mommy', 'mama', 'dad', 'daddy', 'dada', 'me', 'baby',
    // bottle/cup/food
    'milk', 'juice', 'water', 'cookie', 'cracker', 'banana', 'apple', 'cup', 'bottle', 'snack',
    // first animals (the "moo-quack-woof" canon — toddlers learn animal sounds early)
    'dog', 'cat', 'duck', 'cow', 'bird', 'fish', 'horse',
    // basic toys/objects
    'ball', 'book', 'car',
    // body parts a toddler points to
    'tummy', 'head', 'eye', 'nose',
    // clothes/routines
    'shoe', 'hat', 'bath', 'sleep', 'night',
    // basic feelings/descriptors
    'happy', 'sad', 'hot', 'big',
  ]),
  // Band 2 — vocabulary burst (200-500 words by age 2). The bulk of concrete
  // nouns, actions, basic feelings, first pronouns + grammar markers.
  set('18-30m', [
    // expanded core
    'please', 'thank you', 'sorry', 'give', 'open', 'want', 'i want', 'my turn',
    'i like', "i don't like", 'oops', 'uh oh',
    // earliest pronouns (Brown's stage I)
    'i', 'you', 'my',
    // first question word
    'what',
    // body parts
    'hand', 'foot', 'ear', 'hair', 'mouth', 'teeth', 'leg', 'arm', 'finger', 'toe', 'knee', 'belly', 'face',
    // common concrete actions
    'run', 'jump', 'sit', 'stand', 'walk', 'throw', 'catch', 'kick', 'wash', 'play',
    'sing', 'read', 'draw', 'push', 'pull', 'hug', 'wave', 'come', 'dance', 'fall',
    'climb', 'sleep', 'cry', 'kiss', 'tickle', 'jump',
    // basic feelings
    'mad', 'scared', 'tired', 'sick', 'silly', 'excited', 'angry',
    // basic descriptors (early adjective set)
    'little', 'cold', 'dirty', 'clean', 'wet', 'dry', 'soft', 'hard',
    'loud', 'quiet', 'fast', 'slow', 'good', 'bad', 'all gone', 'broken',
    // basic position
    'in', 'out', 'on', 'here',
    // basic time
    'morning', 'now', 'bedtime',
    // first articles + demonstratives
    'a', 'the', 'this',
    // expanded transport/clothes/nature/home
    'bus', 'truck', 'train', 'bike', 'plane', 'boat',
    'shirt', 'pants', 'sock', 'coat', 'diaper',
    'tree', 'flower', 'sun', 'moon', 'star', 'rain', 'snow',
    'door', 'window', 'bed', 'chair', 'table', 'house', 'home', 'outside',
    // routines + people
    'grandma', 'grandpa', 'nana', 'papa', 'brother', 'sister',
  ]),
  // Band 3 — sentence emergence, 500-1000 words, two- and three-word combos.
  set('2-3y', [
    // pronoun expansion
    'he', 'she', 'we', 'your', 'his', 'her', 'us', 'our',
    // question words
    'where', 'who',
    // time
    'later', 'soon', 'today', 'tomorrow', 'afternoon', 'tonight',
    // position
    'under', 'behind', 'next to', 'between', 'inside', 'outside',
    'top', 'bottom', 'middle', 'front', 'back', 'side', 'off',
    // describing
    'sticky', 'sweet', 'sour', 'scary', 'new', 'tall', 'short', 'pretty',
    'bright', 'dark', 'same', 'different', 'rainy', 'snowy', 'sunny', 'cloudy',
    'windy', 'warm', 'cool', 'funny', 'yummy', 'yucky', 'full', 'empty', 'long',
    // feelings (next layer)
    'surprised', 'frustrated', 'calm', 'proud', 'worried', 'lonely',
    'embarrassed', 'shy', 'sleepy', 'hungry', 'thirsty',
    // actions (next layer)
    'brush teeth', 'build', 'think', 'know', 'see', 'hear', 'listen', 'feel',
    'try', 'make', 'do', 'stay', 'fix', 'cook', 'pour', 'find', 'show', 'hold',
    'need', 'love',
    // grammar markers (Brown's stages II-III)
    'is', 'am', 'are', 'can', 'will', 'that', 'it', 'and', 'with',
    // quantifiers
    'all', 'some',
    // social/learning basics
    'red', 'blue', 'green', 'yellow',                   // basic colors
    'circle', 'square', 'triangle',                     // basic shapes
    '1', '2', '3', 'one', 'two', 'three',               // early counting
    'i love you', 'good morning', 'good night',
    "i'm okay", 'okay', 'wait',
    // common early places (band 3 by default; these few are earlier)
    'home', 'outside', 'park', 'school',                 // school the place (the category is band 4)
    'beach', 'store',
  ]),
  // Band 4 — grammar developing, complex sentences, why/when questions.
  set('3-4y', [
    'they', 'them', 'those', 'these', 'him', 'her',
    'why', 'when',
    'was', 'were', 'have', 'has', 'because', 'or', 'for', 'to', 'but',
    'yesterday', 'before', 'after', 'evening', 'weekend',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'over', 'through', 'around',
    'jealous', 'disappointed', 'grateful', 'brave', 'curious', 'hopeful',
    'nervous', 'bored', 'confused',
    'quickly', 'slowly',
    'many', 'much', 'few', 'every',
    'foggy', 'stormy', 'lightning', 'rainbow',
    '4', '5', '6', '7', '8', '9', '10',
    'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'orange', 'purple', 'pink', 'brown', 'black', 'white', 'gray',
    'rectangle', 'oval', 'diamond', 'star', 'heart',
  ]),
  // Band 5 — refined language, conditionals, clock time, abstract concepts.
  set('4y+', [
    'hers',
    'how',
    'had', 'could', 'would', 'should', 'so', 'if', 'not', "don't",
    'noon', 'midnight', 'half past', 'quarter', 'minute', 'hour',
    "o'clock", "1 o'clock", "2 o'clock", "3 o'clock", "4 o'clock", "5 o'clock",
    "6 o'clock", "7 o'clock", "8 o'clock", "9 o'clock", "10 o'clock",
    "11 o'clock", "12 o'clock",
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'carefully', 'gently', 'loudly', 'quietly', 'always', 'sometimes',
    'almost', 'never',
    'any', 'none',
  ]),
);

// ---- SUBCATEGORY DEFAULTS (Learning especially is mixed) -----------------
const SUBCAT = {
  'Colors': '2-3y',
  'Shapes': '2-3y',
  'Numbers': '3-4y',
  'Letters': '3-4y',
};

// ---- CATEGORY DEFAULTS ---------------------------------------------------
const CAT = {
  'Family': '12-18m',              // immediate family is band 1; extended later (overridable per row)
  'Animals': '18-30m',             // common animal nouns are band 2
  'Food': '18-30m',                // most foods
  'Drinks': '18-30m',
  'Snacks': '18-30m', 'Treats': '18-30m',
  'Body': '18-30m',                // most body parts (a few in band 1, a few in band 3)
  'Feelings': '2-3y',              // most feelings beyond happy/sad/mad
  'Asking': '3-4y',                // most question words (what is band 2)
  'Pronouns': '2-3y',              // most pronouns (I/you/my band 2, him/hers band 4-5)
  'Linking': '3-4y',               // most function words (a/the band 2, if/could band 5)
  'Adverbs': '4y+',                // most -ly adverbs
  'Quantifiers': '3-4y',
  'Time': '3-4y',
  'Position': '2-3y',
  'Describing': '18-30m',          // basic adjectives
  'Actions': '18-30m',             // most actions
  'Core': '18-30m',                // most core words
  'Social': '2-3y',                // social phrases
  'Toys': '18-30m',
  'Vehicles': '18-30m',
  'Clothes': '18-30m',
  'Home': '2-3y',
  'School': '3-4y',
  'Nature': '2-3y',
  'Sports': '3-4y',
  'Music': '2-3y',
  'Money': '4y+',
  'Places': '3-4y',                 // most place names (specific common ones above are earlier)
  'Holidays': '3-4y',
  'Community': '3-4y',              // community helpers — kids learn jobs ~3-4
  'Therapy': '3-4y',
  'Therapy Team': '3-4y',
  'Tools': '3-4y',
  'Health': '3-4y',
  'Learning': '3-4y',               // letters/numbers fallback; subcat overrides
  'Personalize': null,              // depends entirely on what the family adds
};

const stats = Object.fromEntries(BANDS.map(b => [b, 0])); stats.unset = 0;
const bySource = { specific: 0, subcat: 0, category: 0, kept: 0, fallback: 0 };
const samples = { '12-18m': [], '18-30m': [], '2-3y': [], '3-4y': [], '4y+': [] };

function classify(label, category, subcategory) {
  const hit = SPECIFIC[norm(label)];
  if (hit) { bySource.specific++; return hit; }
  if (subcategory && SUBCAT[subcategory]) { bySource.subcat++; return SUBCAT[subcategory]; }
  if (CAT[category] !== undefined) { bySource.category++; return CAT[category]; }
  bySource.fallback++; return null;
}

// ---- run ----
const rows = parseCSV(readFileSync(CSV_PATH, 'utf8'));
const hdr = rows[0];
// Append the column if the CSV doesn't have it yet (idempotent).
let ci = hdr.indexOf('acquisition_age');
if (ci < 0) { hdr.push('acquisition_age'); ci = hdr.length - 1; for (const r of rows.slice(1)) while (r.length < hdr.length) r.push(''); }
const CI = {
  category: hdr.indexOf('category'),
  subcategory: hdr.indexOf('subcategory'),
  label: hdr.indexOf('label'),
  age: ci,
};

for (const r of rows.slice(1)) {
  if (!r[CI.label]) continue;
  if (String(r[CI.age] || '').trim()) { bySource.kept++; stats[r[CI.age]] = (stats[r[CI.age]] || 0) + 1; continue; }
  const band = classify(r[CI.label], r[CI.category], r[CI.subcategory]);
  if (band) {
    r[CI.age] = band; stats[band]++;
    if (samples[band].length < 6) samples[band].push(`${r[CI.category] || '—'} / ${r[CI.label]}`);
  } else {
    stats.unset++;
  }
}

console.log('band tallies:', stats);
console.log('by source   :', bySource);
console.log('\nsamples (first six per band):');
for (const b of BANDS) console.log(`  ${b}:\n    ${samples[b].join('  ·  ')}`);
if (DRY) { console.log('\n--dry: no file written.'); }
else { writeFileSync(CSV_PATH, toCSV(rows)); console.log(`\nwrote ${CSV_PATH}`); }

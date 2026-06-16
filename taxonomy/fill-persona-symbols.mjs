// taxonomy/fill-persona-symbols.mjs
//
// Personalization + symbol pass over seed-core-v1.csv — the curated layer that
// decides, per concept, WHO (if anyone) should appear in the tile art and WHICH
// conventional symbol rides along, so children learn symbolic language at the
// same time as the word (not just menu positions).
//
// Design rules (the pedagogy):
//   • Personalize only where a person TEACHES the concept. "Rabbit" gains
//     nothing from the child's face; "proud", "my turn", "hug" gain everything.
//   • Body parts use {family_adult} — the parent's face is the face a young
//     child studies all day; their own they rarely see. Falls back at
//     generation time: anchored close adult → the child's anchor → generic.
//   • Affection/comfort phrases ("hug", "I love you", "tuck me in") use BOTH
//     {reference} and {family_adult} — the relationship is the concept.
//   • Symbols are the SAME every time (one consistent visual vocabulary):
//     yes = green check, again = circular repeat arrows, up = up arrow…
//   • Object/concept rows stay generic so the shared, pre-baked standard
//     library keeps amortizing across all children (free tier economics).
//
// Mechanics: rewrites prompt_template (tokens are resolved by lab-generate at
// generation time — {reference} = the child, {family_adult} = close family
// only), preserves each row's existing caption sentence, updates subject_mode
// for the caching layer. Idempotent: rows already carrying a person token are
// left alone, and symbol injection is skipped when a "learning cue" clause is
// already present. Hand-edits after this pass therefore survive re-runs.
//
// Usage:
//   node taxonomy/fill-persona-symbols.mjs --dry    # preview counts + samples
//   node taxonomy/fill-persona-symbols.mjs          # write the CSV
//
// After running, re-import the CSV via the taxonomy workbench (snapshot first).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'seed-core-v1.csv');
const DRY = process.argv.includes('--dry');

// ---- tiny RFC4180 CSV (same as fill-descriptions.mjs) ----
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

// ---- THE SYMBOL VOCABULARY ----------------------------------------------
// One conventional, always-identical symbol per word. Sourced from universal
// signage + established AAC symbol-set conventions (PCS/ARASAAC-style).
const SYMBOLS = {
  // Core interaction words
  'yes': 'a bold green check mark',
  'no': 'a bold red X',
  'again': 'two green arrows curving into a circle (the repeat symbol)',
  'more': 'a bold plus sign',
  'all done': 'a big green check mark inside a circle',
  'stop': 'a red octagon STOP sign',
  'go': 'a bright green traffic-light circle',
  'wait': 'an hourglass',
  'help': 'a red-and-white life ring',
  'open': 'an open padlock',
  'look': 'a wide-open eye',
  'my turn': 'two curved arrows circling between two small figures',
  'eat': 'a crossed fork and spoon',
  'drink': 'a cup with a straw',
  'bathroom': 'the standard restroom sign figures',
  'hurt': 'a red starburst',
  'i like': 'a red heart',
  'i love you': 'a big red heart',
  'i don’t like': 'a heart with a line through it',
  "i don't like": 'a heart with a line through it',
  // Asking — every question word shares the question mark
  'what': 'a large bold question mark',
  'where': 'a large bold question mark',
  'who': 'a large bold question mark',
  'why': 'a large bold question mark',
  'when': 'a large bold question mark',
  'how': 'a large bold question mark',
  // Position — bold arrows / simple diagrams
  'up': 'a large bold arrow pointing up',
  'down': 'a large bold arrow pointing down',
  'in': 'a bold arrow pointing into an open box',
  'out': 'a bold arrow pointing out of an open box',
  'on': 'a bold dot sitting on top of a line',
  'under': 'a bold arrow pointing beneath a line',
  'over': 'a bold arrow arcing over a line',
  'behind': 'a bold arrow curving behind a block',
  'next to': 'two blocks side by side with a small arrow between them',
  'between': 'a bold arrow pointing between two blocks',
  'through': 'a bold arrow passing through a ring',
  'around': 'a bold arrow circling a block',
  'inside': 'a bold dot inside an outlined box',
  'outside': 'a bold dot outside an outlined box',
  'left': 'a large bold arrow pointing left',
  'right': 'a large bold arrow pointing right',
  'top': 'a bold arrow pointing to the top of a block',
  'bottom': 'a bold arrow pointing to the bottom of a block',
  // Describing — contrast/sensory conventions
  'hot': 'red wavy heat lines rising',
  'cold': 'a blue snowflake',
  'loud': 'a megaphone with bold sound waves',
  'quiet': 'a finger-to-lips shh gesture',
  'fast': 'horizontal motion speed lines',
  'slow': 'a small snail',
  'same': 'a bold equals sign',
  'different': 'a bold crossed-out equals sign',
  'wet': 'falling blue water drops',
  // Time
  'now': 'a bright ringing alarm clock',
  'later': 'a simple clock face',
  'today': 'a calendar page with one day circled',
  'tomorrow': 'a calendar page with an arrow to the next day',
  'yesterday': 'a calendar page with an arrow to the day before',
  'morning': 'a rising sun on the horizon',
  'night': 'a crescent moon with stars',
  // Mental / sensory actions
  'sleep': 'three floating Z letters (zzz)',
  'sing': 'floating musical notes',
  'dance': 'floating musical notes',
  'listen': 'sound waves traveling toward an ear',
  'hear': 'sound waves traveling toward an ear',
  'think': 'a thought bubble above the head',
  'know': 'a glowing lightbulb in a thought bubble',
  'remember': 'a thought bubble with a small picture inside',
  'wash': 'soap bubbles and water drops',
};

// ---- CORE GESTURES — the child acting out each core word ------------------
// Specific, repeatable gesture scenes (many follow common ASL/AAC gestures) so
// the SAME pose teaches the word on every regeneration.
const CORE_GESTURES = {
  'more': 'bringing both hands together in front of their chest, fingertips touching, asking for more',
  'i want': 'reaching out eagerly with one open hand toward something just out of frame',
  'i like': 'smiling big with two thumbs up',
  "i don't like": 'turning their head away with a hand pushing away, frowning gently',
  'help': 'reaching one hand up for help, looking hopeful',
  'stop': 'holding one palm out flat and firm in a clear STOP gesture',
  'go': 'pointing forward and mid-step, ready to move',
  'all done': 'sweeping both hands apart over an empty plate, satisfied',
  'yes': 'nodding happily with a big thumbs up',
  'no': 'shaking their head with one hand out in a gentle no gesture',
  'please': 'pressing both hands together politely, hopeful eyes',
  'thank you': 'smiling warmly with a hand moving outward from their chin (the thank-you sign)',
  'mine': 'hugging a favorite toy close to their chest',
  'my turn': 'patting their own chest with one hand, eager',
  'look': 'pointing into the distance with one hand shading their eyes',
  'again': 'making a circular motion with one finger, smiling expectantly',
  'open': 'lifting the lid of a small box, peeking inside',
  'give': 'holding out a small toy with both hands, offering it',
  'eat': 'bringing a spoonful of food to their open mouth',
  'drink': 'drinking from a cup with both hands',
  'hurt': 'holding their arm and wincing',
  'wait': 'sitting with hands folded in their lap, waiting patiently',
};

// ---- COLOR-CODED EMBODIMENT — the child WEARS the color + HOLDS the symbol ---
// A small set of words carry a culturally-conventional COLOR, not just a symbol.
// For these the child embodies it (wears the color shirt, holds the symbol) so
// the color-coding itself teaches the word: the yes/no check-vs-X convention and
// the traffic-light trio (stop = red, wait = yellow, go = green). Rendered the
// SAME way every time, so a child reads "green + check = yes" across the board.
// Kept deliberately tight — only words with an unambiguous color convention.
const SYMBOL_OUTFIT = {
  'yes':  { color: 'green',  pose: 'smiling and nodding yes',                     held: 'a big bold green check mark' },
  'no':   { color: 'red',    pose: 'shaking their head firmly',                   held: 'a big bold red X' },
  'stop': { color: 'red',    pose: 'one palm held out flat and firm',             held: 'a red octagon STOP sign' },
  'wait': { color: 'yellow', pose: 'sitting patiently with hands folded',         held: 'a yellow hourglass' },
  'go':   { color: 'green',  pose: 'mid-step and pointing forward, ready to move', held: 'a bright green circle' },
};
function outfitTemplate(label, oldTemplate) {
  const o = SYMBOL_OUTFIT[norm(label)];
  if (!o) return null;
  const cap = captionOf(oldTemplate, label);
  return `A {style} of {reference} wearing a bright ${o.color} shirt, ${o.pose}, ` +
    `holding up ${o.held} clearly toward the viewer. The ${o.color} clothing and the ${o.held} ` +
    `are the consistent learning cue — render them the exact same way every time this word appears, ` +
    `and never let them cover the caption. One clear figure on a plain soft pastel background. ${cap}`;
}

// ---- Affection / comfort phrases — child + family adult TOGETHER ----------
const TOGETHER = new Set([
  'hug', 'i love you', 'family hug', 'goodnight kiss', 'snuggle', 'cuddle',
  'snuggle with me', 'tuck me in', 'hold me', 'carry me', 'piggyback', 'tickle',
  'read to me', 'one more book', 'i miss you', 'i see you',
].map(norm));

// ---- Pronouns with a clear pointing convention -----------------------------
const PRONOUN_SCENES = {
  'i': '{reference} pointing to their own chest with one finger',
  'my': '{reference} hugging a favorite toy to their chest, pointing to it',
  'you': '{reference} pointing straight outward toward the viewer',
  'your': '{reference} pointing outward toward the viewer, then at a toy beside them',
  'we': '{reference} and {family_adult} standing together, arms around each other',
  'these': '{reference} pointing to a small group of toys right at their feet',
  'those': '{reference} pointing to a small group of toys far away across the room',
};

// ---- caption handling ----
const CAPTION_RE = /At the (?:very )?bottom[\s\S]*$/i;
function captionOf(template, label) {
  const m = String(template || '').match(CAPTION_RE);
  if (m) return m[0].trim();
  return `At the bottom, include a clean caption reading "${label}", spelled exactly, in a simple friendly rounded font; no other text or logos.`;
}
const SYMBOL_CLAUSE = (sym) =>
  `Include ${sym} as a clear, bold learning cue beside the main subject — draw the exact same symbol every time this word appears; it must not cover the caption.`;

const hasPersonToken = (t) => /\{reference\}|\{family_adult\}|\{parent_photo\}/i.test(t);
const hasSymbolClause = (t) => /learning cue/i.test(t);

// ---- per-category persona templates ----
function personaTemplate(category, label, oldTemplate) {
  const l = norm(label);
  const cap = captionOf(oldTemplate, label);

  if (category === 'Body') {
    return `A {style} of {family_adult} smiling warmly in a friendly close-up, gently pointing to their ${l}; the ${l} is clearly visible and softly highlighted so it stands out. One clear figure on a plain soft pastel background. ${cap}`;
  }
  if (category === 'Feelings') {
    return `A {style} of {reference} with a clearly ${l} facial expression and matching body language, large and easy to read. One clear figure on a plain soft pastel background. ${cap}`;
  }
  if (category === 'Social') {
    if (TOGETHER.has(l)) {
      return `A {style} of {reference} together with {family_adult}, warmly acting out "${label}" — the moment is gentle, loving, and instantly readable. Two clear figures on a plain soft pastel background. ${cap}`;
    }
    return `A {style} of {reference} expressing "${label}" with a warm, clear gesture and body language that matches the phrase. One clear figure on a plain soft pastel background. ${cap}`;
  }
  if (category === 'Actions') {
    return `A {style} of {reference} caught mid-action: ${l}. The action is large, clear, and easy to read at a glance, with simple props only if the action needs them. One clear figure on a plain soft pastel background. ${cap}`;
  }
  if (category === 'Core' && CORE_GESTURES[l]) {
    return `A {style} of {reference} ${CORE_GESTURES[l]}. One clear figure on a plain soft pastel background. ${cap}`;
  }
  if (category === 'Pronouns' && PRONOUN_SCENES[l]) {
    return `A {style} of ${PRONOUN_SCENES[l]}. Clear and easy to read at a glance, on a plain soft pastel background. ${cap}`;
  }
  return null;
}

// ---- run ----
const rows = parseCSV(readFileSync(CSV_PATH, 'utf8'));
const hdr = rows[0];
const col = (name) => {
  const i = hdr.indexOf(name);
  if (i < 0) throw new Error(`column not found: ${name}`);
  return i;
};
const CI = { category: col('category'), label: col('label'), template: col('prompt_template'), subjectMode: col('subject_mode') };

const stats = { persona: {}, symbol: 0, outfit: 0, skippedPersona: 0, skippedSymbol: 0 };
const samples = [];
for (const r of rows.slice(1)) {
  if (!r[CI.label]) continue;
  const category = r[CI.category], label = r[CI.label];
  const l = norm(label);

  // 0. color-coded embodiment (yes/no/stop/wait/go) — overwrites the gesture +
  //    beside-symbol template with the "wear the color, hold the symbol" version.
  //    Deterministic, so re-running is idempotent. Takes the whole row.
  const outfit = outfitTemplate(label, r[CI.template] || '');
  if (outfit) {
    r[CI.template] = outfit;
    r[CI.subjectMode] = 'child_as_subject';
    stats.outfit++;
    if (samples.length < 8) samples.push(`  [OUTFIT / ${label}] ${outfit.slice(0, 150)}…`);
    continue;
  }

  // 1. persona (skip rows that already carry a person token — idempotent)
  let t = r[CI.template] || '';
  if (!hasPersonToken(t)) {
    const next = personaTemplate(category, label, t);
    if (next) {
      r[CI.template] = next;
      r[CI.subjectMode] = /\{reference\}/.test(next) ? 'child_as_subject' : 'person';
      stats.persona[category] = (stats.persona[category] || 0) + 1;
      if (samples.length < 8) samples.push(`  [${category} / ${label}] ${next.slice(0, 150)}…`);
      t = next;
    }
  } else if (personaTemplate(category, label, t)) {
    stats.skippedPersona++;
  }

  // 2. symbol (independent of persona; idempotent via the 'learning cue' marker)
  const sym = SYMBOLS[l];
  if (sym && !hasSymbolClause(t)) {
    const cap = captionOf(t, label);
    const body = t.replace(CAPTION_RE, '').trim();
    r[CI.template] = `${body} ${SYMBOL_CLAUSE(sym)} ${cap}`;
    stats.symbol++;
  } else if (sym) {
    stats.skippedSymbol++;
  }
}

console.log('color-coded embodiment (wear color + hold symbol):', stats.outfit);
console.log('persona rewrites by category:', stats.persona);
console.log('symbol clauses added:', stats.symbol, ' (already present, skipped:', stats.skippedSymbol + ')');
console.log('rows with existing person tokens left untouched:', stats.skippedPersona);
console.log('\nsamples:\n' + samples.join('\n'));
if (DRY) { console.log('\n--dry: no file written.'); }
else { writeFileSync(CSV_PATH, toCSV(rows)); console.log(`\nwrote ${CSV_PATH}`); }

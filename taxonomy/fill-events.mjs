// taxonomy/fill-events.mjs
//
// Adds the holiday + birthday EVENT rows to seed-core-v1.csv. Events are not
// tiles — they're full-screen celebration scenes the board surfaces on the
// special day (api/_lib/event-dates.js maps today's date → event_key, the
// runtime in app.html renders a modal). They live in the taxonomy so the same
// generation engine, model routing, and image-history archive apply.
//
// Personalization model:
//   {reference}     → the child, the heart of every celebration
//   {family_adult}  → the resolver picks ONE close family member (parent →
//                     grandparent fallback) — used for Mother's/Father's Day,
//                     anywhere the relationship is the concept
//   {family_all}    → "the whole family" generic phrasing for group scenes;
//                     the model fills in believable extras (we don't yet pass
//                     more than two anchored faces, so this stays generic)
//
// Each row writes column='Events', category='Events', subcategory=<the human
// label>, is_event=true, event_key=<resolver key>. acquisition_age='12-18m'
// for the warm/universal ones (Christmas, birthday — the youngest babies
// already know these moments); harder concepts (April Fools, New Year's Eve)
// sit a band or two later.
//
// Idempotent: re-running won't duplicate. Hand edits in the workbench survive
// because we only touch rows whose id matches our `events.<key>` pattern AND
// whose prompt_template still equals the default we last wrote (so once an
// admin tunes a prompt, the script leaves it alone).
//
// Usage:
//   node taxonomy/fill-events.mjs --dry   # preview adds/skips
//   node taxonomy/fill-events.mjs         # write the CSV

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'seed-core-v1.csv');
const DRY = process.argv.includes('--dry');

// CSV (same parser as the other fill scripts) ---------------------------------
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
function csvCell(s) { s = s == null ? '' : String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCSV(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n'; }

// EVENT DEFINITIONS -----------------------------------------------------------
// Captions are baked into the prompts; the full-screen celebration card on the
// board reuses the same image. Keep each prompt around 2-3 sentences — the
// model holds composition better when the scene is concrete and specific.
const EVENTS = [
  {
    key: 'birthday', label: "Happy Birthday", age: '12-18m',
    prompt: `A {style} of {reference} sitting at the head of a decorated birthday table with {family_all} gathered close around — colorful balloons floating overhead, a frosted birthday cake with lit candles glowing softly in front of them, paper streamers and confetti, everyone smiling warmly at {reference}. Soft, golden party light, warm and joyful, a "Happy Birthday" banner across the top of the scene. The caption "Happy Birthday!" is spelled exactly, in a friendly rounded font, set into the banner; no other text or logos anywhere else.`,
  },
  {
    key: 'new_years_day', label: "Happy New Year", age: '2-3y',
    prompt: `A {style} of {reference} with {family_all} celebrating the new year together — soft confetti drifting down, gentle gold and pink fireworks in the night sky behind them, everyone in cozy party hats with a warm fairy-light glow. {reference} is smiling and looking up in wonder. Caption "Happy New Year!" along the bottom, spelled exactly, in a clean friendly rounded font; no other text or logos.`,
  },
  {
    key: 'valentines_day', label: "Valentine's Day", age: '18-30m',
    prompt: `A {style} of {reference} together with {family_adult} sharing a sweet Valentine's moment — {reference} is holding a hand-drawn heart card with a big red heart on it, both of them smiling at each other warmly. Soft pink and red background with floating little hearts. Caption "Happy Valentine's Day" along the bottom, spelled exactly with a curly apostrophe, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'st_patricks_day', label: "St. Patrick's Day", age: '2-3y',
    prompt: `A {style} of {reference} wearing a green shirt and a little green pointed hat, surrounded by floating four-leaf clovers and gold coins, standing in a sunny green meadow with a rainbow arcing softly behind them. Cheerful and gentle, with a clear smile on {reference}'s face. Caption "St. Patrick's Day" along the bottom, spelled exactly with a curly apostrophe, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'april_fools', label: "April Fools Day", age: '3-4y',
    prompt: `A {style} of {reference} laughing big with both hands on their cheeks as a tiny harmless surprise happens — a friendly cartoon "pop!" spring out of a small gift box in front of them, paper streamers floating in the air. {family_adult} is behind them sharing the laugh. Soft pastel background, completely silly and warm, nothing scary. Caption "April Fools!" along the bottom, spelled exactly, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'easter', label: "Easter", age: '18-30m',
    prompt: `A {style} of {reference} in a soft sunny springtime garden, kneeling down to gently pet a fluffy white bunny rabbit, with pastel-colored Easter eggs nestled in the grass around them and a little woven basket beside. Soft yellow morning light, pink and yellow tulips in the background. Caption "Happy Easter" along the bottom, spelled exactly, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'mothers_day', label: "Mother's Day", age: '2-3y',
    prompt: `A {style} of {reference} together with {family_adult} (their mom) in a warm hug, {reference} handing them a small bouquet of hand-picked flowers and looking up at their face with love. Soft pastel pink and lavender background with a few floating flower petals. Caption "Happy Mother's Day" along the bottom, spelled exactly with a curly apostrophe, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'memorial_day', label: "Memorial Day", age: '3-4y',
    prompt: `A {style} of {reference} with {family_all} on a sunny outdoor day — a small American flag waving gently in {reference}'s hand, a peaceful picnic blanket on green grass behind them, blue sky with soft clouds. Quiet, warm, respectful tone — not loud. Caption "Memorial Day" along the bottom, spelled exactly, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'fathers_day', label: "Father's Day", age: '2-3y',
    prompt: `A {style} of {reference} together with {family_adult} (their dad), riding on dad's shoulders or in a big warm hug, both smiling at each other. A hand-drawn "I love you Dad" card visible in {reference}'s hand. Soft blue and green outdoor sunny background. Caption "Happy Father's Day" along the bottom, spelled exactly with a curly apostrophe, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'independence_day', label: "Independence Day", age: '2-3y',
    prompt: `A {style} of {reference} with {family_all} at a friendly Fourth-of-July moment — {reference} holding a sparkler that glows softly in red, white, and blue, a small picnic blanket on grass, gentle warm fireworks in the evening sky behind them (soft and dreamy, not loud). Caption "Happy 4th of July!" along the bottom, spelled exactly, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'halloween', label: "Halloween", age: '18-30m',
    prompt: `A {style} of {reference} in a friendly, cute costume (a soft pumpkin or a little ghost — gentle and not scary), holding a small candy bucket, standing on a porch with smiling jack-o-lanterns lit up beside them. Warm orange evening glow, a few floating autumn leaves. Caption "Happy Halloween" along the bottom, spelled exactly, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'thanksgiving', label: "Thanksgiving", age: '2-3y',
    prompt: `A {style} of {reference} sitting at a big Thanksgiving table with {family_all} all gathered around, a roasted turkey at the center, autumn leaves and pumpkins decorating the table, warm candlelight. Everyone is smiling and looking happy together; {reference} is in the foreground. Caption "Happy Thanksgiving" along the bottom, spelled exactly, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'christmas_eve', label: "Christmas Eve", age: '18-30m',
    prompt: `A {style} of {reference} together with {family_adult} in matching cozy pajamas, sitting close by a softly glowing fireplace, hanging a small stocking on the mantle. A decorated Christmas tree twinkles behind them. Warm golden light, snow softly visible through a window. Caption "Christmas Eve" along the bottom, spelled exactly, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'christmas', label: "Merry Christmas", age: '12-18m',
    prompt: `A {style} of {reference} with {family_all} on Christmas morning around a tall decorated tree with twinkling lights and a star on top, brightly wrapped presents in a soft pile beneath it. {reference} is in the foreground holding a present, eyes wide with joy. Warm fireplace light, a soft red-and-green color palette. Caption "Merry Christmas" along the bottom, spelled exactly, in a friendly rounded font; no other text or logos.`,
  },
  {
    key: 'new_years_eve', label: "New Year's Eve", age: '3-4y',
    prompt: `A {style} of {reference} with {family_all} ringing in the new year — everyone wearing soft party hats, a small clock in the background showing nearly midnight, gentle confetti and streamers in the air, fairy-lights glowing warmly. {reference} is smiling and clutching a small noisemaker. Caption "Happy New Year's Eve" along the bottom, spelled exactly with a curly apostrophe, in a friendly rounded font; no other text or logos.`,
  },
];

// ---- run --------------------------------------------------------------------
const rows = parseCSV(readFileSync(CSV_PATH, 'utf8'));
const hdr = rows[0];
const col = name => { const i = hdr.indexOf(name); if (i < 0) throw new Error(`column not found: ${name}`); return i; };
const CI = {
  id: col('id'), column: col('column'), category: col('category'), subcategory: col('subcategory'),
  label: col('label'), pronunciation: col('pronunciation'), subjectMode: col('subject_mode'),
  parentPhoto: col('parent_photo_behavior'), phase: col('phase'), core: col('core'),
  growthStage: col('growth_stage'), descClues: col('descriptive_clues'), audience: col('audience'),
  authoringKind: col('authoring_kind'), status: col('status'), promptTemplate: col('prompt_template'),
  notes: col('notes'), age: col('acquisition_age'),
};

let added = 0, updated = 0, preserved = 0;
for (const e of EVENTS) {
  const id = `events.${e.key}`;
  const existing = rows.findIndex((r, idx) => idx > 0 && r[CI.id] === id);
  if (existing > 0) {
    // Only overwrite the prompt when the row still looks unedited (default tag
    // in notes). Otherwise leave the curated prompt in place.
    const noteTag = '[auto:event-seed]';
    const curatedNote = rows[existing][CI.notes] || '';
    if (curatedNote.includes(noteTag)) {
      rows[existing][CI.promptTemplate] = e.prompt;
      rows[existing][CI.subcategory] = e.label;
      rows[existing][CI.age] = e.age;
      updated++;
    } else {
      preserved++;
    }
    continue;
  }
  const newRow = new Array(hdr.length).fill('');
  newRow[CI.id] = id;
  newRow[CI.column] = 'Events';
  newRow[CI.category] = 'Events';
  newRow[CI.subcategory] = e.label;
  newRow[CI.label] = e.label;
  newRow[CI.subjectMode] = 'concept';
  newRow[CI.parentPhoto] = 'none';
  newRow[CI.phase] = 'v1_core';
  newRow[CI.core] = 'true';
  newRow[CI.growthStage] = '';
  newRow[CI.descClues] = '';
  newRow[CI.audience] = 'universal';
  newRow[CI.authoringKind] = 'canonical';
  newRow[CI.status] = 'draft';
  newRow[CI.promptTemplate] = e.prompt;
  newRow[CI.notes] = `[auto:event-seed] event_key=${e.key}`;
  newRow[CI.age] = e.age;
  rows.push(newRow);
  added++;
}

console.log(`events: ${added} added, ${updated} re-templated (auto-tag intact), ${preserved} preserved (hand-edited)`);
if (DRY) { console.log('\n--dry: no file written.'); }
else { writeFileSync(CSV_PATH, toCSV(rows)); console.log(`wrote ${CSV_PATH}`); }

// taxonomy/uplift-prompts.mjs
//
// Deterministic, idempotent, in-place uplift of prompt_template across the whole
// seed. Only the prompt_template column is rewritten — every other column
// (descriptions, acquisition_age, status, descriptive_clues, …) is preserved, so
// this is safe to run on the live CSV without losing enrichment (unlike a full
// build-seed regen, which blanks those columns).
//
// Three decisions it enforces:
//
//   1. EMBODIMENT — the whole point of the app is that the child sees HIMSELF on
//      the board, so any tile that depicts a child becomes the {reference} token
//      (his likeness from the onboarding photo) instead of a generic / "friendly"
//      / "smiling" child. This now covers the adjective-prefixed variants the
//      first pass missed ("a friendly young child", "a smiling child", …) AND
//      multi-child scenes (the foreground child is the reference, the rest stay
//      generic). Protected: the possessive "a child's cup" (an OBJECT, never him)
//      and subject_mode = person (the Friend peer, a named therapist) — those are
//      other named people, not the child.
//
//   2. CAPTION — captions are now owned in ONE place: the generators append a
//      single black-on-white label rule (captionRule) to every image. So this
//      script STRIPS any caption clause that was previously baked into the
//      per-tile prompt; two caption instructions are exactly why the lettering
//      used to drift in font/color/placement.
//
//   3. NO-TEXT — the old "no text, letters, numbers" clause contradicts the baked
//      caption, so it's removed from the tail.
//
// {style}, {reference}, {parent_photo} are live tokens filled at generation time.
// Re-runnable and idempotent.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CSV = join(dirname(fileURLToPath(import.meta.url)), 'seed-core-v1.csv');

function parseCSV(t){const R=[];let f=[],c='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];
 if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++}else q=false}else c+=ch}
 else if(ch==='"')q=true;else if(ch===','){f.push(c);c=''}else if(ch==='\n'){f.push(c);R.push(f);f=[];c=''}else if(ch==='\r'){}else c+=ch}
 if(c!==''||f.length){f.push(c);R.push(f)}return R}
const cell=(s)=>{s=s==null?'':String(s);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
const toCSV=(rows)=>rows.map(r=>r.map(cell).join(',')).join('\n')+'\n';

const rows = parseCSV(readFileSync(CSV,'utf8'));
const H=rows[0], I=Object.fromEntries(H.map((h,i)=>[h,i]));
const P=I.prompt_template, SM=I.subject_mode;

// Optional adjective run we strip when collapsing a child phrase to {reference}.
const ADJ = '(?:friendly\\s+|smiling\\s+|happy\\s+|cheerful\\s+|little\\s+|young\\s+)*';
// A single depicted child: "a/an/the [friendly|smiling|…] child", but NOT the
// possessive "a child's …" (that's an object) — the (?!’?'?s) guard.
const ONE_CHILD = new RegExp(`\\b(?:a|an|the)\\s+${ADJ}child\\b(?!['’]s)`, 'gi');
// Multi-child scenes → foreground child is the reference, the rest stay generic.
const TWO_CHILDREN   = new RegExp(`\\btwo\\s+${ADJ}children\\b`, 'gi');
const THREE_CHILDREN = new RegExp(`\\b(?:a\\s+small\\s+group\\s+of\\s+)?three\\s+${ADJ}children\\b`, 'gi');

let refSwaps=0, capStrips=0, noTextStrips=0;
for(let r=1;r<rows.length;r++){
  const row=rows[r]; if(!row[0]) continue;
  let p = (row[P]||'').trim();
  if(!p) continue;
  const mode = (row[SM]||'').trim().toLowerCase();

  // 1) caption: strip any previously-baked caption clause (the generators own it now).
  const beforeCap = p;
  p = p.replace(/\s*At the bottom,\s*include a clean caption[\s\S]*$/i, '').trim();
  if(p !== beforeCap) capStrips++;

  // 2) no-text clause: contradicts the baked label, drop it from the tail.
  const beforeNoText = p;
  p = p.replace(/[;,.]?\s*no text[^.]*\.?\s*$/i, '').trim();
  if(p !== beforeNoText) noTextStrips++;

  // 3) embodiment: depicted children → {reference}. Skip subject_mode = person
  //    (the Friend peer, a named therapist) — those are other people, not him.
  if(mode !== 'person'){
    const before = p;
    p = p.replace(TWO_CHILDREN,   '{reference} and another young child');
    p = p.replace(THREE_CHILDREN, '{reference} and two other young children');
    p = p.replace(ONE_CHILD,      '{reference}');
    if(p !== before) refSwaps++;
  }

  if(p && !/[.!?]$/.test(p)) p += '.';
  row[P]=p;
}

writeFileSync(CSV, toCSV(rows));
console.log('prompt uplift complete');
console.log('  {reference} embodiment swaps:', refSwaps);
console.log('  baked caption clauses stripped:', capStrips);
console.log('  trailing no-text clauses stripped:', noTextStrips);

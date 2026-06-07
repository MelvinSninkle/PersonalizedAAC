// taxonomy/uplift-prompts.mjs
//
// One-time, deterministic uplift of prompt_template across the whole seed, to
// make every prompt consistent with two decisions we settled on:
//
//   1. EMBODIMENT — tiles that picture the child (subject_mode = concept /
//      child_as_subject) should use the {reference} token (his likeness), not a
//      generic "a young child". So he sees HIMSELF doing/feeling the word.
//      Object prompts (incl. "a child's cup") are left untouched.
//   2. LABEL CAPTION — we bake the word into the art now, so the old
//      "no text, letters, numbers" clause is wrong. It's replaced with a clean
//      "caption the label" instruction.
//
// {style}, {reference}, {parent_photo} are live tokens filled at generation
// time (the parent's chosen art style, the child's photo, a family photo).
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
const P=I.prompt_template, SM=I.subject_mode, L=I.label;

let refSwaps=0, capSwaps=0, capAppends=0;
for(let r=1;r<rows.length;r++){
  const row=rows[r]; if(!row[0]) continue;
  let p = (row[P]||'').trim();
  if(!p) continue;
  const label = (row[L]||'').trim();
  const mode = (row[SM]||'').trim();

  // 1) embodiment: generic child -> {reference}, only for embodied subjects,
  //    never the possessive ("a child's ...").
  if((mode==='concept' || mode==='child_as_subject') && /\b(a young child|a child|the child)\b(?!'s)/i.test(p)){
    p = p.replace(/\b(a young child|a child|the child)\b(?!'s)/gi, '{reference}');
    refSwaps++;
  }

  // 2) caption: drop the old "no text" clause, add a label caption.
  const hadNoText = /no text/i.test(p);
  p = p.replace(/[;,.]?\s*no text[^.]*\.?\s*$/i, '').trim();
  if(!/[.!?]$/.test(p)) p += '.';
  if(label){
    p += ` At the bottom, include a clean caption reading "${label}", spelled exactly, in a simple friendly rounded font; no other text or logos.`;
    if(hadNoText) capSwaps++; else capAppends++;
  }
  row[P]=p;
}

writeFileSync(CSV, toCSV(rows));
console.log('prompt uplift complete');
console.log('  {reference} embodiment swaps:', refSwaps);
console.log('  caption replaced old no-text clause:', capSwaps);
console.log('  caption appended (no prior clause):', capAppends);

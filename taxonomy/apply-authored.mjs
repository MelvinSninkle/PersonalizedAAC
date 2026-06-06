// taxonomy/apply-authored.mjs
//
// Applies hand-authored content to seed-core-v1.csv from two durable, committed
// sources (so nothing lives only in chat):
//   - authored-descriptions.json : { "<id>": ["d1","d2","d3"], ... }  -> descriptive_clues (pipe-joined)
//   - category-fixes.json        : { "<id>": "Category", ... }        -> category
// Keyed by id (slug) so duplicate labels (e.g. two "pepper") never collide.
// Re-runnable / idempotent. Run after editing either JSON:  node taxonomy/apply-authored.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV = join(HERE, 'seed-core-v1.csv');

function parseCSV(t){const R=[];let f=[],c='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];
 if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++}else q=false}else c+=ch}
 else if(ch==='"')q=true;else if(ch===','){f.push(c);c=''}else if(ch==='\n'){f.push(c);R.push(f);f=[];c=''}else if(ch==='\r'){}else c+=ch}
 if(c!==''||f.length){f.push(c);R.push(f)}return R}
const cell=(s)=>{s=s==null?'':String(s);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
const toCSV=(rows)=>rows.map(r=>r.map(cell).join(',')).join('\n')+'\n';
const load=(p)=>existsSync(p)?JSON.parse(readFileSync(p,'utf8')):{};

// Merge every authored-descriptions*.json batch file (one per category group).
const desc = {};
for (const f of readdirSync(HERE).filter((f) => /^authored-descriptions.*\.json$/.test(f))) {
  Object.assign(desc, JSON.parse(readFileSync(join(HERE, f), 'utf8')));
}
const cats = load(join(HERE,'category-fixes.json'));

const rows = parseCSV(readFileSync(CSV,'utf8'));
const H=rows[0], I=Object.fromEntries(H.map((h,i)=>[h,i]));
let setDesc=0, setCat=0;
const seen=new Set();
for(let r=1;r<rows.length;r++){
  const row=rows[r]; const id=row[I.id]; if(!id) continue; seen.add(id);
  if(cats[id]){ row[I.category]=cats[id]; setCat++; }
  const d=desc[id];
  if(Array.isArray(d)&&d.length){ row[I.descriptive_clues]=d.join(' | '); setDesc++; }
}
writeFileSync(CSV, toCSV(rows));

const missDesc=Object.keys(desc).filter(id=>!seen.has(id));
const missCat=Object.keys(cats).filter(id=>!seen.has(id));
console.log('applied descriptions to', setDesc, 'rows · categories to', setCat, 'rows');
if(missDesc.length) console.log('  ! desc ids not found in seed:', missDesc.join(', '));
if(missCat.length)  console.log('  ! category ids not found in seed:', missCat.join(', '));
const filled = rows.slice(1).filter(x=>x[0]&&(x[I.descriptive_clues]||'').trim()).length;
console.log('total rows with descriptions now:', filled, '/', rows.slice(1).filter(x=>x[0]).length);

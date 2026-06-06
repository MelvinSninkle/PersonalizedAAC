// taxonomy/fill-descriptions.mjs
//
// Fills the `descriptive_clues` (teaching descriptions) column in
// seed-core-v1.csv. Two sources, in priority order:
//
//   1. HAND-AUTHORED — parsed from taxonomy/content/*.md (the content sheets:
//      adjectives, verbs, community helpers, feelings & body states). These are
//      the curated, voice-calibrating tiles. Always applied, deterministic, and
//      they survive a build-seed regen because the .md files are the durable
//      source.
//   2. GENERATED — for every remaining blank row, calls OpenAI (gpt-4o-mini)
//      with the SAME voice as /api/generate-descriptions. Skipped unless
//      OPENAI_API_KEY is set, so this script also runs offline to bank just the
//      hand-authored ones.
//
// Descriptions are stored pipe-joined ("a | b | c") — that's exactly how the
// taxonomy workbench import splits them (`split(/\s*\|\s*|\s*\n\s*/)`), so the
// commas inside sentences are safe.
//
// Usage:
//   node taxonomy/fill-descriptions.mjs            # bank hand-authored only
//   OPENAI_API_KEY=sk-... node taxonomy/fill-descriptions.mjs   # + generate rest
//   ...  --limit 50        # cap generations this run (resumable; re-run for more)
//
// Resumable: rows that already have descriptions are left alone.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, 'seed-core-v1.csv');
const CONTENT_DIR = join(HERE, 'content');

// ---- The voice (kept in lockstep with api/generate-descriptions.js) ----
const VOICE = `You write short, warm teaching descriptions for tiles on a young child's AAC communication board. The child is a non-verbal toddler and may be a gestalt language processor. The goal is REAL understanding of the word — not just recognizing a picture.

Write 2 to 3 descriptions, each from a DIFFERENT angle:
1. FUNCTION — what you do with it, or what it is for.
2. FEATURE — what it has, or what it looks like (concrete and perceptual).
3. CONTEXT — where you find it, what it goes with, or when you use it.

Rules:
- Talk directly TO the child, using "you".
- Each description is ONE short, simple sentence, about 6-14 words. Concrete, no jargon.
- Add a gentle safety note when it matters (e.g. hot, sharp).
- For a DESCRIBING word (adjective): use (a) a simple meaning, often paired with its opposite, (b) two or three quick everyday examples, (c) a short phrase the child could actually say.
- For a PERSON or a family relationship: write ONLY ONE description that explains the relationship in plain family terms. Do NOT invent personal facts, names, places, or history.
- Never invent specifics you cannot possibly know.
Respond with strict JSON only: {"descriptions":["...","..."]}.`;

// ---- tiny RFC4180 CSV ----
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

// ---- parse the hand-authored content sheets ----
// Format per tile:
//   ### label  _(optional meta)_
//   - **Image:** <prompt>
//   - **Descriptions:**
//     1. "first"
//     2. "second"
//     3. "third"
function parseContent(dir) {
  const map = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    let label = null, descs = [];
    const flush = () => {
      if (label && descs.length) map.set(norm(label), { descriptions: descs.slice() });
      label = null; descs = [];
    };
    for (const line of lines) {
      const h = line.match(/^###\s+(.+?)\s*$/);
      if (h) { flush(); label = h[1].replace(/\s*_\(.*?\)_\s*$/, '').trim(); continue; }
      const d = line.match(/^\s*\d+\.\s*(.+?)\s*$/);
      if (d && label) {
        let v = d[1].trim().replace(/^"(.*)"$/, '$1').replace(/^“(.*)”$/, '$1');
        if (v) descs.push(v);
      }
    }
    flush();
  }
  return map;
}

// ---- OpenAI generation (matches the endpoint) ----
function kindFor(column, category) {
  const col = String(column || '').toLowerCase();
  const cat = String(category || '').toLowerCase();
  if (col === 'people') return 'person / family relationship';
  if (col === 'verbs') return 'action (verb)';
  if (cat.includes('describ') || cat.includes('feeling')) return 'describing word (adjective)';
  return 'thing (noun)';
}
async function generate(apiKey, label, column, category) {
  const userMsg = `Word: "${label}". Board section: ${column}.` +
    (category ? ` Category: ${category}.` : '') + ` This word is a ${kindFor(column, category)}.`;
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: VOICE }, { role: 'user', content: userMsg }],
      response_format: { type: 'json_object' }, max_tokens: 300, temperature: 0.5,
    }),
  });
  if (!resp.ok) throw new Error('OpenAI ' + resp.status + ' ' + (await resp.text().catch(() => '')).slice(0, 160));
  const data = await resp.json();
  let out = {}; try { out = JSON.parse(data.choices[0].message.content); } catch (_) {}
  return (Array.isArray(out.descriptions) ? out.descriptions : [])
    .map((s) => (typeof s === 'string' ? s.trim().slice(0, 240) : '')).filter(Boolean).slice(0, 4);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) || Infinity : Infinity;

  const rows = parseCSV(readFileSync(CSV_PATH, 'utf8'));
  const H = rows[0], I = Object.fromEntries(H.map((h, i) => [h, i]));
  const ix = { clues: I.descriptive_clues, label: I.label, column: I.column, category: I.category };
  const authored = parseContent(CONTENT_DIR);

  let banked = 0, generated = 0, alreadyFilled = 0, blank = 0;
  const matchedAuthored = new Set();

  // pass 1: bank hand-authored (offline, deterministic)
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row[0]) continue;
    const a = authored.get(norm(row[ix.label]));
    if (a) {
      row[ix.clues] = a.descriptions.join(' | ');
      matchedAuthored.add(norm(row[ix.label]));
      banked++;
    }
  }

  // pass 2: generate the rest (needs key)
  const toGen = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row[0]) continue;
    if ((row[ix.clues] || '').trim()) { alreadyFilled++; continue; }
    toGen.push(r);
  }
  blank = toGen.length;

  if (apiKey && toGen.length) {
    const slice = toGen.slice(0, limit);
    const CONCURRENCY = 4;
    let next = 0, done = 0;
    async function worker() {
      while (next < slice.length) {
        const r = slice[next++]; const row = rows[r];
        try {
          const d = await generate(apiKey, row[ix.label], row[ix.column], row[ix.category]);
          if (d.length) { row[ix.clues] = d.join(' | '); generated++; }
        } catch (e) { process.stderr.write(`  ! ${row[ix.label]}: ${e.message}\n`); }
        if (++done % 25 === 0) process.stdout.write(`  …generated ${done}/${slice.length}\n`);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    writeFileSync(CSV_PATH, toCSV(rows));
    blank -= generated;
  } else {
    // offline run still banks the authored ones
    writeFileSync(CSV_PATH, toCSV(rows));
  }

  const unmatched = [...authored.keys()].filter((k) => !matchedAuthored.has(k));
  console.log('\n— fill-descriptions report —');
  console.log('hand-authored banked into existing rows:', banked);
  console.log('generated this run:', generated, apiKey ? '' : '(no OPENAI_API_KEY → generation skipped)');
  console.log('already had descriptions:', alreadyFilled);
  console.log('still blank:', blank);
  console.log('authored tiles with NO matching seed row (need to be added later):', unmatched.length);
  if (unmatched.length) console.log('  ', unmatched.join(', '));
}
main();

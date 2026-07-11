// Listening-mode / message-to-board word matching — ONE morphology engine.
//
// The greedy-longest tokenizer exists in four places (server
// message-to-board, iOS ListenStripView, Android ListenTokenizer, web
// listening strip) but the VARIANTS are computed only HERE: /api/sync ships
// each tile's expanded matchTerms, and every client just indexes extra
// strings. Never port these rules to a client — extend them here and the
// devices pick the new variants up on their next sync.
//
// A tile's match set = its label + curated taxonomy.match_terms (irregulars,
// synonyms, regional words) + generated English inflections:
//   love → loves, loving, loved        cry → cries, crying, cried
//   run  → runs, running, ran (irregular map)
//   hug  → hugs, hugging, hugged (CVC doubling)
// Generation is deliberately conservative: single alphabetic words only, no
// comparatives (-er/-est make junk like "cookier" — curate those instead).
// Nonsense variants ("no" → "noed") are harmless: they only match if someone
// actually says them, and real labels always win the index (label-first).

const norm = (s) => String(s || '').trim().toLowerCase();

// Irregular inflections (base → variants). Curate freely; keep base-form keys.
export const IRREGULAR = {
  go: ['went', 'gone', 'goes', 'going'],
  eat: ['ate', 'eaten', 'eats', 'eating'],
  run: ['ran', 'runs', 'running'],
  sit: ['sat', 'sits', 'sitting'],
  sleep: ['slept', 'sleeps', 'sleeping'],
  drink: ['drank', 'drunk', 'drinks', 'drinking'],
  give: ['gave', 'given', 'gives', 'giving'],
  take: ['took', 'taken', 'takes', 'taking'],
  come: ['came', 'comes', 'coming'],
  see: ['saw', 'seen', 'sees', 'seeing'],
  say: ['said', 'says', 'saying'],
  get: ['got', 'gotten', 'gets', 'getting'],
  make: ['made', 'makes', 'making'],
  feel: ['felt', 'feels', 'feeling'],
  fall: ['fell', 'fallen', 'falls', 'falling'],
  ride: ['rode', 'ridden', 'rides', 'riding'],
  swim: ['swam', 'swum', 'swims', 'swimming'],
  throw: ['threw', 'thrown', 'throws', 'throwing'],
  catch: ['caught', 'catches', 'catching'],
  hold: ['held', 'holds', 'holding'],
  sing: ['sang', 'sung', 'sings', 'singing'],
  draw: ['drew', 'drawn', 'draws', 'drawing'],
  build: ['built', 'builds', 'building'],
  do: ['did', 'done', 'does', 'doing'],
  have: ['had', 'has', 'having'],
  put: ['puts', 'putting'],
  read: ['reads', 'reading'],
  mouse: ['mice'],
  foot: ['feet'],
  tooth: ['teeth'],
  child: ['children'],
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const isCVC = (w) =>
  w.length >= 3 && w.length <= 5 &&
  !VOWELS.has(w[w.length - 1]) && !'wxy'.includes(w[w.length - 1]) &&
  VOWELS.has(w[w.length - 2]) && !VOWELS.has(w[w.length - 3]);

/// Generated inflections for one normalized single word. Regular rules only —
/// irregulars come from the map above.
export function inflections(word) {
  const w = norm(word);
  // Irregulars first — several bases are short ("go", "do") and would
  // otherwise be rejected by the length gate below.
  if (IRREGULAR[w]) return IRREGULAR[w].slice();
  if (!/^[a-z]{3,}$/.test(w)) return [];
  const out = new Set();
  const endsY = w.endsWith('y') && !VOWELS.has(w[w.length - 2]);
  // s-form (plural / 3rd person)
  if (/(s|x|z|ch|sh)$/.test(w)) out.add(w + 'es');
  else if (endsY) out.add(w.slice(0, -1) + 'ies');
  else out.add(w + 's');
  // -ing
  if (w.endsWith('e') && !w.endsWith('ee') && !w.endsWith('ye') && !w.endsWith('oe')) out.add(w.slice(0, -1) + 'ing');
  else if (isCVC(w)) out.add(w + w[w.length - 1] + 'ing');
  else out.add(w + 'ing');
  // -ed
  if (w.endsWith('e')) out.add(w + 'd');
  else if (endsY) out.add(w.slice(0, -1) + 'ied');
  else if (isCVC(w)) out.add(w + w[w.length - 1] + 'ed');
  else out.add(w + 'ed');
  out.delete(w);
  return [...out];
}

/// Full match set for a tile: curated terms + generated inflections.
/// Returns normalized variants EXCLUDING the label itself, deduped, capped.
export function expandMatchTerms(label, curated = []) {
  const base = norm(label);
  const out = new Set();
  for (const c of Array.isArray(curated) ? curated : []) {
    const n = norm(c);
    if (n && n !== base) out.add(n);
  }
  // Single words inflect; multi-word labels rely on curated terms (inflecting
  // "all done" or "ice cream" makes nothing useful).
  if (base && !base.includes(' ')) {
    for (const v of inflections(base)) out.add(v);
  }
  return [...out].slice(0, 24);
}

/// Index tiles for the greedy tokenizer: labels first (a real tile named
/// "loves" always beats "love"'s variant), then every variant, first-wins.
export function buildMatchIndex(items, { normalize = norm } = {}) {
  const map = new Map();
  for (const it of items) {
    const key = normalize(it.label);
    if (key && !map.has(key)) map.set(key, it);
  }
  for (const it of items) {
    for (const v of it.matchTerms || []) {
      const key = normalize(v);
      if (key && !map.has(key)) map.set(key, it);
    }
  }
  return map;
}

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

// PUBLIC (graduated 2026-08-09 after owner field-testing): synonym matching
// + spoken captions ship to every board. /api/sync expands the sets for all
// callers and sends listenCaptions=true; the practice board (api/demo.js)
// and parent message matching (api/message-to-board.js) follow via their
// defaults. Flipping back to false re-darkens everything to admin-only.
export const SYNONYMS_PUBLIC = true;

// Synonym SETS — words that should land on the SAME tile in listening mode:
// someone says "hi" and the board's "hello" tile renders (with "hi" as the
// spoken caption). Sets, not pairs, and symmetric on purpose: whichever word
// of a set a family's tile is labeled with, the others become its variants.
// Same philosophy as IRREGULAR: curate HERE (every board benefits, zero DB
// writes, clients pick it up on next sync) and keep per-row match_terms for
// one-off words. Label-first indexing makes overlaps safe by construction —
// a real "puppy" tile always beats "dog"'s variant claim on the word.
// Conservative by design: true same-tile words only, no near-synonyms that
// would misrepresent what the child heard ("want" is not "need").
export const SYNONYM_SETS = [
  ['hello', 'hi', 'hey'],
  ['bye', 'goodbye', 'bye bye'],
  ['mom', 'mommy', 'mama', 'momma', 'mum'],
  ['dad', 'daddy', 'dada', 'papa'],
  ['grandma', 'grandmother', 'granny', 'nana', 'grammy'],
  ['grandpa', 'grandfather', 'grandad', 'granddad', 'gramps'],
  ['yes', 'yeah', 'yep', 'yup'],
  ['no', 'nope', 'nah'],
  ['big', 'large', 'huge', 'giant'],
  ['little', 'small', 'tiny'],
  ['happy', 'glad'],
  ['mad', 'angry'],
  ['sad', 'unhappy'],
  ['scared', 'afraid', 'frightened'],
  ['tired', 'sleepy'],
  ['tummy', 'belly', 'stomach'],
  ['bathroom', 'potty', 'toilet', 'restroom'],
  ['couch', 'sofa'],
  ['trash', 'garbage', 'rubbish'],
  ['blanket', 'blankie'],
  ['pacifier', 'paci', 'binky'],
  ['tv', 'telly', 'television'],
  ['phone', 'telephone'],
  ['picture', 'photo', 'pic'],
  ['airplane', 'plane', 'aeroplane'],
  ['bicycle', 'bike'],
  ['motorcycle', 'motorbike'],
  ['rabbit', 'bunny'],
  ['dog', 'doggy', 'puppy', 'pup'],
  ['cat', 'kitty', 'kitten'],
  ['bird', 'birdie'],
  ['duck', 'ducky'],
  ['pig', 'piggy'],
  ['frog', 'froggy'],
  ['horse', 'horsey'],
  ['candy', 'sweets'],
  ['pants', 'trousers'],
  ['diaper', 'nappy'],
  ['stroller', 'pram', 'buggy'],
  ['hurt', 'ouch', 'ow', 'owie', 'boo boo', 'it hurts'],
  ['cookie', 'biscuit'],
  ['yummy', 'tasty', 'delicious'],
  ['yucky', 'gross', 'icky', 'ew'],
  ['sick', 'ill', 'not feeling well'],
  ['music', 'song', 'songs'],
  ['blocks', 'building bricks', 'building blocks', 'legos', 'lego', 'bricks'],
  ['hat', 'cap', 'baseball cap', 'ball cap'],
  ['sleep', 'bedtime', 'bed time', 'sleepy time'],
  ['teacher', 'my teacher'],

  // ── Phrase tiles ──────────────────────────────────────────────────────────
  // Multi-word labels get NO generated inflections, so without these a
  // needs-strip or social tile matches only its exact label. These are the
  // shortened / lengthened forms people actually say ("want" → the I-want
  // tile); the spoken caption keeps the transcript honest. Owner directive
  // (2026-08-09): match GENEROUSLY — if a form generally means that tile,
  // matching is a benefit. The caption always shows the said word, and
  // label-first indexing means a board with the more specific tile wins it.
  // Still deliberately absent: bare "like" (filler: "like, you know"), bare
  // "okay"/"look"/"welcome" (said constantly in other senses).
  ['i want', 'want', 'i want it', 'i want that'],
  ['i like', 'i like it', 'i like this', 'like it'],
  ["i don't like", "don't like", "i don't like it", 'no like'],
  ['all done', 'done', 'finished', 'all finished'],
  ['thank you', 'thanks'],
  ['help', 'help me', 'i need help', 'help please'],
  ['more', 'more please', 'some more', 'want more'],
  ['again', 'do it again', 'one more time'],
  ['stop', 'stop it', 'stop that'],
  ['my turn', "it's my turn", 'my turn now', 'me turn'],
  ['your turn', "it's your turn"],
  ['i love you', 'love you'],
  ['i miss you', 'i missed you', 'missed you', 'miss you'],
  ['how are you', 'how are you doing', 'how you doing'],
  ["i'm great", 'im great', 'i am great', 'doing great'],
  ['have a great day', 'have a good day'],
  ["you're welcome", 'youre welcome'],
  ["that's funny", 'thats funny', 'so funny'],
  ["it's okay", 'its okay', "it's ok", 'its ok'],
  ['are you okay', 'are you ok', 'you okay', 'you ok'],
  ['look at this', 'look at that', 'look here'],
  ['nice to see you', 'good to see you'],
  ["what's your name", 'whats your name'],

  // Greetings, praise & manners
  ['good morning', 'morning everyone', 'good morning everyone'],
  ['good night', 'goodnight', 'night night', 'nighty night', 'sweet dreams'],
  ['good job', 'great job', 'nice job', 'well done', 'way to go', 'nice work'],
  ['no thank you', 'no thanks'],
  ['excuse me', 'pardon me', 'scuse me', 'pardon'],
  ['sorry', 'sorry about that', "i'm sorry", 'im sorry', 'i am sorry', 'my bad'],
  ['see you later', 'see you', 'see ya', 'see you soon', 'bye for now'],
  ['happy birthday', 'happy birthday to you', 'happy bday'],

  // Needs & requests
  ["i'm hungry", 'im hungry', 'i am hungry', 'hungry', 'so hungry'],
  ["i'm thirsty", 'im thirsty', 'i am thirsty', 'thirsty', 'so thirsty'],
  ['i need a break', 'need a break', 'break please', 'take a break', 'break time'],
  ['hold me', 'pick me up', 'hold me please', 'up please', 'uppy', 'uppies'],
  ['carry me', 'carry me please'],
  ['may i', 'may i please', 'can i', 'can i please'],
  ['wait', 'wait a minute', 'wait a second', 'wait a sec', 'just a minute', 'just a second', 'hang on', 'hold on'],
  ['all done eating', 'done eating', 'finished eating'],

  // Play, encouragement & togetherness
  ['i did it', 'i did it myself', 'did it', 'i did that'],
  ['try again', 'try it again', 'one more try', 'do over'],
  ['ready to play', "let's play", 'lets play', 'wanna play', 'want to play', 'play with me'],
  ["let's go", 'lets go', 'time to go', 'come on'],
  ['i see you', 'i can see you', 'peekaboo', 'peek a boo'],
  ["what's that", 'whats that', 'what is that', "what's this", 'whats this', 'what is this'],
  ['where are you', 'where did you go', "where'd you go"],
  ['family hug', 'group hug', 'big hug'],
  ['snuggle with me', 'snuggle', 'snuggles', 'cuddle', 'cuddles', 'cuddle with me'],

  // Bedtime & routines
  ['read to me', 'read me a book', 'read me a story', 'story time', 'read a story'],
  ['one more book', 'another book', 'one more story', 'another story'],
  ['tuck me in', 'tuck in', 'tuck me in please'],
  ['goodnight kiss', 'kiss goodnight', 'night night kiss'],
  ['bath time', 'bathtime', 'take a bath', 'bath', 'bubble bath'],
  ['brush teeth', 'brush your teeth', 'brush my teeth', 'toothbrush'],

  // School & therapy
  ['quiet please', 'quiet down', 'shh', 'shhh', 'inside voice'],
  ['line up', 'get in line', 'time to line up', 'line up please'],
  ['circle time', 'carpet time', 'rug time'],
  ['raise my hand', 'raise your hand', 'hand up', 'hands up'],
  ['show and tell', 'show n tell'],
  ['calm corner', 'calm down corner', 'cozy corner', 'quiet corner'],
  ['quiet space', 'calm space'],
  ['visual schedule', 'schedule', 'my schedule'],
  ['my aide', 'my helper'],
  ['my lovey', 'lovey'],

  // Places & things
  ["grandma's house", 'grandmas house', "nana's house", 'nanas house', "granny's house"],
  ["grandpa's house", 'grandpas house', "papa's house", 'papas house'],
  ['next to', 'beside'],
  ['ice cream', 'icecream'],
  ['hot dog', 'hotdog', 'hot dogs', 'hotdogs'],
  ['play dough', 'playdough', 'play doh', 'playdoh'],
  ['jump rope', 'jumprope', 'skipping rope'],
  ['hula hoop', 'hoola hoop'],
  ['race car', 'racecar', 'racing car'],
  ['fire truck', 'firetruck', 'fire engine'],
  ['dump truck', 'dumptruck'],
  ['garbage truck', 'trash truck', 'rubbish truck'],
  ['cement mixer', 'mixer truck', 'concrete mixer'],
  ['police car', 'cop car'],
  ['police officer', 'policeman', 'policewoman', 'cop'],
  ['mail carrier', 'mailman', 'mail man', 'postman', 'letter carrier'],
  ['pill bug', 'roly poly', 'rolly polly', 'pillbug'],
  ['water bottle', 'bottle of water'],
  ['sippy cup', 'sippy'],
  ['rain boots', 'rainboots', 'wellies', 'galoshes'],
  ['action figure', 'action figures'],

  // Holidays
  ['fourth of july', '4th of july', 'july 4th', 'july fourth', 'independence day'],
  ["st. patrick's day", 'st patricks day', "saint patrick's day", 'saint patricks day'],
  ["valentine's day", 'valentines day', 'valentines'],
  ["mother's day", 'mothers day'],
  ["father's day", 'fathers day'],
  ['april fools day', 'april fools', "april fool's day"],
  ["new year's eve", 'new years eve'],
  ['new year', 'new years'],

  // Clock tiles: recognizers transcribe the hour as a digit or a word.
  ["1 o'clock", "one o'clock"],
  ["2 o'clock", "two o'clock"],
  ["3 o'clock", "three o'clock"],
  ["4 o'clock", "four o'clock"],
  ["5 o'clock", "five o'clock"],
  ["6 o'clock", "six o'clock"],
  ["7 o'clock", "seven o'clock"],
  ["8 o'clock", "eight o'clock"],
  ["9 o'clock", "nine o'clock"],
  ["10 o'clock", "ten o'clock"],
  ["11 o'clock", "eleven o'clock"],
  ["12 o'clock", "twelve o'clock"],
];

// label → the other words of its set (derived once; sets stay the source).
export const SYNONYMS = (() => {
  const map = {};
  for (const set of SYNONYM_SETS) {
    for (const word of set) {
      map[word] = set.filter((w) => w !== word);
    }
  }
  return map;
})();

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
/// `synonyms` defaults to the launch flag so callers with no opinion (demo,
/// message-to-board) go live in the same flip; sync passes its own value
/// (admin callers get them early for field testing).
export function expandMatchTerms(label, curated = [], { synonyms = SYNONYMS_PUBLIC } = {}) {
  const base = norm(label);
  const out = new Set();
  for (const c of Array.isArray(curated) ? curated : []) {
    const n = norm(c);
    if (n && n !== base) out.add(n);
  }
  // Engine synonyms: every tile whose label sits in a SYNONYM_SET matches
  // the set's other words ("hello" tile hears "hi"/"hey"). The lookup also
  // tries a punctuation-stripped key: labels like "How are you?" or
  // "It's okay." must still find their set (sets are keyed bare; client
  // tokenizers strip the same punctuation when they index).
  if (synonyms) {
    const bare = base.replace(/[.,!?;:"()\[\]{}]/g, '').replace(/\s+/g, ' ').trim();
    for (const s of SYNONYMS[base] || SYNONYMS[bare] || []) out.add(s);
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

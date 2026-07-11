// Communication milestones — the product's emotional core, detected from the
// tap stream the board already records. Purely observational: nothing about
// the child's experience changes; the parent gets the moment preserved.
//
// Detected (v1, deliberately few and high-signal):
//   words       vocabulary breadth crossing a mark (5/10/25/50/100/200/365
//               distinct words ever tapped by the child)
//   first_combo the FIRST time two different words are tapped back-to-back
//               within the combo window — emergent word combination, the
//               milestone AAC exists for
//   combo       each NEW word pair after that (quiet keepsakes — no push)
//   chain3      first three-word chain
//
// Combo detection uses PIVOT-GRAMMAR FRAMES — the shapes toddler two-word
// speech actually takes — split into two confidence tiers:
//
//   HIGH (creates first_combo, pushes to the parent's phone):
//     pivot + content        "I want cookie", "more bubbles", "no bath"
//     content + more/again   "cookie more" (reversed pivot — very common)
//     person + action        "Mom help", "Dad eat"
//     action + thing         "eat banana", "open door"
//   LOW (quiet keepsake row only, parent judges — never pushes):
//     any other cross-section pair
//   SKIPPED entirely:
//     same word twice; same-folder noun browsing; anything with "yes"
//     (pure response word, not compositional); desire/action pivots with a
//     FEELINGS complement — "want sad" / "more angry" mean nothing, only
//     like/don't-like/no/feel pivots may take a feeling ("I like happy").
//
// Two taps 0.5–8s apart. Dedup is structural (UNIQUE child+kind+detail_key)
// so re-ingestion never duplicates a first. Runs inline on /api/events
// ingestion, fire-and-forget — never cron-only, never blocking a tap.
import { apnsConfigured, sendToTokens } from './apns.js';

const VOCAB_MARKS = [5, 10, 25, 50, 100, 200, 365];
const COMBO_ROW_CAP = 150;         // per child — keepsakes, not a firehose

const norm = (s) => String(s || '').trim().toLowerCase();

// Opener words that take a complement. Curate freely — one list, normed.
const PIVOTS = new Set([
  'i want', 'want', 'more', 'again', 'i like', "i don't like", 'no',
  'eat', 'drink', 'give', 'give me', 'help', 'open', 'close', 'go', 'stop',
  'look', 'come', 'my turn', 'all done', 'get', 'find', 'where',
]);
// Pivots allowed to take a FEELINGS complement ("I like happy", "no sad").
const FEELING_PIVOTS = new Set(['i like', "i don't like", 'no', 'feel', 'i feel']);
// Needs-strip words that work as CONTENT after a pivot ("I want eat").
const CONTENT_NEEDS = new Set(['eat', 'drink', 'potty', 'bathroom', 'help', 'hug', 'play', 'outside']);
// Pure response words — never part of a combination.
const NOISE_WORDS = new Set(['yes']);
// Category names that hold feelings/emotion words (normed contains-match).
const FEELING_CATS = ['expression', 'feeling', 'emotion'];

const isFeeling = (categoryName) => {
  const c = norm(categoryName);
  return !!c && FEELING_CATS.some((f) => c.includes(f));
};
const isContent = (word, section, categoryName) => {
  const sec = norm(section);
  if (sec === 'nouns' || sec === 'people') return true;
  if (sec === 'verbs') return true;
  return CONTENT_NEEDS.has(word);
};

/// Classify a pair of taps. Returns 'high' | 'low' | null (skip).
export function classifyCombo(prev, t) {
  const a = norm(prev.label), b = norm(t.label);
  if (!a || !b || a === b) return null;
  if (NOISE_WORDS.has(a) || NOISE_WORDS.has(b)) return null;
  const secA = norm(prev.section), secB = norm(t.section);

  // Feelings complement: only the like/no/feel pivots may take one.
  if (isFeeling(t.categoryName) && !FEELING_PIVOTS.has(a)) return null;

  // HIGH-confidence frames.
  if (PIVOTS.has(a) && isContent(b, secB, t.categoryName)) return 'high';       // want + cookie
  if ((b === 'more' || b === 'again') && isContent(a, secA, prev.categoryName)) return 'high'; // cookie + more
  if (secA === 'people' && (secB === 'verbs' || CONTENT_NEEDS.has(b))) return 'high';          // Mom + help
  if (secA === 'verbs' && (secB === 'nouns' || secB === 'people')) return 'high';              // eat + banana

  // Everything else: cross-section pairs are plausible telegraphic speech —
  // keep quietly for the parent to judge. Same-section pairs are browsing.
  if (secA !== secB) return 'low';
  return null;
}

export async function ensureMilestones(db) {
  await db`
    CREATE TABLE IF NOT EXISTS milestones (
      id          BIGSERIAL PRIMARY KEY,
      child_id    TEXT NOT NULL,
      kind        TEXT NOT NULL,
      detail_key  TEXT NOT NULL,
      payload     JSONB,
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (child_id, kind, detail_key)
    )`;
  await db`CREATE INDEX IF NOT EXISTS milestones_child_idx ON milestones(child_id, occurred_at DESC)`;
}

async function record(db, childId, kind, detailKey, payload, occurredAt) {
  const rows = await db`
    INSERT INTO milestones (child_id, kind, detail_key, payload, occurred_at)
    VALUES (${childId}, ${kind}, ${detailKey}, ${JSON.stringify(payload)}::jsonb, ${occurredAt})
    ON CONFLICT (child_id, kind, detail_key) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

/// Incremental detection over the taps just ingested for ONE child.
/// `taps`: [{ label, section, occurredAt }] student taps with labels.
/// Returns the newly created milestones (empty when nothing new).
export async function detectMilestones(db, childId, taps) {
  const withLabels = (taps || []).filter((t) => t && t.label && t.occurredAt);
  if (!withLabels.length) return [];
  await ensureMilestones(db);
  const created = [];

  // ── Vocabulary breadth ────────────────────────────────────────────────
  try {
    const n = (await db`
      SELECT count(DISTINCT lower(label))::int AS n FROM events
      WHERE child_id = ${childId} AND role = 'student' AND label IS NOT NULL`)[0].n;
    for (const mark of VOCAB_MARKS) {
      if (n < mark) break;
      if (await record(db, childId, 'words', `words_${mark}`, { count: mark, total: n },
                       withLabels[withLabels.length - 1].occurredAt)) {
        created.push({ kind: 'words', mark });
      }
    }
  } catch (_) { /* each detector is independent */ }

  // ── Combinations + chains ─────────────────────────────────────────────
  for (const t of withLabels) {
    try {
      const prev = (await db`
        SELECT label, section, category_name, occurred_at FROM events
        WHERE child_id = ${childId} AND role = 'student' AND label IS NOT NULL
          AND occurred_at < ${t.occurredAt}
          AND occurred_at > ${t.occurredAt}::timestamptz - interval '8 seconds'
        ORDER BY occurred_at DESC LIMIT 1`)[0];
      if (!prev) continue;
      const confidence = classifyCombo(
        { label: prev.label, section: prev.section, categoryName: prev.category_name },
        t);
      if (!confidence) continue;
      const a = norm(prev.label), b = norm(t.label);

      const phrase = `${prev.label} ${t.label}`;
      const payload = { phrase, first: prev.label, second: t.label, confidence };
      // Only a HIGH-confidence frame can be "the first combination" — the
      // push a parent screenshots must never say "want sad".
      if (confidence === 'high') {
        if (await record(db, childId, 'first_combo', 'first', payload, t.occurredAt)) {
          created.push({ kind: 'first_combo', phrase });
        }
      }
      const comboCount = (await db`
        SELECT count(*)::int AS n FROM milestones WHERE child_id = ${childId} AND kind = 'combo'`)[0].n;
      if (comboCount < COMBO_ROW_CAP) {
        if (await record(db, childId, 'combo', `combo:${a}→${b}`, payload, t.occurredAt)) {
          created.push({ kind: 'combo', phrase, quiet: true });
        }
      }

      // Three-word chain: only on a HIGH pair, extended by one more distinct
      // word within 8s before `prev`.
      if (confidence === 'high') {
        const prev2 = (await db`
          SELECT label FROM events
          WHERE child_id = ${childId} AND role = 'student' AND label IS NOT NULL
            AND occurred_at < ${prev.occurred_at}
            AND occurred_at > ${prev.occurred_at}::timestamptz - interval '8 seconds'
          ORDER BY occurred_at DESC LIMIT 1`)[0];
        if (prev2 && norm(prev2.label) !== a && norm(prev2.label) !== b) {
          const chain = `${prev2.label} ${prev.label} ${t.label}`;
          if (await record(db, childId, 'chain3', 'first', { phrase: chain }, t.occurredAt)) {
            created.push({ kind: 'chain3', phrase: chain });
          }
        }
      }
    } catch (_) { /* one bad tap must not sink the batch */ }
  }

  // ── Push the loud ones (quiet keepsakes stay in the dashboard) ────────
  try {
    const loud = created.filter((m) => !m.quiet);
    if (loud.length && apnsConfigured()) {
      const setRows = await db`SELECT settings FROM child_settings WHERE child_id = ${childId}`;
      const optedOut = setRows.length && setRows[0].settings && setRows[0].settings.milestonesPush === false;
      if (!optedOut) {
        const toks = await db`SELECT token FROM push_tokens WHERE child_id = ${childId} AND role IN ('parent','admin')`;
        if (toks.length) {
          const name = (childId.replace(/peterson$/i, '').replace(/^\w/, (c) => c.toUpperCase())) || 'Your child';
          const m = loud.find((x) => x.kind === 'first_combo') || loud.find((x) => x.kind === 'chain3') || loud[0];
          const body = m.kind === 'first_combo'
            ? `${name} just put two words together for the first time: “${m.phrase}” 🎉`
            : m.kind === 'chain3'
              ? `${name} chained three words: “${m.phrase}” 🎉`
              : `${name} has now used ${m.mark} different words on the board 📚`;
          await sendToTokens(toks.map((t) => t.token),
            { title: 'A first worth keeping', body: body.slice(0, 178), data: { kind: 'milestone' } });
        }
      }
    }
  } catch (_) { /* notification is best-effort, the row is the record */ }

  return created;
}

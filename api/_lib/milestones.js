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
// Combo heuristic (kept honest, not clever): two student taps 0.5–8s apart,
// different words, and EITHER different board sections OR one side is an
// operator word (needs/verbs) — "more + bubbles", "eat + banana",
// "Mom + help". Two nouns in a row from the same folder is browsing, not
// combining, and is skipped. Parents judge the keepsake; we just never
// invent one twice (UNIQUE child+kind+detail_key, so re-ingestion is safe).
//
// Detection runs inline on /api/events ingestion (fire-and-forget from the
// caller — never cron-only, never blocking ingestion).
import { apnsConfigured, sendToTokens } from './apns.js';

const VOCAB_MARKS = [5, 10, 25, 50, 100, 200, 365];
const COMBO_ROW_CAP = 150;         // per child — keepsakes, not a firehose
const OPERATOR_SECTIONS = new Set(['needs', 'verbs']);

const norm = (s) => String(s || '').trim().toLowerCase();

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
        SELECT label, section, occurred_at FROM events
        WHERE child_id = ${childId} AND role = 'student' AND label IS NOT NULL
          AND occurred_at < ${t.occurredAt}
          AND occurred_at > ${t.occurredAt}::timestamptz - interval '8 seconds'
        ORDER BY occurred_at DESC LIMIT 1`)[0];
      if (!prev) continue;
      const a = norm(prev.label), b = norm(t.label);
      if (!a || !b || a === b) continue;
      const sameSection = norm(prev.section) === norm(t.section);
      const hasOperator = OPERATOR_SECTIONS.has(norm(prev.section)) || OPERATOR_SECTIONS.has(norm(t.section));
      if (sameSection && !hasOperator) continue;   // same-folder browsing, not combining

      const phrase = `${prev.label} ${t.label}`;
      const payload = { phrase, first: prev.label, second: t.label };
      if (await record(db, childId, 'first_combo', 'first', payload, t.occurredAt)) {
        created.push({ kind: 'first_combo', phrase });
      }
      const comboCount = (await db`
        SELECT count(*)::int AS n FROM milestones WHERE child_id = ${childId} AND kind = 'combo'`)[0].n;
      if (comboCount < COMBO_ROW_CAP) {
        if (await record(db, childId, 'combo', `combo:${a}→${b}`, payload, t.occurredAt)) {
          created.push({ kind: 'combo', phrase, quiet: true });
        }
      }

      // Three-word chain: one more distinct word within 8s before `prev`.
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

// /api/admin/lab?action=lang-audio  (admin only)
//
// The language review bench's back end: "what will a child on a <lang> board
// actually HEAR, word by word?"
//
// Until this existed, the first time anything was ever synthesized in a target
// language was Lab → Publish → push sounds, which writes straight to a real
// child's board. The voice-lab QC bench doesn't cover it either — its word list
// is `SELECT label FROM taxonomy`, i.e. English, so a Chinese voice gets QC'd
// reading English words. This is the missing middle step: generate a language,
// then review it, before anyone's board sees it.
//
// Every word lands in one of four states:
//   english  no label_translations row → spokenTextFor falls through to the
//            English taxonomy label, so this tile SPEAKS ENGLISH on a <lang>
//            board. (The reported symptom "English words with a Chinese
//            accent" is this state plus un-pushed clips.)
//   missing  translated, but nothing has synthesized it in this voice yet — a
//            push would have to generate it (slow, costs money, and is what
//            makes a push report partial:true).
//   stale    a clip was built, then the translation/pronunciation was edited;
//            what's cached no longer matches what a board would speak.
//   ready    cached for exactly the current text in this voice → a push is a
//            free copy out of the shared TTS cache.
//
// The spoken text MUST be derived with the same chain pushSounds uses
// (translation.pronunciation → translation.label → taxonomy.pronunciation →
// taxonomy.label — seed-board's spokenTextFor), or the bench both misses the
// shared render cache and auditions something the board will never say.
//
//   GET  ?lang=zh&voiceId=…        → { rows, counts, approved, voice, lang }
//   GET  ?lang=zh&child=<slug|email>  → same, but scoped to that child's ACTUAL
//                                     tiles, with their saved voice + board
//                                     language resolved server-side ("what
//                                     would a push to this board install")
//   POST { op:'build', lang, voiceId, force? } → resumable synthesis pass
//   POST { op:'qc', lang, voiceId, en, approved } → listen-and-confirm mark
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { synthesizeVoice, loadChildVoiceId } from '../_lib/onboarding-render.js';
import { childLanguage } from '../_lib/i18n.js';

export const config = { maxDuration: 300 };

const norm = (s) => String(s || '').trim().toLowerCase();
const LANG_RE = /^[a-z]{2}(-[a-z0-9]{2,8})?$/i;
const VOICE_RE = /^[A-Za-z0-9]{8,40}$/;

// Leaves headroom under maxDuration so a long build returns its progress
// instead of being killed mid-pass (same budget the demo-audio builder uses).
const BUILD_DEADLINE_MS = 240_000;

async function ensureIndex(db) {
  // What has been synthesized, per (language, voice, word). Deliberately stores
  // the spoken TEXT rather than the blob cache key: staleness is then just a
  // string compare, and the sha256(model|voice|emotion|text) recipe keeps its
  // existing three call sites instead of gaining a fourth to hold in lockstep.
  await db`
    CREATE TABLE IF NOT EXISTS lang_clip_index (
      lang          TEXT NOT NULL,
      voice_id      TEXT NOT NULL,
      section       TEXT NOT NULL DEFAULT '',
      category_norm TEXT NOT NULL DEFAULT '',
      label_norm    TEXT NOT NULL,
      text          TEXT NOT NULL,
      built_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (lang, voice_id, section, category_norm, label_norm)
    )`;
}

async function ensureQc(db) {
  await db`
    CREATE TABLE IF NOT EXISTS voice_qc (
      voice_id TEXT NOT NULL,
      label_norm TEXT NOT NULL,
      approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (voice_id, label_norm)
    )`;
}

// Translation-map lookup precedence, mirroring i18n.js translate(): the map
// here is keyed the same way, but built from rows we already fetched so the
// projection is one query instead of one per word. Returns the MATCHED KEY
// too — most dictionary rows are wildcards (no section/category), so the
// client can only line a clip row up with its dictionary row if we say which
// row actually translated it. Joining by exact (section|category|label)
// equality instead is the bug that left every wildcard row with no ▶ button.
function pick(map, { label, section, category }) {
  const l = norm(label), s = norm(section), c = norm(category);
  for (const k of [`${s}|${c}|${l}`, `${s}||${l}`, `|${c}|${l}`, `||${l}`]) {
    const hit = map.get(k);
    if (hit) return { label: hit.label, pronunciation: hit.pronunciation, key: k };
  }
  return null;
}

/// Resolve `child` (board slug or account email) → slug, or '' when unknown.
async function resolveChild(db, child) {
  const q = norm(child);
  if (!q) return '';
  if (q.includes('@')) {
    const u = (await db`SELECT child_slug FROM users WHERE lower(email) = ${q} LIMIT 1`)[0];
    return (u && u.child_slug) || '';
  }
  return q;
}

/// The words under review. Without a child: every canonical/universal taxonomy
/// label (the same filter the translations coverage report uses, so the two
/// screens can't disagree). With a child: only the words actually on their
/// board, which is exactly what a push would touch.
async function reviewWords(db, childId) {
  if (childId) {
    const rows = await db`
      SELECT DISTINCT t.label, i.section, t.category, t.pronunciation
      FROM items i JOIN taxonomy t ON t.id = i.taxonomy_slug
      WHERE i.child_id = ${childId}`;
    return rows.map((r) => ({ label: r.label, section: r.section || '',
                              category: r.category || '', pronunciation: r.pronunciation || null }));
  }
  // seed-board places tiles with section = lower(taxonomy.column_name), and the
  // dictionary's homonym overrides are keyed on that same lowercased section —
  // so the projection must read column_name, not invent a section.
  const rows = await db`
    SELECT DISTINCT label, column_name AS section, category, pronunciation
    FROM taxonomy
    WHERE COALESCE(archived, FALSE) = FALSE
      AND COALESCE(authoring_kind, 'canonical') = 'canonical'
      AND COALESCE(audience, 'universal') = 'universal'`;
  return rows.map((r) => ({ label: r.label, section: r.section || '',
                            category: r.category || '', pronunciation: r.pronunciation || null }));
}

/// One row per word: the exact text a board would speak + its clip state.
async function project(db, { lang, voiceId, childId }) {
  const trRows = await db`
    SELECT section, category_norm, label_norm, label, pronunciation
    FROM label_translations WHERE lang = ${lang}`;
  const trMap = new Map();
  for (const r of trRows) {
    trMap.set(`${r.section}|${r.category_norm}|${r.label_norm}`,
              { label: r.label, pronunciation: r.pronunciation || null });
  }

  const idxRows = voiceId
    ? await db`SELECT section, category_norm, label_norm, text
               FROM lang_clip_index WHERE lang = ${lang} AND voice_id = ${voiceId}`
    : [];
  const idx = new Map(idxRows.map((r) => [`${r.section}|${r.category_norm}|${r.label_norm}`, r.text]));

  const words = await reviewWords(db, childId);
  const counts = { english: 0, missing: 0, stale: 0, ready: 0 };
  const rows = [];
  const seen = new Set();
  for (const w of words) {
    const en = norm(w.label);
    if (!en) continue;
    const s = norm(w.section), c = norm(w.category);
    const dedupe = `${s}|${c}|${en}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const tr = pick(trMap, w);
    // spokenTextFor, verbatim: the translation's pronunciation wins, then its
    // label, then the English row's own overrides.
    const text = String((tr && (tr.pronunciation || tr.label)) || w.pronunciation || w.label || '')
      .trim().slice(0, 300);
    let status;
    if (!tr) status = 'english';
    else if (!voiceId) status = 'missing';
    else {
      const built = idx.get(dedupe);
      status = built == null ? 'missing' : (built === text ? 'ready' : 'stale');
    }
    counts[status]++;
    rows.push({ en: w.label, section: s, category: c,
                dictKey: (tr && tr.key) || null,
                translation: (tr && tr.label) || null,
                pron: (tr && tr.pronunciation) || null,
                text, status });
  }
  rows.sort((a, b) => a.en.localeCompare(b.en));
  return { rows, counts };
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await ensureIndex(db);
  await ensureQc(db);

  const q = req.query || {};
  const b = (typeof req.body === 'object' && req.body) || {};
  const rawLang = String(q.lang || b.lang || '');
  let lang = LANG_RE.test(rawLang) ? rawLang.toLowerCase() : 'zh';

  try {
    if (req.method === 'GET') {
      // A named child overrides both pickers: the point of this mode is to
      // report on the board as it is actually configured, not as the admin
      // guessed it was.
      let childId = await resolveChild(db, q.child);
      let voiceId = VOICE_RE.test(String(q.voiceId || '')) ? String(q.voiceId) : '';
      let childFound = false;
      let voiceLang = null;
      if (childId) {
        const exists = (await db`SELECT 1 AS ok FROM items WHERE child_id = ${childId} LIMIT 1`)[0];
        childFound = !!exists;
        if (!childFound) childId = '';
        else {
          lang = await childLanguage(db, childId);
          const v = await loadChildVoiceId(db, childId);
          if (v && VOICE_RE.test(v)) voiceId = v;
          // The saved voice's language tag, so the UI can warn when a family
          // picked an English voice and later flipped the board's language —
          // Chinese words in an English voice is exactly the class of wrong
          // this bench exists to make audible. Null when the voice isn't in
          // the catalog (e.g. a private clone): unknown, so no warning.
          if (voiceId) {
            try {
              const vr = (await db`SELECT lang FROM voices WHERE id = ${voiceId} LIMIT 1`)[0];
              voiceLang = vr ? (vr.lang || 'en') : null;
            } catch (_) { voiceLang = null; }
          }
        }
      }

      const { rows, counts } = await project(db, { lang, voiceId, childId });
      const approved = voiceId
        ? (await db`SELECT label_norm FROM voice_qc WHERE voice_id = ${voiceId}
                    AND label_norm LIKE ${lang + '|%'}`)
            .map((r) => String(r.label_norm).slice(lang.length + 1))
        : [];

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, lang, voiceId: voiceId || null,
        voiceLang,
        child: childId || null,
        childFound: q.child ? childFound : undefined,
        // An English board has no translation layer at all — say so plainly
        // rather than reporting 1,600 words as "speaks English".
        englishBoard: lang === 'en',
        rows, counts, approved });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    if (b.op === 'qc') {
      const voiceId = String(b.voiceId || '').trim();
      const en = norm(b.en);
      if (!VOICE_RE.test(voiceId) || !en) { res.status(400).json({ error: 'voiceId and en required' }); return; }
      // Namespaced into the existing voice_qc table, following the convention
      // already used there for teaching clues ('clue|…'). A ✓ on the Chinese
      // bench never collides with the English voice bench's marks.
      const key = `${lang}|${en}`;
      if (b.approved === false) {
        await db`DELETE FROM voice_qc WHERE voice_id = ${voiceId} AND label_norm = ${key}`;
      } else {
        await db`INSERT INTO voice_qc (voice_id, label_norm) VALUES (${voiceId}, ${key})
                 ON CONFLICT (voice_id, label_norm) DO UPDATE SET approved_at = NOW()`;
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (b.op !== 'build') { res.status(400).json({ error: 'unknown op' }); return; }

    const voiceId = String(b.voiceId || '').trim();
    if (!VOICE_RE.test(voiceId)) { res.status(400).json({ error: 'voiceId required' }); return; }
    // Without the key EVERY synthesis returns null — say so once, up front,
    // instead of reporting N anonymous failures.
    if (!process.env.Fletchers_AAC_Device) {
      res.status(500).json({ error: 'ElevenLabs API key not configured on the server (Fletchers_AAC_Device)' });
      return;
    }
    const childId = await resolveChild(db, b.child);
    // Same rule as the GET: a named board's own settings decide its language,
    // so a stale picker in the caller can't build the wrong dictionary.
    if (childId) lang = await childLanguage(db, childId);
    if (lang === 'en') { res.status(400).json({ error: 'pick a non-English language' }); return; }
    const force = b.force === true;

    const { rows, counts } = await project(db, { lang, voiceId, childId });
    // Untranslated words are deliberately NOT synthesized: rendering the
    // English word in a Chinese voice would bake the reported bug into the
    // cache and make the bench report ✅ for a tile that speaks English. Fix
    // the translation first; the 'english' count is the work queue.
    const todo = rows.filter((r) => r.status === 'english' ? false
      : force ? true : r.status !== 'ready');

    const deadline = Date.now() + BUILD_DEADLINE_MS;
    const stats = { cached: 0, generated: 0 };
    const errs = [];
    let built = 0, failed = 0, remaining = 0;
    for (const r of todo) {
      if (Date.now() > deadline) { remaining++; continue; }
      const mp3 = await synthesizeVoice({ text: r.text, voiceId, db, kind: 'lang-review', stats, errs });
      if (!mp3) { failed++; continue; }
      built++;
      await db`
        INSERT INTO lang_clip_index (lang, voice_id, section, category_norm, label_norm, text)
        VALUES (${lang}, ${voiceId}, ${r.section}, ${r.category}, ${norm(r.en)}, ${r.text})
        ON CONFLICT (lang, voice_id, section, category_norm, label_norm)
        DO UPDATE SET text = ${r.text}, built_at = NOW()`;
    }

    // Failures come back with their cause, plus a hint for the known cases —
    // the voice lab's lookup taught us which ElevenLabs errors actually
    // happen: a key without permissions, a voice never added to the
    // workspace, and quota.
    const firstError = errs[0] || null;
    let hint = '';
    if (failed > 0 && firstError) {
      if (/HTTP 401|missing_permissions/i.test(firstError)) {
        hint = 'The API key was rejected — check it in ElevenLabs → Developers → API Keys.';
      } else if (/HTTP 40[34]|voice_not_found|does not exist/i.test(firstError)) {
        hint = 'ElevenLabs doesn’t recognize this voice id for your account — open the voice in ElevenLabs and add it to My Voices first.';
      } else if (/HTTP 429|quota|too_many/i.test(firstError)) {
        hint = 'ElevenLabs quota/rate limit hit — wait and run build again; already-built clips are kept.';
      }
    }
    res.status(200).json({ ok: true, lang, voiceId, built, failed, remaining,
      total: todo.length, fromCache: stats.cached, generated: stats.generated,
      skippedEnglish: counts.english, firstError, hint: hint || null,
      note: (built > 0
        ? `${stats.cached} copied free from your existing voice cache, ${stats.generated} newly generated. `
        : '') + (remaining > 0 ? 'Run build again to finish the rest.' : 'Complete.') });
  } catch (err) {
    res.status(500).json({ error: 'lang-audio failed', detail: String(err.message || err) });
  }
}

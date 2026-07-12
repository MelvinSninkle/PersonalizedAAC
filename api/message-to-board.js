// POST /api/message-to-board
//   Body: { childId, text }
//
// SwiftUI PRD §4.7: the parent types a text message; the iPad renders it as a
// sequence of board images — like hieroglyphs — and speaks each in the board's
// voice. Words the board doesn't have are rendered as text (and TTS'd on the
// iPad). No inline interspersing in v1; the message is a flat sequence.
//
// Tokenization is greedy-longest: try the whole sentence as a tile first, then
// each shrinking window down to single words. Lets phrases like "I love you"
// resolve to one tile if it exists, rather than three. Punctuation is stripped;
// case is ignored. Linking-words (a, the, to…) are kept — they have tiles on
// the board, but if no tile matches a token we emit it as text without
// imploding the sentence.
//
// The sequence is published to the live channel as
//   { action: 'message', tokens: [...] }
// so the iPad's existing live listener applies it. The phone also gets the
// resolved sequence back so it can show a preview of "this is how the child
// will see it" before sending.
//
// Auth: parent of the child or admin (writers to live for that child).
import { checkAuth } from './_lib/auth.js';
import { canAccessChild, isParentOf } from './_lib/access.js';
import { sql } from './_lib/db.js';

const MAX_TEXT = 240;          // a sentence or two — keeps the iPad sequence reasonable
const MAX_WINDOW = 6;          // longest phrase we'll attempt to match as one tile
const MAX_TOKENS = 30;         // ceiling on emitted tokens
const SPEAK_MS_DEFAULT = 1400; // how long each tile holds on screen, default

// Drop trailing punctuation and double-spaces; keep apostrophes (don't, I'm).
function normalizeWord(w) {
  return String(w || '')
    .toLowerCase()
    .replace(/[.,!?;:"()\[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Split into words for tokenization, preserving the original spelling so
// fallback text tokens look right.
function splitWords(text) {
  return String(text).slice(0, MAX_TEXT)
    .split(/\s+/)
    .map(w => w.replace(/^[.,!?;:"()\[\]{}]+|[.,!?;:"()\[\]{}]+$/g, ''))
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = String(b.childId || '').slice(0, 64).trim();
  const text = String(b.text || '').slice(0, MAX_TEXT).trim();
  if (!childId || !text) { res.status(400).json({ error: 'childId and text required' }); return; }
  if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }
  // Only a parent (or admin) should be able to push a message — therapists
  // have view access but shouldn't drop arbitrary text on a family's iPad.
  if (auth.user.role !== 'admin' && !(await isParentOf(auth.user, childId))) {
    res.status(403).json({ error: 'Parent of this child required' }); return;
  }

  try {
    const db = sql();
    // Pull every tile that has an image (only those can carry the sequence).
    // Includes shared template items the child can see (child_id IS NULL +
    // an active category_shares row), since they're on the board.
    let items;
    try {
      items = await db`
      WITH RECURSIVE shared_tree AS (
        SELECT c.id FROM categories c
        JOIN category_shares cs ON cs.category_id = c.id
        WHERE cs.child_id = ${childId} AND cs.status = 'active' AND c.child_id IS NULL
        UNION ALL
        SELECT c.id FROM categories c
        JOIN shared_tree t ON c.parent_id = t.id
        WHERE c.child_id IS NULL
      )
      SELECT i.id, i.label, i.image_key, i.sound_key, i.section, t.match_terms
      FROM items i LEFT JOIN taxonomy t ON t.id = i.taxonomy_slug
      WHERE i.image_key IS NOT NULL AND (
        i.child_id = ${childId} OR (i.child_id IS NULL AND i.category_id IN (SELECT id FROM shared_tree))
      )`;
    } catch (_) {
      // Pre-migration deploy: same query without the taxonomy join.
      items = await db`
      WITH RECURSIVE shared_tree AS (
        SELECT c.id FROM categories c
        JOIN category_shares cs ON cs.category_id = c.id
        WHERE cs.child_id = ${childId} AND cs.status = 'active' AND c.child_id IS NULL
        UNION ALL
        SELECT c.id FROM categories c
        JOIN shared_tree t ON c.parent_id = t.id
        WHERE c.child_id IS NULL
      )
      SELECT id, label, image_key, sound_key, section
      FROM items
      WHERE image_key IS NOT NULL AND (
        child_id = ${childId} OR (child_id IS NULL AND category_id IN (SELECT id FROM shared_tree))
      )`;
    }
    // Index labels + expanded match variants (loves/loving/loved → love).
    // Exact labels always win; variants fill the gaps. Same engine that
    // /api/sync ships to the device tokenizers — see _lib/word-match.js.
    const { expandMatchTerms, buildMatchIndex } = await import('./_lib/word-match.js');
    const byLabel = buildMatchIndex(
      items.map((it) => ({ ...it, matchTerms: expandMatchTerms(it.label, it.match_terms || []) })),
      { normalize: normalizeWord });

    const words = splitWords(text);
    const tokens = [];
    let i = 0;
    while (i < words.length && tokens.length < MAX_TOKENS) {
      let matched = null, consumed = 0;
      const maxWindow = Math.min(MAX_WINDOW, words.length - i);
      for (let w = maxWindow; w >= 1; w--) {
        const phrase = normalizeWord(words.slice(i, i + w).join(' '));
        const hit = byLabel.get(phrase);
        if (hit) { matched = hit; consumed = w; break; }
      }
      if (matched) {
        tokens.push({
          word: words.slice(i, i + consumed).join(' '),
          itemId: Number(matched.id),
          imageKey: matched.image_key,
          soundKey: matched.sound_key || null,
          section: matched.section || null,
          holdMs: SPEAK_MS_DEFAULT,
        });
        i += consumed;
      } else {
        tokens.push({ word: words[i], text: true, holdMs: SPEAK_MS_DEFAULT });
        i += 1;
      }
    }

    // Publish to the live channel so the iPad's startLiveListener picks it up.
    // We increment cmd_seq the same way /api/live POST kind=cmd does, so the
    // iPad's "ignore commands older than launch" baseline still works.
    const payload = { action: 'message', text, tokens };
    await db`
      INSERT INTO live_sessions (child_id, status, payload, cmd, cmd_seq, updated_at)
      VALUES (${childId}, 'idle', NULL, ${payload}::jsonb, 1, NOW())
      ON CONFLICT (child_id) DO UPDATE
        SET cmd = ${payload}::jsonb, cmd_seq = live_sessions.cmd_seq + 1, updated_at = NOW()`;
    // Stamp the cmd with its seq so the iPad's seq baseline check passes.
    await db`UPDATE live_sessions SET cmd = jsonb_set(cmd, '{seq}', to_jsonb(cmd_seq)) WHERE child_id = ${childId}`;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, tokens, matched: tokens.filter(t => t.itemId).length, total: tokens.length });
  } catch (err) {
    res.status(500).json({ error: 'Message send failed', detail: String(err.message || err) });
  }
}

// POST /api/admin/lab?action=index-objects   (admin only; dispatched from lab.js)
//
// Backfill taxonomy.objects_present — the curated reverse index behind the
// "you added a fork; these pictures mention a fork" magic. Rows authored with
// the prompt-author skill already carry it; this fills everything else (the
// CSV-seeded library shipped with it NULL).
//
// Extraction: a cheap OpenAI text pass per prompt pulls the CONCRETE objects
// (fork, ball, swing…) as lowercase singular nouns — people/roles, colors,
// style words, and filler can't get in, which is what makes downstream matching
// stopword-proof. Falls back to a mechanical stopword-filtered split when no
// OPENAI_API_KEY is configured.
//
// Chunked/resumable: ?offset= like the other admin sweeps; ?force=1 re-indexes
// rows that already have values. Response { ok, done, nextOffset, total, indexed, failed }.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { mapPool } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 300 };

const BUDGET = 40;

const STOPWORDS = new Set(('a an the and or of to in on at with for from by is are be as it its this that ' +
  'one two very single style child children kid kids young friendly simple clear bright warm soft gentle ' +
  'plain small large big little cute happy background frame image picture illustration icon emphasizing ' +
  'clean bold colorful no not do dont').split(' '));

function mechanicalExtract(prompt) {
  const words = String(prompt || '').toLowerCase()
    .replace(/\{[a-z_]+\}/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 20);
}

async function aiExtract(apiKey, label, prompt) {
  const body = {
    model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
    messages: [{
      role: 'user',
      content: 'From this image-generation prompt for the AAC tile "' + label + '", list the CONCRETE physical ' +
        'objects that appear in the scene (things a photo could contain: fork, ball, swing, cup). ' +
        'Rules: lowercase singular nouns; exclude people, body parts of the main subject, colors, art-style terms, ' +
        'backgrounds, and abstract words; exclude the tile word itself only if it is a person. ' +
        'Reply with ONLY a JSON array of strings, e.g. ["fork","plate"].\n\nPROMPT:\n' + String(prompt || '').slice(0, 1200),
    }],
  };
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('openai ' + r.status + ': ' + (await r.text()).slice(0, 120));
  const d = await r.json();
  const txt = String(d.choices?.[0]?.message?.content || '[]');
  const m = txt.match(/\[[\s\S]*\]/);
  const arr = JSON.parse(m ? m[0] : '[]');
  return [...new Set(arr.map((s) => String(s).toLowerCase().trim()).filter((s) => s && s.length < 40))].slice(0, 20);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const force = String((req.query && req.query.force) || '') === '1';
  const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);
  const apiKey = process.env.OPENAI_API_KEY || null;

  try {
    const db = sql();
    // "Unindexed" = NULL **or empty array** — bulk imports write [] for rows
    // whose CSV carried no objects, and [] is NOT NULL, so a NULL-only filter
    // would skip them and report "Indexed 0" over an effectively empty index.
    const rows = force
      ? await db`SELECT id, label, prompt_template FROM taxonomy
                 WHERE COALESCE(archived, FALSE) = FALSE ORDER BY id`
      : await db`SELECT id, label, prompt_template FROM taxonomy
                 WHERE COALESCE(archived, FALSE) = FALSE
                   AND (objects_present IS NULL OR cardinality(objects_present) = 0)
                 ORDER BY id`;
    const total = rows.length;
    // State of the index, so "0 to do" is self-explaining in the admin alert.
    const stats = (await db`
      SELECT COUNT(*) FILTER (WHERE objects_present IS NOT NULL AND cardinality(objects_present) > 0)::int AS populated,
             COUNT(*) FILTER (WHERE objects_present IS NULL OR cardinality(objects_present) = 0)::int AS empty
      FROM taxonomy WHERE COALESCE(archived, FALSE) = FALSE`)[0];
    const slice = rows.slice(offset, offset + BUDGET);

    const results = await mapPool(slice, 6, async (t) => {
      const objs = apiKey ? await aiExtract(apiKey, t.label, t.prompt_template)
                          : mechanicalExtract(t.prompt_template);
      await db`UPDATE taxonomy SET objects_present = ${objs}, updated_at = NOW() WHERE id = ${t.id}`;
      return objs.length;
    });
    let indexed = 0, failed = 0;
    for (const r of results) { if (r && r.ok) indexed++; else failed++; }
    const nextOffset = offset + slice.length;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true, done: nextOffset >= total, nextOffset, total, indexed, failed,
      method: apiKey ? 'ai' : 'mechanical',
      populated: stats.populated, empty: stats.empty,
    });
  } catch (err) {
    res.status(500).json({ error: 'index-objects failed', detail: String(err.message || err) });
  }
}

// /api/admin/taxonomy-prompt-versions — prompt history + recovery for one tile.
//
//   GET  ?id=<taxonomyId>            → every prior prompt we can find for the tile:
//                                       the current value, the fine-grained version
//                                       log (taxonomy_prompt_versions), AND the
//                                       value in each full-taxonomy snapshot — so
//                                       prompts overwritten before version-logging
//                                       existed (e.g. a bad bulk import) are still
//                                       recoverable. Newest first, de-duplicated.
//   POST ?id=<taxonomyId>&action=restore  body { prompt }
//                                       → set the tile's prompt to `prompt`, after
//                                         saving the current one as a version.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { savePromptVersion } from '../_lib/prompt-versions.js';

const ACTOR = 'admin';

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  try {
    const db = sql();
    if (req.method === 'GET')  return await list(req, res, db);
    if (req.method === 'POST') return await restore(req, res, db);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

async function list(req, res, db) {
  const id = String(req.query.id || '').trim();
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const cur = await db`SELECT prompt_template, updated_at FROM taxonomy WHERE id = ${id}`;
  if (!cur.length) { res.status(404).json({ error: 'tile not found', id }); return; }

  // Fine-grained version log (newest first).
  const versions = await db`
    SELECT prompt_template, saved_at, saved_by, source
    FROM taxonomy_prompt_versions WHERE taxonomy_id = ${id}
    ORDER BY saved_at DESC`;

  // The tile's prompt in each full snapshot — extracted server-side so we never
  // ship whole payloads. This is what recovers pre-version-log overwrites.
  const snaps = await db`
    SELECT s.created_at AS at, s.label, (elem->>'prompt_template') AS prompt
    FROM taxonomy_snapshots s, jsonb_array_elements(s.payload) elem
    WHERE elem->>'id' = ${id}
    ORDER BY s.created_at DESC`;

  // Merge all sources newest→oldest, collapsing runs of an identical prompt.
  const merged = [
    { prompt: cur[0].prompt_template, at: cur[0].updated_at, source: 'current' },
    ...versions.map(v => ({ prompt: v.prompt_template, at: v.saved_at, source: v.source || 'edit' })),
    ...snaps.map(s => ({ prompt: s.prompt, at: s.at, source: `snapshot${s.label ? ' · ' + s.label : ''}` })),
  ].filter(x => x.prompt != null);
  merged.sort((a, b) => new Date(b.at) - new Date(a.at));
  const out = [];
  for (const m of merged) {
    if (out.length && out[out.length - 1].prompt === m.prompt) continue;  // collapse identical neighbors
    out.push(m);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ id, current: cur[0].prompt_template, history: out });
}

async function restore(req, res, db) {
  const id = String(req.query.id || '').trim();
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const b = (typeof req.body === 'object' && req.body) || {};
  const prompt = typeof b.prompt === 'string' ? b.prompt : '';
  if (!prompt.trim()) { res.status(400).json({ error: 'prompt required' }); return; }

  const cur = await db`SELECT prompt_template FROM taxonomy WHERE id = ${id}`;
  if (!cur.length) { res.status(404).json({ error: 'tile not found', id }); return; }
  if (cur[0].prompt_template === prompt) { res.status(200).json({ ok: true, unchanged: true }); return; }

  await savePromptVersion(db, id, cur[0].prompt_template, { by: ACTOR, source: 'pre-restore' });
  const rows = await db`
    UPDATE taxonomy SET prompt_template = ${prompt}, updated_at = NOW(), updated_by = ${ACTOR}
    WHERE id = ${id} RETURNING id, prompt_template`;
  res.status(200).json({ ok: true, id: rows[0].id, promptTemplate: rows[0].prompt_template });
}

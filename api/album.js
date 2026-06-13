// GET /api/album?childId=<slug>&mode=timeline|by-tile&limit=200
// Memorabilia view: every picture a child's board has ever had, including the
// previous versions of regenerated tiles (item_image_history) plus the CURRENT
// image on each tile so the album is complete in one query.
//
// Two views (collapsed into one response shape):
//   timeline → flat list, newest first, mixed across tiles
//   by-tile  → grouped by item (label + section), each with current + history
//              sorted newest first
//
// Auth-gated by canAccessChild. Read-only.
import { checkAuth } from './_lib/auth.js';
import { canAccessChild } from './_lib/access.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || '').slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }

  const mode = req.query.mode === 'by-tile' ? 'by-tile' : 'timeline';
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));

  try {
    const db = sql();
    // Each entry: { itemId, label, section, blobKey, when, kind: 'current' | 'history', source, prompt, model }
    const current = await db`
      SELECT id AS item_id, label, section, image_key, updated_at
      FROM items
      WHERE child_id = ${childId} AND image_key IS NOT NULL
      ORDER BY updated_at DESC`;
    const history = await db`
      SELECT item_id, item_label AS label, section, blob_key, archived_at, source, prompt, model
      FROM item_image_history
      WHERE child_id = ${childId}
      ORDER BY archived_at DESC
      LIMIT ${limit}`;

    const entries = [
      ...current.map(r => ({
        itemId: r.item_id ? Number(r.item_id) : null,
        label: r.label || '',
        section: r.section || null,
        blobKey: r.image_key,
        when: r.updated_at,
        kind: 'current',
        source: null, prompt: null, model: null,
      })),
      ...history.map(r => ({
        itemId: r.item_id ? Number(r.item_id) : null,
        label: r.label || '',
        section: r.section || null,
        blobKey: r.blob_key,
        when: r.archived_at,
        kind: 'history',
        source: r.source || null, prompt: r.prompt || null, model: r.model || null,
      })),
    ].sort((a, b) => new Date(b.when) - new Date(a.when));

    res.setHeader('Cache-Control', 'no-store');
    if (mode === 'timeline') {
      res.status(200).json({ mode, entries: entries.slice(0, limit) });
      return;
    }

    // by-tile: group by (itemId || lower(label)) so history of a deleted tile
    // still groups with its surviving siblings if they share a label.
    const groups = new Map();
    for (const e of entries) {
      const key = e.itemId != null ? `i:${e.itemId}` : `l:${(e.label || '').toLowerCase()}`;
      let g = groups.get(key);
      if (!g) { g = { key, itemId: e.itemId, label: e.label, section: e.section, current: null, history: [] }; groups.set(key, g); }
      if (e.kind === 'current' && !g.current) g.current = e;
      else g.history.push(e);
    }
    res.status(200).json({
      mode,
      tiles: [...groups.values()]
        .sort((a, b) => {
          const aw = (a.current || a.history[0] || {}).when || 0;
          const bw = (b.current || b.history[0] || {}).when || 0;
          return new Date(bw) - new Date(aw);
        }),
    });
  } catch (err) {
    res.status(500).json({ error: 'Album fetch failed', detail: String(err.message || err) });
  }
}

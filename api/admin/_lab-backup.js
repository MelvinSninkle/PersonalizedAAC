// /api/admin/lab?action=backup  (admin only)
//
// In-app data-safety tooling, complementing the nightly pg_dump workflow
// (.github/workflows/backup.yml):
//
//   GET  ?op=inventory        → blob-key census: every key referenced by the
//                               database (union of the 15 key-bearing
//                               columns) reconciled against what Vercel Blob
//                               actually stores — missing keys (DB points at
//                               nothing) and a stored-total, so drift is
//                               visible before it becomes data loss.
//   GET  ?op=export&table=X&after=N → one table as NDJSON, paginated by id
//                               (LIMIT 5000). Loop until short page for a
//                               logical export that needs no pg_dump access.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { list } from '@vercel/blob';

export const config = { maxDuration: 300 };

// Whitelist — export serves ONLY known tables, never raw identifiers.
const TABLES = [
  'categories', 'items', 'category_shares', 'events', 'users', 'child_access',
  'sessions', 'game_attempts', 'skill_insights', 'image_generations',
  'item_image_history', 'reference_images', 'pending_tiles', 'taxonomy',
  'category_defaults', 'style_guides', 'tile_generations', 'invite_codes',
  'child_settings', 'push_tokens', 'persons', 'taxonomy_style_defaults',
  'category_style_defaults', 'style_demo_children', 'default_category_order', 'milestones',
  'role_grants', 'label_translations', 'board_pings', 'board_catalog',
  'voices', 'onboarding_progress', 'seed_jobs', 'tile_jobs',
];

const KEY_COLUMNS = [
  ['items', 'image_key'], ['items', 'sound_key'],
  ['categories', 'image_key'],
  ['persons', 'reference_key'], ['persons', 'voice_key'],
  ['reference_images', 'blob_key'],
  ['pending_tiles', 'source_key'], ['pending_tiles', 'image_key'], ['pending_tiles', 'sound_key'],
  ['item_image_history', 'blob_key'],
  ['taxonomy', 'default_image_key'],
  ['category_defaults', 'image_key'],
  ['style_guides', 'blob_key'], ['style_guides', 'preview_blob_key'],
  ['style_guides', 'person_ref_key'], ['style_guides', 'stuff_ref_key'],
  ['tile_generations', 'blob_key'],
  ['taxonomy_style_defaults', 'image_key'],
  ['category_style_defaults', 'image_key'],
  ['style_demo_children', 'person_ref_key'],
];

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const db = sql();
  const q = typeof db.query === 'function' ? db.query.bind(db) : (t, p) => db(t, p);
  const op = String(req.query.op || 'inventory');

  try {
    if (op === 'inventory') {
      // Every blob key the database references…
      const referenced = new Set();
      for (const [table, col] of KEY_COLUMNS) {
        try {
          const rows = await q(
            `SELECT DISTINCT ${col} AS k FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`);
          for (const r of rows) referenced.add(r.k);
        } catch (_) { /* pre-migration table/column — skip */ }
      }
      // …against what blob storage actually holds.
      const stored = new Set();
      let cursor;
      do {
        const page = await list({ cursor, limit: 1000 });
        for (const b of page.blobs) stored.add(b.pathname);
        cursor = page.hasMore ? page.cursor : null;
      } while (cursor);
      const missing = [...referenced].filter((k) => !stored.has(k));
      res.status(200).json({
        ok: true,
        referencedKeys: referenced.size,
        storedBlobs: stored.size,
        missing: missing.slice(0, 200),
        missingCount: missing.length,
        note: 'missing = DB points at a blob that does not exist (data loss / bad key). ' +
              'Stored-but-unreferenced blobs are usually shared caches (tts/) and history — not a problem.',
      });
      return;
    }

    if (op === 'export') {
      const table = String(req.query.table || '');
      if (!TABLES.includes(table)) {
        res.status(400).json({ error: 'unknown table', tables: TABLES });
        return;
      }
      const after = Number(req.query.after || 0) || 0;
      let rows;
      try {
        rows = await q(
          `SELECT * FROM ${table} WHERE id > $1 ORDER BY id LIMIT 5000`, [after]);
      } catch (_) {
        // Tables without a numeric id (composite PKs): single unpaginated page.
        rows = await q(`SELECT * FROM ${table} LIMIT 20000`);
      }
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${table}${after ? '-after-' + after : ''}.ndjson"`);
      res.status(200).send(rows.map((r) => JSON.stringify(r)).join('\n'));
      return;
    }

    res.status(400).json({ error: 'unknown op (inventory | export)' });
  } catch (err) {
    res.status(500).json({ error: 'backup failed', detail: String(err.message || err) });
  }
}

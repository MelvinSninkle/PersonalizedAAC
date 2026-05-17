// /api/admin/taxonomy-snapshots — list / create / restore / delete snapshots
// of the entire taxonomy. Snapshots are point-in-time copies stored as JSONB.
//   GET                              → list (no payload, keeps response light)
//   GET   ?id=N&full=1               → fetch one with payload
//   POST  { label, note }            → create a snapshot of the current state
//   POST  ?id=N&action=restore       → restore (auto-creates a pre-restore snapshot)
//   DELETE ?id=N                     → delete (immutable to edit, deletable)
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

const ACTOR = 'admin';

function snapshotOut(r, includePayload) {
  const out = {
    id: Number(r.id),
    createdAt: r.created_at,
    createdBy: r.created_by,
    label: r.label,
    note: r.note,
    rowCount: r.row_count,
  };
  if (includePayload) out.payload = r.payload;
  return out;
}

export default async function handler(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  try {
    const db = sql();
    if (req.method === 'GET')    return await read(req, res, db);
    if (req.method === 'POST')   return await write(req, res, db);
    if (req.method === 'DELETE') return await remove(req, res, db);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

async function read(req, res, db) {
  const id = req.query.id ? parseInt(req.query.id, 10) : null;
  if (id) {
    const rows = await db`SELECT * FROM taxonomy_snapshots WHERE id = ${id}`;
    if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    res.status(200).json(snapshotOut(rows[0], !!req.query.full));
    return;
  }
  const rows = await db`
    SELECT id, created_at, created_by, label, note, row_count
    FROM taxonomy_snapshots
    ORDER BY created_at DESC
    LIMIT 200
  `;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ snapshots: rows.map(r => snapshotOut(r, false)) });
}

async function write(req, res, db) {
  // POST?action=restore&id=N → replace taxonomy with the snapshot's contents.
  if (req.query.action === 'restore') {
    const id = parseInt(req.query.id, 10);
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    const snaps = await db`SELECT * FROM taxonomy_snapshots WHERE id = ${id}`;
    if (!snaps.length) { res.status(404).json({ error: 'Not found' }); return; }
    const snap = snaps[0];
    const payload = Array.isArray(snap.payload) ? snap.payload : [];

    // First take a "pre-restore" snapshot so restore itself is reversible.
    const cur = await db`SELECT * FROM taxonomy ORDER BY id`;
    const preLabel = `pre-restore-from-#${id}-${new Date().toISOString()}`;
    await db`
      INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
      VALUES (${ACTOR}, ${preLabel}, ${'Auto-snapshot before restoring #' + id}, ${cur.length}, ${JSON.stringify(cur)}::jsonb)
    `;

    // Now wipe and reinsert from the snapshot. Not wrapped in a SQL transaction
    // because the Neon serverless API issues each statement separately; if a
    // partial state is left behind, the pre-restore snapshot above is the
    // recovery path.
    await db`DELETE FROM taxonomy`;
    for (const r of payload) {
      await db`
        INSERT INTO taxonomy (
          id, column_name, category, subcategory, label, pronunciation,
          prompt_template, subject_mode, parent_photo_behavior, phase, notes,
          status, archived, created_at, created_by, updated_at, updated_by, published_at
        ) VALUES (
          ${r.id}, ${r.column_name}, ${r.category ?? null}, ${r.subcategory ?? null},
          ${r.label}, ${r.pronunciation ?? null},
          ${r.prompt_template}, ${r.subject_mode}, ${r.parent_photo_behavior},
          ${r.phase ?? 'v1_core'}, ${r.notes ?? null},
          ${r.status ?? 'draft'}, ${!!r.archived},
          ${r.created_at ?? new Date().toISOString()}, ${r.created_by ?? ACTOR},
          ${r.updated_at ?? new Date().toISOString()}, ${r.updated_by ?? ACTOR},
          ${r.published_at ?? null}
        )
      `;
    }
    await db`
      INSERT INTO taxonomy_audit (actor, action, summary, note)
      VALUES (${ACTOR}, 'restore', ${`restored snapshot #${id} (${payload.length} rows)`}, ${snap.label})
    `;
    res.status(200).json({ ok: true, restored: payload.length, preRestoreSnapshot: preLabel });
    return;
  }

  // POST → create a snapshot of the current state.
  const body = (typeof req.body === 'object' && req.body) || {};
  const label = (typeof body.label === 'string' && body.label.trim() ? body.label : 'manual-' + new Date().toISOString()).slice(0, 200);
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null;

  const cur = await db`SELECT * FROM taxonomy ORDER BY id`;
  const inserted = await db`
    INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
    VALUES (${ACTOR}, ${label}, ${note}, ${cur.length}, ${JSON.stringify(cur)}::jsonb)
    RETURNING id, created_at, created_by, label, note, row_count
  `;
  await db`
    INSERT INTO taxonomy_audit (actor, action, summary, note)
    VALUES (${ACTOR}, 'snapshot', ${`created snapshot "${label}" (${cur.length} rows)`}, ${note})
  `;
  res.status(200).json(snapshotOut(inserted[0], false));
}

async function remove(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const rows = await db`DELETE FROM taxonomy_snapshots WHERE id = ${id} RETURNING id, label`;
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  await db`
    INSERT INTO taxonomy_audit (actor, action, summary)
    VALUES (${ACTOR}, 'snapshot-delete', ${`deleted snapshot #${id} "${rows[0].label || ''}"`})
  `;
  res.status(200).json({ ok: true });
}

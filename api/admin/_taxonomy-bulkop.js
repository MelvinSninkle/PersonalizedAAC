// POST /api/admin/taxonomy-bulkop — apply one change across many selected rows.
// Body: { ids: [...], action: 'set-status'|'set-phase'|'set-archived'|'delete', value?: any }
// Returns: { ok, affected, snapshotLabel? }
//
// Per Section 17.9 of the PRD, any bulk op affecting more than 50 rows auto-
// snapshots first so the operation is reversible.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

const ACTOR = 'admin';
const AUTO_SNAPSHOT_THRESHOLD = 50;
const VALID_STATUS = new Set(['draft', 'published']);
const VALID_PHASES = new Set(['v1_core', 'v1_extended', 'v2', 'later']);
const VALID_GROWTH_STAGES = new Set(['stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5plus']);
const VALID_ACQUISITION_AGES = new Set(['12-18m', '18-30m', '2-3y', '3-4y', '4y+']);
const VALID_ACTIONS = new Set(['set-status', 'set-phase', 'set-archived', 'set-core', 'set-growth-stage', 'set-acquisition-age', 'delete']);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }

  const body = (typeof req.body === 'object' && req.body) || {};
  const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string' && x).slice(0, 5000) : null;
  const action = body.action;
  if (!ids || !ids.length) { res.status(400).json({ error: 'ids[] required' }); return; }
  if (!VALID_ACTIONS.has(action)) { res.status(400).json({ error: 'invalid action' }); return; }

  // Validate value per action.
  let value = body.value;
  if (action === 'set-status' && !VALID_STATUS.has(value))
    { res.status(400).json({ error: `value must be one of ${[...VALID_STATUS].join(',')}` }); return; }
  if (action === 'set-phase' && !VALID_PHASES.has(value))
    { res.status(400).json({ error: `value must be one of ${[...VALID_PHASES].join(',')}` }); return; }
  if (action === 'set-acquisition-age' && value !== null && !VALID_ACQUISITION_AGES.has(value))
    return res.status(400).json({ error: 'invalid acquisition_age', allowed: [...VALID_ACQUISITION_AGES] });
  if (action === 'set-growth-stage' && value !== null && !VALID_GROWTH_STAGES.has(value))
    { res.status(400).json({ error: `value must be one of ${[...VALID_GROWTH_STAGES].join(',')} or null` }); return; }
  if (action === 'set-archived') value = !!value;
  if (action === 'set-core') value = !!value;

  try {
    const db = sql();
    let snapshotLabel = null;

    // Auto-snapshot before any large bulk op.
    if (ids.length > AUTO_SNAPSHOT_THRESHOLD) {
      const cur = await db`SELECT * FROM taxonomy ORDER BY id`;
      snapshotLabel = `pre-bulkop-${action}-${new Date().toISOString()}`;
      await db`
        INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
        VALUES (${ACTOR}, ${snapshotLabel}, ${`Auto-snapshot before bulk ${action} on ${ids.length} rows`}, ${cur.length}, ${JSON.stringify(cur)}::jsonb)
      `;
    }

    let affected = 0;
    if (action === 'delete') {
      const rows = await db`DELETE FROM taxonomy WHERE id = ANY(${ids}) RETURNING id`;
      affected = rows.length;
    } else if (action === 'set-status') {
      const willPublish = value === 'published';
      const rows = await db`
        UPDATE taxonomy
        SET status = ${value},
            updated_at = NOW(),
            updated_by = ${ACTOR},
            published_at = ${willPublish ? new Date().toISOString() : null}
        WHERE id = ANY(${ids})
        RETURNING id
      `;
      affected = rows.length;
    } else if (action === 'set-phase') {
      const rows = await db`
        UPDATE taxonomy
        SET phase = ${value}, updated_at = NOW(), updated_by = ${ACTOR}
        WHERE id = ANY(${ids})
        RETURNING id
      `;
      affected = rows.length;
    } else if (action === 'set-archived') {
      const rows = await db`
        UPDATE taxonomy
        SET archived = ${value}, updated_at = NOW(), updated_by = ${ACTOR}
        WHERE id = ANY(${ids})
        RETURNING id
      `;
      affected = rows.length;
    } else if (action === 'set-core') {
      const rows = await db`
        UPDATE taxonomy
        SET core = ${value}, updated_at = NOW(), updated_by = ${ACTOR}
        WHERE id = ANY(${ids})
        RETURNING id
      `;
      affected = rows.length;
    } else if (action === 'set-growth-stage') {
      const rows = await db`
        UPDATE taxonomy
        SET growth_stage = ${value || null}, updated_at = NOW(), updated_by = ${ACTOR}
        WHERE id = ANY(${ids})
        RETURNING id
      `;
      affected = rows.length;
    } else if (action === 'set-acquisition-age') {
      const rows = await db`
        UPDATE taxonomy
        SET acquisition_age = ${value || null}, updated_at = NOW(), updated_by = ${ACTOR}
        WHERE id = ANY(${ids})
        RETURNING id
      `;
      affected = rows.length;
    }

    const summary = `bulk ${action}${value !== undefined ? '=' + value : ''}: ${affected} of ${ids.length}`;
    await db`
      INSERT INTO taxonomy_audit (actor, action, row_ids, summary, note)
      VALUES (${ACTOR}, ${'bulk-' + action}, ${ids}, ${summary}, ${snapshotLabel})
    `;

    res.status(200).json({ ok: true, affected, snapshotLabel });
  } catch (err) {
    res.status(500).json({ error: 'Bulk op failed', detail: String(err.message || err) });
  }
}

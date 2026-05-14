// POST /api/events — body { events: [{ role, itemId, section, label, clientId, occurredAt }, ...] }
// Bulk-inserts client-queued taps. Auth-gated (same admin token as everything else).
// No FK to items so deletes don't lose history.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

const MAX_BATCH = 1000;
const VALID_ROLES = new Set(['student', 'teacher', 'parent']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
  const raw = Array.isArray(body.events) ? body.events : null;
  if (!raw) {
    res.status(400).json({ error: 'events array required' });
    return;
  }
  if (raw.length > MAX_BATCH) {
    res.status(413).json({ error: `Too many events; max ${MAX_BATCH} per request` });
    return;
  }

  const rows = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const role = typeof e.role === 'string' && VALID_ROLES.has(e.role) ? e.role : null;
    if (!role) continue;
    const occurredAt = typeof e.occurredAt === 'string' && !isNaN(Date.parse(e.occurredAt)) ? e.occurredAt : null;
    if (!occurredAt) continue;
    rows.push({
      role,
      itemId: Number.isFinite(e.itemId) ? Math.trunc(e.itemId) : null,
      section: typeof e.section === 'string' ? e.section.slice(0, 32) : null,
      label: typeof e.label === 'string' ? e.label.slice(0, 200) : null,
      categoryName: typeof e.categoryName === 'string' ? e.categoryName.slice(0, 200) : null,
      subcategoryName: typeof e.subcategoryName === 'string' ? e.subcategoryName.slice(0, 200) : null,
      clientId: typeof e.clientId === 'string' ? e.clientId.slice(0, 64) : null,
      occurredAt,
    });
  }
  if (rows.length === 0) {
    res.status(200).json({ ok: true, count: 0 });
    return;
  }

  try {
    const db = sql();
    // Sequential INSERTs keep this simple; bulk volume is tiny (a few taps/sec at most).
    for (const r of rows) {
      await db`
        INSERT INTO events (role, item_id, section, label, category_name, subcategory_name, client_id, occurred_at)
        VALUES (${r.role}, ${r.itemId}, ${r.section}, ${r.label}, ${r.categoryName}, ${r.subcategoryName}, ${r.clientId}, ${r.occurredAt})
      `;
    }
    res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Insert failed', detail: String(err.message || err) });
  }
}

// POST /api/events — body { events: [{ role, itemId, section, label, clientId, occurredAt }, ...] }
// Bulk-inserts client-queued taps. Auth-gated (same admin token as everything else).
// No FK to items so deletes don't lose history.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';

const MAX_BATCH = 1000;
const VALID_ROLES = new Set(['student', 'teacher', 'parent']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
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
      childId: (typeof e.childId === 'string' && e.childId) ? e.childId.slice(0, 64)
             : (typeof body.childId === 'string' && body.childId) ? body.childId.slice(0, 64)
             : null,
      occurredAt,
    });
    // No fallback child — an event with no child attribution can't be
    // access-checked or usefully stored, so it's dropped, never defaulted
    // onto a real family's analytics.
    if (!rows[rows.length - 1].childId) rows.pop();
  }
  if (rows.length === 0) {
    res.status(200).json({ ok: true, count: 0 });
    return;
  }

  try {
    const db = sql();
    for (const cid of new Set(rows.map(r => r.childId))) {
      if (!(await canAccessChild(auth.user, cid, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    }
    // Sequential INSERTs keep this simple; bulk volume is tiny (a few taps/sec at most).
    for (const r of rows) {
      await db`
        INSERT INTO events (role, item_id, section, label, category_name, subcategory_name, client_id, child_id, occurred_at)
        VALUES (${r.role}, ${r.itemId}, ${r.section}, ${r.label}, ${r.categoryName}, ${r.subcategoryName}, ${r.clientId}, ${r.childId}, ${r.occurredAt})
      `;
    }
    // Milestone detection rides the ingestion (fire-and-forget — a detector
    // hiccup must never fail a tap). Student taps only, grouped per child.
    try {
      const { detectMilestones } = await import('./_lib/milestones.js');
      const byChild = new Map();
      for (const r of rows) {
        if (r.role !== 'student' || !r.label) continue;
        if (!byChild.has(r.childId)) byChild.set(r.childId, []);
        byChild.get(r.childId).push({ label: r.label, section: r.section, categoryName: r.categoryName, occurredAt: r.occurredAt });
      }
      for (const [cid, taps] of byChild) {
        detectMilestones(db, cid, taps).catch(() => {});
      }
    } catch (_) { /* detection is best-effort */ }
    res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Insert failed', detail: String(err.message || err) });
  }
}

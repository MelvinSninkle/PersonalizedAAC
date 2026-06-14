// GET /api/word-history?childId=&q=&since=&until=&limit=
// Searchable tap log: every word the child has tapped, with timestamps.
// Backs the parent app's Word History view (PRD §4.5 — "history goes back to
// the beginning of the account").
//
// Query params:
//   childId   required
//   q         case-insensitive label substring (server-side LIKE) — optional
//   since     ISO date, default 30 days ago
//   until     ISO date, default now
//   limit     1..500, default 200
//   offset    skip N rows for paging — default 0
//
// Returns { rows: [{ id, label, category, section, when }], hasMore, total }.
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

  const q = String((req.query && req.query.q) || '').slice(0, 80).trim();
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  // Defaults: 30-day window. Parse forgivingly.
  const since = parseDate(req.query.since) || new Date(Date.now() - 30 * 86400_000);
  const until = parseDate(req.query.until) || new Date();
  const pattern = q ? `%${q.toLowerCase()}%` : null;

  try {
    const db = sql();
    // Only the child's own taps (role='student'). NULL labels are dropped — a
    // tap without a label is a UI rendering of the persistent strip or similar
    // and isn't useful in this view.
    const rows = await db`
      SELECT id, label, category_name AS category, section, occurred_at
      FROM events
      WHERE child_id = ${childId}
        AND role = 'student'
        AND label IS NOT NULL
        AND occurred_at >= ${since.toISOString()}
        AND occurred_at <  ${until.toISOString()}
        AND (${pattern}::text IS NULL OR lower(label) LIKE ${pattern})
      ORDER BY occurred_at DESC
      LIMIT ${limit + 1} OFFSET ${offset}`;
    const hasMore = rows.length > limit;
    const out = rows.slice(0, limit).map(r => ({
      id: Number(r.id),
      label: r.label,
      category: r.category || null,
      section: r.section || null,
      when: r.occurred_at,
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ rows: out, hasMore });
  } catch (err) {
    res.status(500).json({ error: 'Word history failed', detail: String(err.message || err) });
  }
}

function parseDate(s) {
  if (!s || typeof s !== 'string') return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// GET /api/top-words?childId=&days=&limit=
// Most-tapped words over the last N days. Backs the parent app's Top Words
// view (PRD §4.5). One row per distinct label, with its count + the category
// it was most commonly tapped under + the first/last tap timestamps.
//
// Query params:
//   childId  required
//   days     1..365, default 30
//   limit    1..200, default 50
//
// Returns { rows: [{ label, count, category, section, firstAt, lastAt }] }.
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

  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

  try {
    const db = sql();
    // Group by lowercase label so 'Mom' and 'mom' aren't double-counted; pick
    // the original-case label by mode (just the first-seen original is fine).
    const rows = await db`
      WITH tapped AS (
        SELECT label, section, category_name, occurred_at
        FROM events
        WHERE child_id = ${childId}
          AND role = 'student'
          AND label IS NOT NULL
          AND occurred_at >= NOW() - (${days} || ' days')::interval
      )
      SELECT lower(label) AS lk,
             min(label) AS label,
             count(*)::int AS n,
             (array_agg(category_name ORDER BY occurred_at DESC) FILTER (WHERE category_name IS NOT NULL))[1] AS category,
             (array_agg(section ORDER BY occurred_at DESC) FILTER (WHERE section IS NOT NULL))[1] AS section,
             min(occurred_at) AS first_at,
             max(occurred_at) AS last_at
      FROM tapped
      GROUP BY lower(label)
      ORDER BY n DESC, last_at DESC
      LIMIT ${limit}`;
    const out = rows.map(r => ({
      label:   r.label,
      count:   Number(r.n),
      category: r.category || null,
      section:  r.section  || null,
      firstAt: r.first_at,
      lastAt:  r.last_at,
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ rows: out, days });
  } catch (err) {
    res.status(500).json({ error: 'Top words failed', detail: String(err.message || err) });
  }
}

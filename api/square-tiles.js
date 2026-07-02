// POST /api/square-tiles?childId= — normalize tile aspect to the board rule:
// every tile is square (keep_aspect=false) EXCEPT those in a TV/movies/shows/
// posters folder, which keep their natural rectangular aspect. One-tap cleanup
// for boards that picked up stray keep_aspect flags. Mirrors the iOS
// `categoryNameIsPoster` rule so the app and web agree. Auth-gated.
import { checkAuth } from './_lib/auth.js';
import { canAccessChild } from './_lib/access.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const db = sql();
  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  // "Poster" folder = name contains movie/show/poster/cinema, or the word TV.
  try {
    // Tiles in a poster folder → rectangular; everything else → square.
    const posters = await db`
      UPDATE items i SET keep_aspect = TRUE, updated_at = NOW()
      FROM categories c
      WHERE i.category_id = c.id AND i.child_id = ${childId}
        AND (c.label ~* '(movie|show|poster|cinema)' OR c.label ~* '(^|[^a-z])tvs?([^a-z]|$)')
      RETURNING i.id`;
    const squared = await db`
      UPDATE items i SET keep_aspect = FALSE, updated_at = NOW()
      WHERE i.child_id = ${childId}
        AND (i.category_id IS NULL OR i.category_id NOT IN (
          SELECT id FROM categories WHERE child_id = ${childId}
            AND (label ~* '(movie|show|poster|cinema)' OR label ~* '(^|[^a-z])tvs?([^a-z]|$)')))
      RETURNING i.id`;
    // Category CHIPS square up too — stray keep_aspect flags on folder icons
    // were the other half of the "some tiles aren't squares" glitch on the
    // prototype board. Poster folders keep their natural ratio.
    const squaredCats = await db`
      UPDATE categories SET keep_aspect = FALSE, updated_at = NOW()
      WHERE child_id = ${childId}
        AND keep_aspect = TRUE
        AND NOT (label ~* '(movie|show|poster|cinema)' OR label ~* '(^|[^a-z])tvs?([^a-z]|$)')
      RETURNING id`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, squared: squared.length, squaredCats: squaredCats.length, posters: posters.length });
  } catch (err) {
    res.status(500).json({ error: 'square-tiles failed', detail: String(err.message || err) });
  }
}

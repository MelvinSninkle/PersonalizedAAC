// GET /api/sync — returns all categories + items so a fresh device can hydrate.
//
// Two sources are merged:
//   1. The child's own categories/items (child_id = X).
//   2. Therapist-owned template categories that have been actively shared with
//      this child (via category_shares), AND every descendant of those template
//      roots, AND every item under any of those template categories.
//
// The kid app doesn't care which is which — it just renders. The owner_user_id
// field carried through to the client lets the parent/therapist UIs gate edits.
import { checkAuth } from './_lib/auth.js';
import { sql, rowToCategory, rowToItem } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';
import { bandForBirthDate, tileFitsAge, higherBand } from './_lib/age-band.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const childId = String((req.query && req.query.childId) || 'fletcher').slice(0, 64);

  try {
    const db = sql();
    if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    // The shared-template subtree, computed once and joined twice.
    //   - seeds: template roots in category_shares for this child (status=active)
    //   - descendants: every category whose parent is in the subtree (child_id IS NULL)
    const cats = await db`
      WITH RECURSIVE shared_tree AS (
        SELECT c.* FROM categories c
        JOIN category_shares cs ON cs.category_id = c.id
        WHERE cs.child_id = ${childId} AND cs.status = 'active' AND c.child_id IS NULL
        UNION ALL
        SELECT c.* FROM categories c
        JOIN shared_tree t ON c.parent_id = t.id
        WHERE c.child_id IS NULL
      )
      SELECT * FROM categories WHERE child_id = ${childId}
      UNION
      SELECT * FROM shared_tree
      ORDER BY display_order, id`;
    const items = await db`
      WITH RECURSIVE shared_tree AS (
        SELECT c.id FROM categories c
        JOIN category_shares cs ON cs.category_id = c.id
        WHERE cs.child_id = ${childId} AND cs.status = 'active' AND c.child_id IS NULL
        UNION ALL
        SELECT c.id FROM categories c
        JOIN shared_tree t ON c.parent_id = t.id
        WHERE c.child_id IS NULL
      )
      SELECT * FROM items WHERE child_id = ${childId}
      UNION
      SELECT i.* FROM items i
      WHERE i.child_id IS NULL AND i.category_id IN (SELECT id FROM shared_tree)
      ORDER BY display_order, id`;
    // Age-band filter: when the child has a birth date AND the parent hasn't
    // turned the filter off ('show all vocabulary'), drop items whose canonical
    // taxonomy row sits above the child's current band. Items without a
    // taxonomy_slug (personal photos, custom additions) are always kept — the
    // family put them there on purpose. Categories are never filtered (the
    // empty section would just be visible scaffolding the parent can fill).
    let outItems = items;
    let appliedBand = null;
    const showAll = String(req.query.showAllVocab || '').trim() === '1';
    if (!showAll) {
      const meRow = (await db`SELECT birth_date, advanced_to_band FROM persons WHERE child_id = ${childId} AND is_self = TRUE LIMIT 1`)[0];
      const natural = meRow && meRow.birth_date ? bandForBirthDate(meRow.birth_date) : null;
      const advanced = meRow ? (meRow.advanced_to_band || null) : null;
      const band = higherBand(natural, advanced);
      if (band) {
        appliedBand = band;
        const slugs = [...new Set(items.map(i => i.taxonomy_slug).filter(Boolean))];
        const bandBySlug = new Map();
        if (slugs.length) {
          const rows = await db`SELECT id, acquisition_age FROM taxonomy WHERE id = ANY(${slugs})`;
          for (const r of rows) bandBySlug.set(r.id, r.acquisition_age || null);
        }
        outItems = items.filter(i => !i.taxonomy_slug || tileFitsAge(bandBySlug.get(i.taxonomy_slug) || null, band));
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      categories: cats.map(rowToCategory),
      items: outItems.map(rowToItem),
      ageFilter: { applied: !!appliedBand, band: appliedBand, hiddenCount: items.length - outItems.length },
    });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed', detail: String(err.message || err) });
  }
}

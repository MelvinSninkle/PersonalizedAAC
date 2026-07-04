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
import { isDefaultableTile } from './_lib/onboarding-render.js';

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
    // Folder-icon read-through: a chip with no custom icon (or one already on
    // a shared default key) shows the shared category_defaults icon for its
    // section + label. Custom icons always win; a chip the parent re-imaged
    // keeps their image. This is what fills the blank chips on boards built
    // before folder icons existed — live, no per-child copy.
    try {
      const needIcon = cats.filter((c) => !c.image_key || String(c.image_key).startsWith('category-defaults/'));
      if (needIcon.length) {
        const defs = await db`SELECT section, label_norm, image_key FROM category_defaults`;
        if (defs.length) {
          const dmap = new Map(defs.map((d) => [d.section + '|' + d.label_norm, d.image_key]));
          for (const c of needIcon) {
            const k = dmap.get(c.section + '|' + String(c.label || '').trim().toLowerCase());
            if (k) c.image_key = k;
          }
        }
      }
    } catch (_) { /* defaults table may not exist yet — chips just stay plain */ }

    // Resolve the canonical taxonomy row for every linked item once — used both
    // for the age-band filter below AND to read default-able tiles' art straight
    // from the "generic board" (taxonomy.default_image_key).
    const slugs = [...new Set(items.map(i => i.taxonomy_slug).filter(Boolean))];
    const taxBySlug = new Map();
    if (slugs.length) {
      const rows = await db`SELECT id, acquisition_age, default_image_key, column_name, subject_mode, prompt_template, descriptive_clues
                            FROM taxonomy WHERE id = ANY(${slugs})`;
      for (const r of rows) taxBySlug.set(r.id, r);
    }

    // Teaching clues ride along on each linked tile (taxonomy.descriptive_clues)
    // so the boards' "Teach me" slideshow can speak the word + all its clues
    // without a second fetch.
    for (const i of items) {
      const tax = i.taxonomy_slug ? taxBySlug.get(i.taxonomy_slug) : null;
      if (tax && Array.isArray(tax.descriptive_clues) && tax.descriptive_clues.length) {
        i.descriptive_clues = tax.descriptive_clues;
      }
    }

    // Read-through defaults: a default-able tile (one that never references a
    // specific person) shows the ONE shared generic image. We swap it in at read
    // time, so a single edit on the generic board (Lab "Set as default" /
    // seed-defaults) updates every child's board on the next sync — no per-child
    // copy or "apply". PRECEDENCE: a child's OWN image wins — the default only
    // fills tiles that have no image yet or are already pointing at a (possibly
    // stale) shared default key. That way per-child personalization (child-as-
    // subject renders, parent photo swaps) is never clobbered by the generic art.
    for (const i of items) {
      const tax = i.taxonomy_slug ? taxBySlug.get(i.taxonomy_slug) : null;
      if (!tax || !tax.default_image_key || !isDefaultableTile(tax)) continue;
      const cur = i.image_key || '';
      if (!cur || cur.startsWith('taxonomy-defaults/')) i.image_key = tax.default_image_key;
    }

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
        outItems = items.filter(i => !i.taxonomy_slug || tileFitsAge(taxBySlug.get(i.taxonomy_slug)?.acquisition_age || null, band));
      }
    }

    // Membership flags for the boards (web + native): what this FAMILY's tier
    // can do, so the UIs can show a friendly join-a-membership popup at the
    // gate instead of a mysterious server error. Resolved from the board
    // owner's account (the board itself authenticates as a device).
    let entitlementOut = null;
    try {
      const { entitlementFor, boardOwnerId } = await import('./_lib/credits.js');
      const ownerId = await boardOwnerId(db, childId);
      const ent = await entitlementFor(db, ownerId || auth.user);
      const member = !!ent.sub || ent.tier === 'admin';
      entitlementOut = { tier: ent.tier, label: ent.label,
                         stt: !!ent.features.stt, autoTeach: !!ent.features.autoTeach,
                         styling: member };
    } catch (_) { /* flags are advisory — sync must never fail over them */ }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      categories: cats.map(rowToCategory),
      items: outItems.map(rowToItem),
      ageFilter: { applied: !!appliedBand, band: appliedBand, hiddenCount: items.length - outItems.length },
      entitlement: entitlementOut,
    });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed', detail: String(err.message || err) });
  }
}

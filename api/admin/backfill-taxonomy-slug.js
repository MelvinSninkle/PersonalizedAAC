// POST /api/admin/backfill-taxonomy-slug?childId=<slug>&apply=true
//   Default (no apply): DRY RUN — returns matched / ambiguous / unmatched lists,
//   writes nothing.
//   With apply=true: applies the matched updates in a single pass, leaves
//   ambiguous and unmatched rows alone, and additionally backfills
//   game_attempts.taxonomy_slug from items.taxonomy_slug for the same child so
//   historical mastery starts rolling up per concept immediately.
//
// Matching rule (intentionally conservative):
//   - Case-insensitive `items.label` == `taxonomy.label`
//   - WITHIN the same section (`items.section` == `taxonomy.column_name`)
//   - Only items with a NULL taxonomy_slug are considered.
//   - One candidate → match. Zero → unmatched. Two+ → ambiguous (skipped).
// A wrong slug is low-blast-radius (it only affects per-concept analytics
// going forward, never rendering), but the dry-run preview lets you eyeball
// what would happen before committing.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }

  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  const apply = String((req.query && req.query.apply) || '') === 'true';

  try {
    const db = sql();

    // Items still missing a slug for this child.
    const items = await db`
      SELECT id, label, section, category_id, taxonomy_slug
      FROM items
      WHERE child_id = ${childId} AND taxonomy_slug IS NULL
      ORDER BY id`;

    // Active taxonomy entries, indexed by (section|lowercased-label) for O(1) lookup.
    const tax = await db`
      SELECT id, column_name, label
      FROM taxonomy
      WHERE archived = false`;
    const byKey = new Map();
    for (const t of tax) {
      const sec = String(t.column_name || '').toLowerCase();
      const lab = String(t.label || '').trim().toLowerCase();
      if (!sec || !lab) continue;
      const key = sec + '|' + lab;
      const list = byKey.get(key);
      if (list) list.push(t); else byKey.set(key, [t]);
    }

    const matched = [], ambiguous = [], unmatched = [];
    for (const it of items) {
      const sec = String(it.section || '').toLowerCase();
      const lab = String(it.label || '').trim().toLowerCase();
      if (!lab) {
        unmatched.push({ itemId: Number(it.id), label: it.label || '', section: it.section, reason: 'empty label' });
        continue;
      }
      const cands = byKey.get(sec + '|' + lab) || [];
      if (cands.length === 0) {
        unmatched.push({ itemId: Number(it.id), label: it.label, section: it.section, reason: `no taxonomy entry labelled "${it.label}" in ${sec}` });
      } else if (cands.length > 1) {
        ambiguous.push({ itemId: Number(it.id), label: it.label, section: it.section, candidates: cands.map(c => c.id) });
      } else {
        matched.push({ itemId: Number(it.id), label: it.label, section: it.section, slug: cands[0].id });
      }
    }

    let appliedItems = 0;
    let appliedAttempts = 0;
    if (apply && matched.length) {
      // Write the matches. Guard with taxonomy_slug IS NULL so a concurrent
      // edit can't be silently clobbered.
      for (const m of matched) {
        const rows = await db`
          UPDATE items SET taxonomy_slug = ${m.slug}
          WHERE id = ${m.itemId} AND child_id = ${childId} AND taxonomy_slug IS NULL
          RETURNING id`;
        if (rows.length) appliedItems++;
      }
      // Propagate to historical game attempts so per-concept mastery rolls
      // up against this child's past sessions, not just future ones.
      const attempts = await db`
        UPDATE game_attempts ga
        SET taxonomy_slug = i.taxonomy_slug
        FROM items i
        WHERE ga.item_id = i.id
          AND ga.child_id = ${childId}
          AND ga.taxonomy_slug IS NULL
          AND i.taxonomy_slug IS NOT NULL
        RETURNING ga.id`;
      appliedAttempts = attempts.length;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      childId,
      dryRun: !apply,
      totals: {
        scannedItems: items.length,
        wouldMatch: matched.length,
        ambiguous: ambiguous.length,
        unmatched: unmatched.length,
      },
      applied: apply ? { items: appliedItems, gameAttempts: appliedAttempts } : null,
      matched, ambiguous, unmatched,
    });
  } catch (err) {
    res.status(500).json({ error: 'Backfill failed', detail: String(err.message || err) });
  }
}

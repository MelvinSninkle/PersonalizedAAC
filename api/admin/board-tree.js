// GET /api/admin/board-tree?childId=<slug>
// Returns the (section → category → subcategory → item-count) tree for one
// child's live board, alongside the canonical taxonomy's same-shape tree, so
// the two can be diffed side-by-side. Read-only, no writes; used by the
// workbench to plan rename/merge ops before applying them.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);

  try {
    const db = sql();
    const cats = await db`SELECT id, section, label, parent_id FROM categories WHERE child_id = ${childId}`;
    const items = await db`SELECT id, section, category_id, label, taxonomy_slug FROM items WHERE child_id = ${childId}`;
    const catById = new Map(cats.map(c => [Number(c.id), c]));
    const topAncestor = (cat) => { let cur = cat; while (cur && cur.parent_id != null && catById.has(Number(cur.parent_id))) cur = catById.get(Number(cur.parent_id)); return cur; };

    // Bucket items: section -> top category label -> subcategory label (null=direct)
    const tree = {};
    let withSlug = 0, withoutSlug = 0;
    for (const it of items) {
      const section = String(it.section || '').toLowerCase();
      let category = null, subcategory = null;
      if (it.category_id != null && catById.has(Number(it.category_id))) {
        const cat = catById.get(Number(it.category_id));
        const top = topAncestor(cat);
        if (top && Number(top.id) !== Number(cat.id)) { category = top.label; subcategory = cat.label; }
        else { category = cat.label; }
      }
      const catKey = category || '(uncategorized)';
      const subKey = subcategory || '';
      tree[section] = tree[section] || {};
      tree[section][catKey] = tree[section][catKey] || { count: 0, items: [], subs: {} };
      tree[section][catKey].count++;
      if (subKey) {
        tree[section][catKey].subs[subKey] = tree[section][catKey].subs[subKey] || { count: 0, items: [] };
        tree[section][catKey].subs[subKey].count++;
        tree[section][catKey].subs[subKey].items.push(it.label);
      } else {
        tree[section][catKey].items.push(it.label);
      }
      if (it.taxonomy_slug) withSlug++; else withoutSlug++;
    }

    // Canonical side: same shape, from the taxonomy table.
    const canon = await db`
      SELECT column_name, category, subcategory, label
      FROM taxonomy
      WHERE archived = FALSE
      ORDER BY column_name, category, subcategory NULLS FIRST, label
    `;
    const canonTree = {};
    for (const r of canon) {
      const section = String(r.column_name || '').toLowerCase();
      const catKey = r.category || '(uncategorized)';
      const subKey = r.subcategory || '';
      canonTree[section] = canonTree[section] || {};
      canonTree[section][catKey] = canonTree[section][catKey] || { count: 0, subs: {} };
      canonTree[section][catKey].count++;
      if (subKey) {
        canonTree[section][catKey].subs[subKey] = canonTree[section][catKey].subs[subKey] || { count: 0 };
        canonTree[section][catKey].subs[subKey].count++;
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      childId,
      totals: {
        boardItems: items.length,
        boardCategories: cats.length,
        canonicalTiles: canon.length,
        boardItemsWithSlug: withSlug,
        boardItemsWithoutSlug: withoutSlug,
      },
      boardTree: tree,
      canonicalTree: canonTree,
    });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

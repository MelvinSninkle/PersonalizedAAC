// GET /api/admin/lab-categories?childId=
// The list of category/subcategory chips Fletcher's board needs, derived from
// distinct (section, category[, subcategory]) in the library taxonomy, joined with
// what's already on his board. Drives the Lab's "Board categories" panel so you can
// see which chips exist (with/without art) and which are missing — and create them
// BEFORE generating tiles in that category (publish blocks otherwise). Admin-gated.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { buildIconPrompt } from '../_lib/category-icons.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    // distinct categories from taxonomy + tile counts (categories) and per-subcat counts
    const specs = await db`
      WITH cats AS (
        SELECT lower(column_name) AS section, category AS label, NULL::text AS subcategory,
               COUNT(*)::int AS tile_count
        FROM taxonomy WHERE category IS NOT NULL AND category <> '' GROUP BY 1,2
      ),
      subs AS (
        SELECT lower(column_name) AS section, category AS parent_label, subcategory AS label,
               COUNT(*)::int AS tile_count
        FROM taxonomy WHERE subcategory IS NOT NULL AND subcategory <> '' GROUP BY 1,2,3
      )
      SELECT * FROM (
        SELECT section, label, NULL::text AS parent_label, tile_count FROM cats
        UNION ALL
        SELECT section, label, parent_label, tile_count FROM subs
      ) u
      ORDER BY section, COALESCE(parent_label, label), parent_label NULLS FIRST, label`;
    const boardCats = await db`
      SELECT id, lower(section) AS section, label, parent_id, image_key
      FROM categories WHERE child_id = ${childId}`;
    const hasStyle = (await db`SELECT 1 FROM style_guides WHERE active = TRUE LIMIT 1`).length > 0;
    // index board cats by section+lower(label) and section+lower(label)+parent_id
    const topByKey = new Map();      // section|label -> row (parent_id NULL)
    const subByKey = new Map();      // section|parent_id|label -> row
    for (const c of boardCats) {
      const k = c.section + '|' + (c.label || '').toLowerCase();
      if (c.parent_id == null) topByKey.set(k, c);
      else subByKey.set(c.section + '|' + c.parent_id + '|' + (c.label || '').toLowerCase(), c);
    }
    const rows = specs.map(s => {
      const sec = s.section;
      let onBoard = null, parentId = null, parentMissing = false;
      if (!s.parent_label) {
        onBoard = topByKey.get(sec + '|' + s.label.toLowerCase()) || null;
      } else {
        const parent = topByKey.get(sec + '|' + s.parent_label.toLowerCase());
        if (!parent) parentMissing = true;
        else {
          parentId = parent.id;
          onBoard = subByKey.get(sec + '|' + parent.id + '|' + s.label.toLowerCase()) || null;
        }
      }
      return {
        section: sec,
        label: s.label,
        parentLabel: s.parent_label,
        tileCount: s.tile_count,
        boardId: onBoard ? onBoard.id : null,
        hasImage: !!(onBoard && onBoard.image_key),
        imageKey: onBoard ? onBoard.image_key : null,
        parentBoardId: parentId,
        parentMissing,
        // The curated (or generic-fallback) icon prompt, surfaced so the Lab can
        // show it for a read-through and let the admin tweak it before generating.
        prompt: buildIconPrompt({ label: s.label, parentLabel: s.parent_label, hasStyle }),
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ childId, rows });
  } catch (err) {
    res.status(500).json({ error: 'lab-categories failed', detail: String(err.message || err) });
  }
}

// /api/admin/lab?action=layout  (admin only)
//
// The default board's CURATED ORDER — which categories come first in each
// column and which words come first inside each category/subcategory. The Lab
// layout screen drags these; every NEW board build then places categories and
// tiles in this order (seed-board.js reads both stores). Existing boards keep
// whatever order the family has made their own.
//
//   GET → { columns: [{ section, categories: [{ label, parent:'', sort,
//            words:[{id,label,sort}], subs:[{label, parent, sort, words:[…] }] }] }] }
//   POST { categories:[{section,label,parent,sort}], tiles:[{id,sort}] } → { ok }
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { maxDuration: 60 };

const norm = (s) => String(s || '').trim().toLowerCase();

async function ensure(db) {
  await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS sort_order INTEGER`;
  await db`
    CREATE TABLE IF NOT EXISTS default_category_order (
      section TEXT NOT NULL, label_norm TEXT NOT NULL, parent_norm TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (section, label_norm, parent_norm)
    )`;
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await ensure(db);

  try {
    if (req.method === 'GET') {
      const [rows, order] = await Promise.all([
        db`SELECT id, label, lower(column_name) AS section, category, subcategory, sort_order
           FROM taxonomy
           WHERE COALESCE(archived, FALSE) = FALSE
             AND COALESCE(is_event, FALSE) = FALSE
             AND COALESCE(is_gestalt, FALSE) = FALSE
             AND COALESCE(authoring_kind, 'canonical') = 'canonical'
             AND COALESCE(audience, 'universal') = 'universal'
           ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST,
                    sort_order NULLS LAST, label, id`,
        db`SELECT section, label_norm, parent_norm, sort_order FROM default_category_order`,
      ]);
      const catSort = new Map(order.map(o => [`${o.section}|${o.label_norm}|${o.parent_norm}`, o.sort_order]));
      const columns = new Map();
      for (const r of rows) {
        if (!columns.has(r.section)) columns.set(r.section, new Map());
        const cats = columns.get(r.section);
        const catLabel = String(r.category || '').trim() || '(no category)';
        if (!cats.has(norm(catLabel))) {
          cats.set(norm(catLabel), {
            label: catLabel, parent: '',
            sort: catSort.get(`${r.section}|${norm(catLabel)}|`) ?? null,
            words: [], subs: new Map(),
          });
        }
        const cat = cats.get(norm(catLabel));
        const subLabel = String(r.subcategory || '').trim();
        if (subLabel) {
          if (!cat.subs.has(norm(subLabel))) {
            cat.subs.set(norm(subLabel), {
              label: subLabel, parent: catLabel,
              sort: catSort.get(`${r.section}|${norm(subLabel)}|${norm(catLabel)}`) ?? null,
              words: [],
            });
          }
          cat.subs.get(norm(subLabel)).words.push({ id: r.id, label: r.label, sort: r.sort_order });
        } else {
          cat.words.push({ id: r.id, label: r.label, sort: r.sort_order });
        }
      }
      const bySort = (a, b) => ((a.sort ?? 1e9) - (b.sort ?? 1e9)) || a.label.localeCompare(b.label);
      const out = [...columns.entries()].map(([section, cats]) => ({
        section,
        categories: [...cats.values()].map(c => ({
          ...c, subs: [...c.subs.values()].sort(bySort),
        })).sort(bySort),
      }));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, columns: out });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = (typeof req.body === 'object' && req.body) || {};
    const cats = Array.isArray(b.categories) ? b.categories.slice(0, 500) : [];
    const tiles = Array.isArray(b.tiles) ? b.tiles.slice(0, 3000) : [];
    for (const c of cats) {
      if (!c || !c.section || !c.label) continue;
      await db`INSERT INTO default_category_order (section, label_norm, parent_norm, sort_order)
               VALUES (${norm(c.section)}, ${norm(c.label)}, ${norm(c.parent || '')}, ${Math.floor(Number(c.sort) || 0)})
               ON CONFLICT (section, label_norm, parent_norm)
               DO UPDATE SET sort_order = ${Math.floor(Number(c.sort) || 0)}`;
    }
    for (const t of tiles) {
      if (!t || !t.id) continue;
      await db`UPDATE taxonomy SET sort_order = ${Math.floor(Number(t.sort) || 0)} WHERE id = ${String(t.id)}`;
    }
    res.status(200).json({ ok: true, categories: cats.length, tiles: tiles.length });
  } catch (err) {
    res.status(500).json({ error: 'layout failed', detail: String(err.message || err) });
  }
}

// GET /api/admin/lab?action=defaults-view   (admin only; dispatched from lab.js)
//
// Data for the admin "Default board" audit page (admin/defaults.html). Returns
// every non-archived taxonomy tile, each tagged with whether it's DEFAULT-ABLE
// (shares one canonical image across kids — see isDefaultableTile) and, if so,
// the Blob key of its current default image. Personalized tiles (they reference a
// specific person) carry no image — the page renders them as an empty word-tile
// so the admin can see the whole default experience at a glance and spot any
// default-able tile still missing its image.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { isDefaultableTile } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  try {
    const db = sql();
    // Folder icons: every category/subcategory named in the taxonomy, with its
    // shared default icon (category_defaults) when one exists. Sections are
    // lowercased to match the board's section keys.
    let folders = [];
    try {
      const [tax, defs] = await Promise.all([
        db`SELECT DISTINCT lower(column_name) AS section, category, subcategory FROM taxonomy
           WHERE COALESCE(archived, FALSE) = FALSE AND category IS NOT NULL`,
        db`SELECT section, label_norm, image_key FROM category_defaults`,
      ]);
      const dmap = new Map(defs.map((d) => [d.section + '|' + d.label_norm, d.image_key]));
      const seen = new Set();
      for (const t of tax) {
        for (const lbl of [t.category, t.subcategory]) {
          if (!lbl) continue;
          const key = t.section + '|' + String(lbl).trim().toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          folders.push({ section: t.section, label: lbl, imageKey: dmap.get(key) || null });
        }
      }
      folders.sort((a, b) => a.section.localeCompare(b.section) || a.label.localeCompare(b.label));
    } catch (_) { folders = []; }

    const rows = await db`
      SELECT id, column_name, category, subcategory, label, prompt_template,
             subject_mode, status, default_image_key
      FROM taxonomy
      WHERE COALESCE(archived, FALSE) = FALSE
      ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST, label, id`;

    let defaultable = 0, withImage = 0;
    const tiles = rows.map((r) => {
      const isDef = isDefaultableTile(r);
      const hasImg = isDef && !!r.default_image_key;
      if (isDef) defaultable++;
      if (hasImg) withImage++;
      return {
        id: r.id,
        label: r.label,
        column: r.column_name,
        category: r.category || null,
        subcategory: r.subcategory || null,
        status: r.status,
        defaultable: isDef,
        imageKey: hasImg ? r.default_image_key : null,
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      total: tiles.length,
      defaultable,
      personalized: tiles.length - defaultable,
      withImage,
      missing: defaultable - withImage,
      folders,
      foldersWithIcon: folders.filter((f) => f.imageKey).length,
      tiles,
    });
  } catch (err) {
    res.status(500).json({ error: 'defaults-view failed', detail: String(err.message || err) });
  }
}

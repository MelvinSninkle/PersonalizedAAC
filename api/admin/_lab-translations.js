// /api/admin/lab?action=translations  (admin only)
//
// Board-content translation dictionary (see api/_lib/i18n.js for the model:
// English stays canonical; translations are a display + audio layer). Built
// for a native-speaker review loop: seed the bundled machine dictionary,
// export a CSV for the reviewer, import their corrections back — corrected
// rows flip to status 'reviewed'.
//
//   GET  ?lang=zh          → { entries, coverage } — every dictionary row plus
//                            which taxonomy labels are still untranslated
//   GET  ?lang=zh&csv=1    → text/csv export (en,section,category,zh,pron,status)
//   POST { op:'seed', lang }              import the bundled _lib/i18n/<lang>.json
//                                         (never overwrites 'reviewed' rows)
//   POST { op:'set', lang, en, zh, section?, category?, pron?, status? }
//                                         upsert one row ('' zh deletes it)
//   POST { op:'import', lang, rows:[{en,section?,category?,zh,pron?}] }
//                                         bulk upsert (CSV round-trip), rows
//                                         land as status 'reviewed'
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { ensureTranslations, bundledDictionary } from '../_lib/i18n.js';

export const config = { maxDuration: 60 };

const norm = (s) => String(s || '').trim().toLowerCase();
const LANG_RE = /^[a-z]{2}(-[a-z0-9]{2,8})?$/i;

async function upsert(db, lang, e, status) {
  const zh = String(e.t || e.zh || e.translation || e.label || '').trim().slice(0, 120);
  const en = norm(e.en);
  const section = norm(e.section);
  const category = norm(e.category);
  if (!en) return 'skipped';
  if (!zh) {
    await db`DELETE FROM label_translations
             WHERE lang = ${lang} AND section = ${section} AND category_norm = ${category} AND label_norm = ${en}`;
    return 'deleted';
  }
  const pron = String(e.pron || e.pronunciation || '').trim().slice(0, 200) || null;
  await db`
    INSERT INTO label_translations (lang, section, category_norm, label_norm, label, pronunciation, status)
    VALUES (${lang}, ${section}, ${category}, ${en}, ${zh}, ${pron}, ${status})
    ON CONFLICT (lang, section, category_norm, label_norm)
    DO UPDATE SET label = ${zh}, pronunciation = ${pron}, status = ${status}, updated_at = NOW()`;
  return 'upserted';
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await ensureTranslations(db);
  const q = req.query || {};
  const lang = LANG_RE.test(String(q.lang || (req.body && req.body.lang) || ''))
    ? String(q.lang || req.body.lang).toLowerCase() : 'zh';

  try {
    if (req.method === 'GET') {
      const entries = await db`
        SELECT section, category_norm AS category, label_norm AS en, label, pronunciation, status
        FROM label_translations WHERE lang = ${lang}
        ORDER BY label_norm, section, category_norm`;

      // Coverage: which live taxonomy labels + category names have no match.
      const tax = await db`
        SELECT DISTINCT lower(label) AS l FROM taxonomy
        WHERE COALESCE(archived, FALSE) = FALSE
          AND COALESCE(authoring_kind, 'canonical') = 'canonical'
          AND COALESCE(audience, 'universal') = 'universal'`;
      const cats = await db`
        SELECT DISTINCT lower(category) AS l FROM taxonomy WHERE COALESCE(category, '') <> ''
        UNION SELECT DISTINCT lower(subcategory) FROM taxonomy WHERE COALESCE(subcategory, '') <> ''`;
      const have = new Set(entries.map((e) => e.en));
      const missingWords = tax.map((r) => r.l).filter((l) => l && !have.has(l)).sort();
      const missingCategories = cats.map((r) => r.l).filter((l) => l && !have.has(l)).sort();

      if (String(q.csv || '') === '1') {
        const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const lines = ['en,section,category,translation,pronunciation,status'];
        for (const e of entries) lines.push([e.en, e.section, e.category, e.label, e.pronunciation, e.status].map(cell).join(','));
        for (const m of missingWords) lines.push([m, '', '', '', '', 'MISSING'].map(cell).join(','));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="myworld-translations-${lang}.csv"`);
        res.status(200).send(lines.join('\n'));
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, lang, entries,
        coverage: { taxonomyLabels: tax.length, translated: tax.length - missingWords.length,
                    missingWords: missingWords.slice(0, 500), missingCategories: missingCategories.slice(0, 200) } });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = (typeof req.body === 'object' && req.body) || {};

    if (b.op === 'seed') {
      const dict = bundledDictionary(lang);
      if (!dict || !Array.isArray(dict.entries)) { res.status(404).json({ error: `no bundled dictionary for '${lang}'` }); return; }
      // Reviewed rows are the native speaker's word — the machine seed never
      // overwrites them.
      const reviewed = new Set((await db`
        SELECT section, category_norm, label_norm FROM label_translations
        WHERE lang = ${lang} AND status = 'reviewed'`)
        .map((r) => `${r.section}|${r.category_norm}|${r.label_norm}`));
      let added = 0, kept = 0;
      for (const e of dict.entries) {
        const key = `${norm(e.section)}|${norm(e.category)}|${norm(e.en)}`;
        if (reviewed.has(key)) { kept++; continue; }
        if ((await upsert(db, lang, e, 'machine')) === 'upserted') added++;
      }
      res.status(200).json({ ok: true, lang, added, keptReviewed: kept, total: dict.entries.length });
      return;
    }

    if (b.op === 'set') {
      const r = await upsert(db, lang, b, b.status === 'machine' ? 'machine' : 'reviewed');
      res.status(200).json({ ok: true, result: r });
      return;
    }

    if (b.op === 'import') {
      const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : [];
      let upserted = 0, deleted = 0, skipped = 0;
      for (const r of rows) {
        const out = await upsert(db, lang, r, 'reviewed');
        if (out === 'upserted') upserted++; else if (out === 'deleted') deleted++; else skipped++;
      }
      res.status(200).json({ ok: true, upserted, deleted, skipped });
      return;
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (err) {
    res.status(500).json({ error: 'translations failed', detail: String(err.message || err) });
  }
}

// /api/admin/lab?action=boards  (admin only)
//
// Board catalog management for the Lab's default-board view: which top-level
// categories ("boards") ship on every NEW board build vs. live in the Word
// Shop only, and whether a store-only board is free to add or requires
// credits. Backed by board_catalog keyed (section, category) — categories
// themselves stay plain taxonomy text, so anything added to the taxonomy
// under a cataloged category inherits its board's behavior automatically
// (and shows up in the defaults view for image generation, which reads the
// taxonomy live).
//
//   default (no row)      on every new board, free in the shop's free section
//   store_only            never seeded; an ADD-ON families add free from the
//                         shop (styling is what costs credits). The old
//                         'credits' pricing tier is retired — init.js
//                         migrates legacy rows to 'free'.
//
//   GET → { boards:[{section,label,count,defaultables,storeOnly,pricing}] }
//   POST op:'flags'  { section, label, storeOnly, pricing }
//   POST op:'create' { section, label, storeOnly, pricing, words:['t-rex',…] }
//     → creates taxonomy rows with the same conventions as the board importer
//       (derived slug ids, house default prompt_template + subject_mode), so
//       the new words appear in the defaults view ready for image generation.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { maxDuration: 60 };

const norm = (s) => String(s || '').trim().toLowerCase();
const COLUMN_FOR = { people: 'People', nouns: 'Nouns', verbs: 'Verbs', needs: 'Needs' };

function subjectModeFor(section) {
  if (section === 'people') return 'person';
  if (section === 'needs' || section === 'verbs') return 'concept';
  return 'object';
}
function promptFor(section, label) {
  const safe = String(label || '').replace(/"/g, '');
  if (section === 'people') {
    return `A {style} head-and-shoulders portrait based on {reference}, warm and friendly, soft plain background, no text.`;
  }
  if (section === 'verbs' || section === 'needs') {
    return `A {style} illustration representing "${safe}", simple and clear for a toddler, soft plain background, no text.`;
  }
  return `A {style} illustration of a single ${safe}, centered, soft plain background, bright and friendly for a toddler, no text.`;
}
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 40) || 'item';
}

export async function ensureBoardCatalog(db) {
  await db`
    CREATE TABLE IF NOT EXISTS board_catalog (
      section TEXT NOT NULL,
      label_norm TEXT NOT NULL,
      store_only BOOLEAN NOT NULL DEFAULT TRUE,
      pricing TEXT NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (section, label_norm)
    )`;
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await ensureBoardCatalog(db);

  try {
    if (req.method === 'GET') {
      const [rows, flags] = await Promise.all([
        db`SELECT lower(column_name) AS section, category, count(*)::int AS count
           FROM taxonomy
           WHERE COALESCE(archived, FALSE) = FALSE
             AND COALESCE(is_event, FALSE) = FALSE
             AND COALESCE(is_gestalt, FALSE) = FALSE
             AND COALESCE(authoring_kind, 'canonical') = 'canonical'
             AND COALESCE(audience, 'universal') = 'universal'
             AND COALESCE(category, '') <> ''
           GROUP BY 1, 2 ORDER BY 1, 2`,
        db`SELECT section, label_norm, store_only, pricing FROM board_catalog`,
      ]);
      const fMap = new Map(flags.map((f) => [`${f.section}|${f.label_norm}`, f]));
      const boards = rows.map((r) => {
        const f = fMap.get(`${r.section}|${norm(r.category)}`);
        return { section: r.section, label: String(r.category).trim(), count: r.count,
                 storeOnly: !!(f && f.store_only), pricing: (f && f.pricing) || 'free' };
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, boards });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = (typeof req.body === 'object' && req.body) || {};
    const section = norm(b.section);
    const label = String(b.label || '').trim().slice(0, 80);
    if (!COLUMN_FOR[section] || !label) { res.status(400).json({ error: 'section (people|nouns|verbs|needs) and label required' }); return; }
    const storeOnly = b.storeOnly !== false;
    const pricing = b.pricing === 'credits' ? 'credits' : 'free';

    if (b.op === 'flags') {
      if (b.storeOnly === false) {
        // Back to the default state: seeded on new boards, free.
        await db`DELETE FROM board_catalog WHERE section = ${section} AND label_norm = ${norm(label)}`;
      } else {
        await db`INSERT INTO board_catalog (section, label_norm, store_only, pricing)
                 VALUES (${section}, ${norm(label)}, TRUE, ${pricing})
                 ON CONFLICT (section, label_norm) DO UPDATE SET store_only = TRUE, pricing = ${pricing}`;
      }
      res.status(200).json({ ok: true, section, label, storeOnly: b.storeOnly !== false, pricing });
      return;
    }

    if (b.op === 'create') {
      const words = (Array.isArray(b.words) ? b.words : [])
        .map((w) => String(w || '').trim().slice(0, 80)).filter(Boolean).slice(0, 200);
      if (!words.length) { res.status(400).json({ error: 'words required (one label per line)' }); return; }

      const column = COLUMN_FOR[section];
      const existing = new Set((await db`SELECT id FROM taxonomy`).map((r) => r.id));
      let created = 0, skipped = 0;
      const errors = [];
      for (const w of words) {
        const base = [section, label, w].map(slugify).join('.');
        let slug = base, n = 2;
        while (existing.has(slug)) slug = `${base}_${n++}`;
        // Same-labeled word already under this category? Skip instead of
        // minting near-duplicates.
        if (slug !== base) {
          const dup = await db`SELECT id FROM taxonomy
                               WHERE lower(column_name) = ${section} AND lower(category) = ${norm(label)}
                                 AND lower(label) = ${norm(w)} LIMIT 1`;
          if (dup.length) { skipped++; continue; }
        }
        existing.add(slug);
        try {
          await db`
            INSERT INTO taxonomy (id, column_name, category, subcategory, label,
                                  prompt_template, subject_mode, parent_photo_behavior,
                                  phase, core, status, archived, created_by, updated_by)
            VALUES (${slug}, ${column}, ${label}, ${null}, ${w},
                    ${promptFor(section, w)}, ${subjectModeFor(section)}, ${'none'},
                    ${'v1_extended'}, ${true}, ${'published'}, ${false}, ${'admin'}, ${'admin'})`;
          created++;
        } catch (e) { errors.push({ word: w, error: String(e.message || e).slice(0, 160) }); }
      }
      if (storeOnly) {
        await db`INSERT INTO board_catalog (section, label_norm, store_only, pricing)
                 VALUES (${section}, ${norm(label)}, TRUE, ${pricing})
                 ON CONFLICT (section, label_norm) DO UPDATE SET store_only = TRUE, pricing = ${pricing}`;
      }
      res.status(200).json({ ok: true, section, label, storeOnly, pricing, created, skipped, errors });
      return;
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (err) {
    res.status(500).json({ error: 'boards failed', detail: String(err.message || err) });
  }
}

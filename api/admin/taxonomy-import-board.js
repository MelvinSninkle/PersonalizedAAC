// POST /api/admin/taxonomy-import-board?childId=<slug>
// "Bring in the current one": seed the canonical taxonomy from a child's LIVE
// board (their categories + items). Each tile becomes a draft taxonomy row with
// a derived slug, a sensible default prompt_template, and heuristic subject_mode
// / parent_photo_behavior the admin can refine afterwards.
//
// Safe + reversible: auto-snapshots the taxonomy first, only INSERTS new ids
// (existing rows are left untouched / counted as skipped), and writes an audit
// entry. Imports as status='draft', core=true so nothing goes live by accident.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

const ACTOR = 'admin';
const COLUMN_FOR = { people: 'People', nouns: 'Nouns', verbs: 'Verbs', needs: 'Needs' };

// Heuristics the admin will refine in the workbench. People are real individuals
// (use the child/parent reference photo); needs/verbs are abstract concepts;
// nouns are objects.
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
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'item';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }

  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);

  try {
    const db = sql();
    const cats  = await db`SELECT id, section, label, parent_id, display_order FROM categories WHERE child_id = ${childId}`;
    const items = await db`SELECT id, section, category_id, label, display_order FROM items WHERE child_id = ${childId}`;
    if (!cats.length && !items.length) {
      res.status(404).json({ error: `No board found for child "${childId}"` });
      return;
    }

    const catById = new Map(cats.map(c => [Number(c.id), c]));
    const labelOf = (id) => { const c = catById.get(Number(id)); return c ? c.label : null; };
    const topAncestor = (cat) => { let cur = cat; while (cur && cur.parent_id != null && catById.has(Number(cur.parent_id))) cur = catById.get(Number(cur.parent_id)); return cur; };

    // 1) Auto-snapshot the taxonomy first (reversible).
    const existing = await db`SELECT * FROM taxonomy ORDER BY id`;
    const snapshotLabel = `pre-board-import-${childId}-${new Date().toISOString()}`;
    await db`
      INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
      VALUES (${ACTOR}, ${snapshotLabel}, ${`Auto-snapshot before importing ${childId}'s board`}, ${existing.length}, ${JSON.stringify(existing)}::jsonb)
    `;
    const existingIds = new Set(existing.map(r => r.id));
    const usedSlugs = new Set(existingIds);

    // Build a unique slug within (and across) this import.
    function uniqueSlug(parts) {
      const base = parts.filter(Boolean).map(slugify).join('.');
      let slug = base, n = 2;
      while (usedSlugs.has(slug)) slug = `${base}_${n++}`;
      usedSlugs.add(slug);
      return slug;
    }

    let inserted = 0, skipped = 0;
    const errors = [];

    for (const it of items) {
      const section = String(it.section || '').toLowerCase();
      const column = COLUMN_FOR[section];
      if (!column) { skipped++; continue; }           // unknown section — leave it

      // Category / subcategory text from the item's category and its top ancestor.
      let category = null, subcategory = null;
      if (it.category_id != null && catById.has(Number(it.category_id))) {
        const cat = catById.get(Number(it.category_id));
        const top = topAncestor(cat);
        if (top && Number(top.id) !== Number(cat.id)) { category = top.label; subcategory = cat.label; }
        else { category = cat.label; }
      }

      const slug = uniqueSlug([section, category, subcategory, it.label]);
      if (existingIds.has(slug)) { skipped++; continue; }

      try {
        await db`
          INSERT INTO taxonomy (
            id, column_name, category, subcategory, label, pronunciation,
            prompt_template, subject_mode, parent_photo_behavior, phase, core, notes,
            status, archived, created_by, updated_by
          ) VALUES (
            ${slug}, ${column}, ${category}, ${subcategory},
            ${it.label}, ${null},
            ${promptFor(section, it.label)}, ${subjectModeFor(section)}, ${'none'},
            ${'v1_core'}, ${true}, ${`imported from ${childId}'s board`},
            ${'draft'}, ${false}, ${ACTOR}, ${ACTOR}
          )
        `;
        inserted++;
      } catch (e) {
        errors.push({ slug, error: String(e.message || e) });
      }
    }

    const summary = `board-import(${childId}): +${inserted} skip:${skipped} err:${errors.length}`;
    await db`
      INSERT INTO taxonomy_audit (actor, action, summary, note)
      VALUES (${ACTOR}, 'board-import', ${summary}, ${snapshotLabel})
    `;

    // Surface WHY rows failed. With a systematic problem (e.g. a missing column
    // after a schema change) all 750 errors are the same message, so collapse to
    // distinct messages with counts + an example slug — far more useful than a
    // raw count, and keeps the response small.
    const byMessage = new Map();
    for (const e of errors) {
      const m = byMessage.get(e.error);
      if (m) { m.count++; } else { byMessage.set(e.error, { error: e.error, count: 1, exampleSlug: e.slug }); }
    }
    const errorSummary = [...byMessage.values()].sort((a, b) => b.count - a.count);

    res.status(200).json({
      ok: true, childId, inserted, skipped,
      errorCount: errors.length,
      errorSummary,                 // distinct messages + counts + example slug
      errors: errors.slice(0, 25),  // first few raw rows for detail
      snapshotLabel,
    });
  } catch (err) {
    res.status(500).json({ error: 'Board import failed', detail: String(err.message || err) });
  }
}

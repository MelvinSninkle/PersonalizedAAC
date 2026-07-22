// /api/admin/taxonomy-snapshots — list / create / restore / delete snapshots
// of the entire taxonomy. Snapshots are point-in-time copies stored as JSONB.
//   GET                              → list (no payload, keeps response light)
//   GET   ?id=N&full=1               → fetch one with payload
//   POST  { label, note }            → create a snapshot of the current state
//   POST  ?id=N&action=restore       → restore (auto-creates a pre-restore snapshot)
//   DELETE ?id=N                     → delete (immutable to edit, deletable)
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

const ACTOR = 'admin';

function snapshotOut(r, includePayload) {
  const out = {
    id: Number(r.id),
    createdAt: r.created_at,
    createdBy: r.created_by,
    label: r.label,
    note: r.note,
    rowCount: r.row_count,
  };
  if (includePayload) out.payload = r.payload;
  return out;
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  try {
    const db = sql();
    if (req.method === 'GET')    return await read(req, res, db);
    if (req.method === 'POST')   return await write(req, res, db);
    if (req.method === 'DELETE') return await remove(req, res, db);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

async function read(req, res, db) {
  const id = req.query.id ? parseInt(req.query.id, 10) : null;
  if (id) {
    const rows = await db`SELECT * FROM taxonomy_snapshots WHERE id = ${id}`;
    if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    // diff=1 → compare snapshot's payload to the current taxonomy and
    // return added / removed / changed id lists with per-row before+after.
    if (req.query.diff) {
      const cur = await db`SELECT * FROM taxonomy ORDER BY id`;
      const snap = Array.isArray(rows[0].payload) ? rows[0].payload : [];
      const curById  = new Map(cur.map(r => [r.id, r]));
      const snapById = new Map(snap.map(r => [r.id, r]));
      // Fields to compare; anything else (timestamps, audit columns) we ignore.
      const compareFields = ['column_name','category','subcategory','label','pronunciation',
        'prompt_template','subject_mode','parent_photo_behavior','phase','status','archived','notes'];
      const added = [], removed = [], changed = [];
      for (const [rid, row] of curById) {
        if (!snapById.has(rid)) { added.push({ id: rid, label: row.label, column: row.column_name }); continue; }
        const old = snapById.get(rid);
        const diffs = compareFields.filter(f => String(row[f] ?? '') !== String(old[f] ?? ''));
        if (diffs.length) changed.push({ id: rid, label: row.label, fields: diffs });
      }
      for (const [rid, row] of snapById) {
        if (!curById.has(rid)) removed.push({ id: rid, label: row.label, column: row.column_name });
      }
      res.status(200).json({
        snapshotId: id,
        snapshotLabel: rows[0].label,
        snapshotCreatedAt: rows[0].created_at,
        added, removed, changed,
        totals: { added: added.length, removed: removed.length, changed: changed.length },
      });
      return;
    }
    res.status(200).json(snapshotOut(rows[0], !!req.query.full));
    return;
  }
  const rows = await db`
    SELECT id, created_at, created_by, label, note, row_count
    FROM taxonomy_snapshots
    ORDER BY created_at DESC
    LIMIT 200
  `;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ snapshots: rows.map(r => snapshotOut(r, false)) });
}

async function write(req, res, db) {
  // POST?action=heal&id=N[&dryRun=1] → NON-DESTRUCTIVE recovery from a
  // snapshot. Unlike restore (wipe-and-replace), heal only REPAIRS: for rows
  // present in both the snapshot and the live table it fills back the columns
  // a lossy restore can have wiped, and touches nothing else — no deletes, no
  // inserts, no changes to identity/editorial fields (label, status, prompt,
  // notes, category), and rows added since the snapshot are left alone.
  if (req.query.action === 'heal') return await heal(req, res, db);

  // POST?action=restore&id=N → replace taxonomy with the snapshot's contents.
  if (req.query.action === 'restore') {
    const id = parseInt(req.query.id, 10);
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    const snaps = await db`SELECT * FROM taxonomy_snapshots WHERE id = ${id}`;
    if (!snaps.length) { res.status(404).json({ error: 'Not found' }); return; }
    const snap = snaps[0];
    const payload = Array.isArray(snap.payload) ? snap.payload : [];

    // First take a "pre-restore" snapshot so restore itself is reversible.
    const cur = await db`SELECT * FROM taxonomy ORDER BY id`;
    const preLabel = `pre-restore-from-#${id}-${new Date().toISOString()}`;
    await db`
      INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
      VALUES (${ACTOR}, ${preLabel}, ${'Auto-snapshot before restoring #' + id}, ${cur.length}, ${JSON.stringify(cur)}::jsonb)
    `;

    // Now wipe and reinsert from the snapshot. Not wrapped in a SQL transaction
    // because the Neon serverless API issues each statement separately; if a
    // partial state is left behind, the pre-restore snapshot above is the
    // recovery path.
    //
    // ⚠️ EVERY taxonomy column must be written back here. Snapshots STORE
    // full rows (SELECT *), but this INSERT once listed only the original 18
    // columns — restoring silently WIPED everything added since
    // (descriptive_clues, match_terms, sort_order, default_image_key, the
    // age/growth/meal metadata, gestalt + personalization fields). That
    // exact failure deleted the teaching facts from production on
    // 2026-07-21. When a migration adds a taxonomy column, add it HERE in
    // the same commit (the update-taxonomy skill checklist says so too) —
    // and to the heal() column lists below, which repair that same set.
    await db`DELETE FROM taxonomy`;
    for (const r of payload) {
      await db`
        INSERT INTO taxonomy (
          id, column_name, category, subcategory, label, pronunciation,
          prompt_template, subject_mode, parent_photo_behavior, phase, notes,
          status, archived, created_at, created_by, updated_at, updated_by, published_at,
          core, growth_stage, acquisition_age, is_event, event_key, meal_context,
          is_gestalt, gestalt_type, gestalt_meaning, gestalt_target_words,
          descriptive_clues, representation_levels, place_kind,
          audience, authoring_kind, roles_present, objects_present,
          has_relationship, related_images, personalized,
          default_image_key, sort_order, match_terms
        ) VALUES (
          ${r.id}, ${r.column_name}, ${r.category ?? null}, ${r.subcategory ?? null},
          ${r.label}, ${r.pronunciation ?? null},
          ${r.prompt_template ?? ''}, ${r.subject_mode}, ${r.parent_photo_behavior},
          ${r.phase ?? 'v1_core'}, ${r.notes ?? null},
          ${r.status ?? 'draft'}, ${!!r.archived},
          ${r.created_at ?? new Date().toISOString()}, ${r.created_by ?? ACTOR},
          ${r.updated_at ?? new Date().toISOString()}, ${r.updated_by ?? ACTOR},
          ${r.published_at ?? null},
          ${r.core === false ? false : true}, ${r.growth_stage ?? null}, ${r.acquisition_age ?? null},
          ${!!r.is_event}, ${r.event_key ?? null}, ${r.meal_context ?? null},
          ${!!r.is_gestalt}, ${r.gestalt_type ?? null}, ${r.gestalt_meaning ?? null},
          ${Array.isArray(r.gestalt_target_words) ? r.gestalt_target_words : null},
          ${Array.isArray(r.descriptive_clues) ? r.descriptive_clues : null},
          ${r.representation_levels == null ? null : JSON.stringify(r.representation_levels)}::jsonb,
          ${r.place_kind ?? null},
          ${r.audience ?? 'universal'}, ${r.authoring_kind ?? 'canonical'},
          ${Array.isArray(r.roles_present) ? r.roles_present : null},
          ${Array.isArray(r.objects_present) ? r.objects_present : null},
          ${!!r.has_relationship},
          ${Array.isArray(r.related_images) ? r.related_images : null},
          ${!!r.personalized},
          ${r.default_image_key ?? null},
          ${Number.isFinite(Number(r.sort_order)) && r.sort_order !== null ? Number(r.sort_order) : null},
          ${Array.isArray(r.match_terms) ? r.match_terms : null}
        )
      `;
    }
    await db`
      INSERT INTO taxonomy_audit (actor, action, summary, note)
      VALUES (${ACTOR}, 'restore', ${`restored snapshot #${id} (${payload.length} rows)`}, ${snap.label})
    `;
    res.status(200).json({ ok: true, restored: payload.length, preRestoreSnapshot: preLabel });
    return;
  }

  // POST → create a snapshot of the current state.
  const body = (typeof req.body === 'object' && req.body) || {};
  const label = (typeof body.label === 'string' && body.label.trim() ? body.label : 'manual-' + new Date().toISOString()).slice(0, 200);
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null;

  const cur = await db`SELECT * FROM taxonomy ORDER BY id`;
  const inserted = await db`
    INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
    VALUES (${ACTOR}, ${label}, ${note}, ${cur.length}, ${JSON.stringify(cur)}::jsonb)
    RETURNING id, created_at, created_by, label, note, row_count
  `;
  await db`
    INSERT INTO taxonomy_audit (actor, action, summary, note)
    VALUES (${ACTOR}, 'snapshot', ${`created snapshot "${label}" (${cur.length} rows)`}, ${note})
  `;
  res.status(200).json(snapshotOut(inserted[0], false));
}

// The column set the pre-2026-07-21 restore failed to write back — exactly
// what a lossy restore can have wiped. Two repair strategies by column shape:
//   NULLABLE: the live value wins whenever it's set; the snapshot fills only
//     genuine NULLs (a wipe leaves NULL, so an intentional post-wipe edit is
//     never clobbered).
//   DEFAULTED (NOT NULL with a DDL default): a wipe stamps the default, so a
//     NULL check can't detect the damage — the snapshot value is taken as
//     authoritative for matched rows.
//   match_terms merges as a set union (same rule as the CSV importer), so
//     variants donated since the snapshot survive.
const HEAL_NULLABLE = ['growth_stage', 'acquisition_age', 'event_key', 'meal_context',
  'gestalt_type', 'gestalt_meaning', 'gestalt_target_words', 'descriptive_clues',
  'representation_levels', 'place_kind', 'roles_present', 'objects_present',
  'related_images', 'default_image_key', 'sort_order'];
const HEAL_DEFAULTED = {
  core: (r) => r.core === false ? false : true,
  is_event: (r) => !!r.is_event,
  is_gestalt: (r) => !!r.is_gestalt,
  audience: (r) => r.audience ?? 'universal',
  authoring_kind: (r) => r.authoring_kind ?? 'canonical',
  has_relationship: (r) => !!r.has_relationship,
  personalized: (r) => !!r.personalized,
};

async function heal(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const snaps = await db`SELECT * FROM taxonomy_snapshots WHERE id = ${id}`;
  if (!snaps.length) { res.status(404).json({ error: 'Not found' }); return; }
  const payload = Array.isArray(snaps[0].payload) ? snaps[0].payload : [];
  const body = (typeof req.body === 'object' && req.body) || {};
  const dryRun = body.dryRun === true || req.query.dryRun === '1';

  const live = await db`
    SELECT id, core, growth_stage, acquisition_age, is_event, event_key, meal_context,
           is_gestalt, gestalt_type, gestalt_meaning, gestalt_target_words,
           descriptive_clues, representation_levels, place_kind,
           audience, authoring_kind, roles_present, objects_present,
           has_relationship, related_images, personalized,
           default_image_key, sort_order, match_terms
    FROM taxonomy`;
  const liveById = new Map(live.map((r) => [r.id, r]));
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const fields = {};                 // column → how many rows it fills
  const updates = [];                // full final value set per changed row
  const notInLive = [];              // snapshot rows deleted since (left deleted)
  for (const s of payload) {
    const cur = liveById.get(s.id);
    if (!cur) { notInLive.push(s.id); continue; }
    const out = {};
    let changed = false;
    for (const c of HEAL_NULLABLE) {
      out[c] = cur[c] ?? s[c] ?? null;
      if (cur[c] == null && s[c] != null) { changed = true; fields[c] = (fields[c] || 0) + 1; }
    }
    for (const [c, fromSnap] of Object.entries(HEAL_DEFAULTED)) {
      out[c] = fromSnap(s);
      if (!same(cur[c], out[c])) { changed = true; fields[c] = (fields[c] || 0) + 1; }
    }
    const have = new Set((cur.match_terms || []).map((t) => String(t).toLowerCase()));
    const add = (Array.isArray(s.match_terms) ? s.match_terms : [])
      .filter((t) => !have.has(String(t).toLowerCase()));
    out.match_terms = add.length ? [...(cur.match_terms || []), ...add] : (cur.match_terms ?? null);
    if (add.length) { changed = true; fields.match_terms = (fields.match_terms || 0) + 1; }
    if (changed) updates.push({ id: s.id, ...out });
  }

  const summary = {
    snapshotId: id,
    snapshotLabel: snaps[0].label,
    matched: payload.length - notInLive.length,
    rowsToHeal: updates.length,
    fields,
    notInLiveCount: notInLive.length,
    notInLive: notInLive.slice(0, 50),
    liveUntouched: live.length - (payload.length - notInLive.length),
  };
  if (dryRun) { res.status(200).json({ ok: true, dryRun: true, ...summary }); return; }

  // Heal is itself reversible: snapshot the current state first.
  const cur = await db`SELECT * FROM taxonomy ORDER BY id`;
  const preLabel = `pre-heal-from-#${id}-${new Date().toISOString()}`;
  await db`
    INSERT INTO taxonomy_snapshots (created_by, label, note, row_count, payload)
    VALUES (${ACTOR}, ${preLabel}, ${'Auto-snapshot before healing from #' + id}, ${cur.length}, ${JSON.stringify(cur)}::jsonb)
  `;

  for (const u of updates) {
    await db`
      UPDATE taxonomy SET
        core = ${u.core}, growth_stage = ${u.growth_stage}, acquisition_age = ${u.acquisition_age},
        is_event = ${u.is_event}, event_key = ${u.event_key}, meal_context = ${u.meal_context},
        is_gestalt = ${u.is_gestalt}, gestalt_type = ${u.gestalt_type},
        gestalt_meaning = ${u.gestalt_meaning},
        gestalt_target_words = ${Array.isArray(u.gestalt_target_words) ? u.gestalt_target_words : null},
        descriptive_clues = ${Array.isArray(u.descriptive_clues) ? u.descriptive_clues : null},
        representation_levels = ${u.representation_levels == null ? null : JSON.stringify(u.representation_levels)}::jsonb,
        place_kind = ${u.place_kind}, audience = ${u.audience}, authoring_kind = ${u.authoring_kind},
        roles_present = ${Array.isArray(u.roles_present) ? u.roles_present : null},
        objects_present = ${Array.isArray(u.objects_present) ? u.objects_present : null},
        has_relationship = ${u.has_relationship},
        related_images = ${Array.isArray(u.related_images) ? u.related_images : null},
        personalized = ${u.personalized}, default_image_key = ${u.default_image_key},
        sort_order = ${Number.isFinite(Number(u.sort_order)) && u.sort_order !== null ? Number(u.sort_order) : null},
        match_terms = ${Array.isArray(u.match_terms) ? u.match_terms : null},
        updated_at = NOW(), updated_by = ${ACTOR}
      WHERE id = ${u.id}
    `;
  }
  await db`
    INSERT INTO taxonomy_audit (actor, action, summary, note)
    VALUES (${ACTOR}, 'heal', ${`healed ${updates.length} rows from snapshot #${id} (non-destructive column fill)`},
            ${JSON.stringify({ fields, notInLiveCount: notInLive.length }).slice(0, 2000)})
  `;
  res.status(200).json({ ok: true, dryRun: false, ...summary, preHealSnapshot: preLabel });
}

async function remove(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const rows = await db`DELETE FROM taxonomy_snapshots WHERE id = ${id} RETURNING id, label`;
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  await db`
    INSERT INTO taxonomy_audit (actor, action, summary)
    VALUES (${ACTOR}, 'snapshot-delete', ${`deleted snapshot #${id} "${rows[0].label || ''}"`})
  `;
  res.status(200).json({ ok: true });
}

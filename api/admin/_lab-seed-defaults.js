// POST /api/admin/lab?action=seed-defaults   (admin only; dispatched from lab.js)
//
// The "default images" system. A DEFAULT-ABLE taxonomy tile — one that never
// references a specific person (no {reference}/{parent_photo}/{family_*}, not a
// People/child_as_subject tile) — looks the same for every kid (ball, in, big,
// hot…). Only the art style would differ, and we deliberately collapse that:
// every board reuses ONE canonical image for these instead of paying a per-child
// generation during onboarding. See isDefaultableTile() + api/onboarding/seed-core.js.
//
// SOURCE OF THE DEFAULT IMAGE: the reference board (Fletcher's, by default). Those
// tiles already exist and are drawn in a single consistent style, so we simply
// COPY each one's Blob into a stable taxonomy-defaults/ location and record the
// key on taxonomy.default_image_key. Copying (rather than pointing straight at
// Fletcher's item key) decouples the shared default from his board's lifecycle —
// re-generating or deleting a tile on his board can't break every other kid's.
//
// MATCHING the reference board's tiles to taxonomy rows: by items.taxonomy_slug
// first (populated by onboarding or the "Backfill slugs" tool); if that yields
// nothing (an old board that was never slug-linked), we FALL BACK to matching by
// label (unambiguous default-able labels only). Taxonomy status is NOT required —
// copying a default is harmless on a draft row, and it lets apply-mode repoint a
// live board even where the canonical row hasn't been published yet.
//
// Two modes (both chunked/resumable — call repeatedly until { done:true }):
//   mode=populate (default)            — copy the reference board's default-able
//     ?sourceChildId=<slug>              tiles into taxonomy.default_image_key
//     ?force=1                           re-copy even tiles that already have one
//   mode=apply&childId=<id>            — repoint an EXISTING child's default-able
//                                        items at the shared defaults + re-voice
//                                        them, so a board built before defaults
//                                        existed picks them up without re-onboarding.
//
// Response: { ok, mode, done, nextOffset, total, processed|updated, failed, note }.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { isDefaultableTile, readBlobBytes,
         loadChildVoiceId, synthesizeVoice, mapPool } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 300 };

// The board whose already-rendered tiles seed the shared defaults.
const DEFAULT_SOURCE_CHILD = 'fletcherpeterson';

// Per-call budgets. Both modes are just a Blob copy / TTS + tiny DB write per
// tile (no image generation), so they can move briskly.
const POPULATE_BUDGET = 30;
const APPLY_BUDGET = 24;

const norm = (s) => String(s || '').trim().toLowerCase();

// Map of normalized label → the single default-able taxonomy row with that label.
// Ambiguous labels (two default-able rows share one) are dropped so a label-based
// match is never wrong. Used as the fallback when items aren't slug-linked.
async function defaultableLabelMap(db) {
  const tax = await db`
    SELECT id, column_name, subcategory, category, label, prompt_template, subject_mode, default_image_key
    FROM taxonomy WHERE COALESCE(archived, FALSE) = FALSE`;
  const map = new Map(); const dup = new Set();
  for (const t of tax) {
    if (!isDefaultableTile(t)) continue;
    const k = norm(t.label); if (!k) continue;
    if (map.has(k)) dup.add(k); else map.set(k, t);
  }
  for (const k of dup) map.delete(k);
  return map;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const mode = String((req.query && req.query.mode) || 'populate');
  const db = sql();
  try {
    if (mode === 'apply') return await applyToChild(req, res, db, gate);
    if (mode === 'cats')  return await populateCats(req, res, db);
    return await populate(req, res, db);
  } catch (err) {
    res.status(500).json({ error: 'seed-defaults failed', mode, detail: String(err.message || err) });
  }
}

// ── mode=populate ────────────────────────────────────────────────────────────
async function populate(req, res, db) {
  const force = String((req.query && req.query.force) || '') === '1';
  const explicitSource = String((req.query && req.query.sourceChildId) || '').trim();
  const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);

  // Pick the reference board. Prefer the explicit ?sourceChildId, else Fletcher's;
  // if that board has no tiles with images and none was named, auto-detect the
  // board with the most images so a mis-remembered slug never yields "0 of 0".
  let sourceChildId = explicitSource || DEFAULT_SOURCE_CHILD;
  const imageCount = async (cid) => Number((await db`
    SELECT COUNT(*)::int AS c FROM items WHERE child_id = ${cid} AND image_key IS NOT NULL`)[0]?.c || 0);
  let sourceImages = await imageCount(sourceChildId);
  if (!explicitSource && sourceImages === 0) {
    const best = await db`
      SELECT child_id, COUNT(*)::int AS c FROM items
      WHERE child_id IS NOT NULL AND image_key IS NOT NULL
      GROUP BY child_id ORDER BY c DESC LIMIT 1`;
    if (best.length && best[0].c > 0) { sourceChildId = best[0].child_id; sourceImages = Number(best[0].c); }
  }

  // Gather the sources once, then fill every default-able taxonomy row from the
  // best available image, in priority order:
  //   1. the reference board's slug-linked item image (what the child sees today)
  //   2. the Lab's ★ marked-best generation for that row (already generated,
  //      just never pushed to a board)
  //   3. label fill — another default-able row with the SAME word already has a
  //      default (e.g. "train" in Vehicles and in Toys) → reuse its key
  //   4. reference-board item with the same label (old boards without slug links)
  const [tax, boardItems, bestGens] = await Promise.all([
    db`SELECT id, column_name, subject_mode, prompt_template, label, default_image_key
       FROM taxonomy WHERE COALESCE(archived, FALSE) = FALSE ORDER BY id`,
    db`SELECT taxonomy_slug, label, image_key FROM items
       WHERE child_id = ${sourceChildId} AND image_key IS NOT NULL`,
    // Best available Lab generation per tile: the ★ starred one first, then the
    // highest-rated, then the newest. blob_key OR blob_url — early Lab rows
    // predate the blob_key column and only carry the URL, which is exactly why
    // hundreds of vetted tiles used to be skipped as "no source".
    db`SELECT DISTINCT ON (taxonomy_id) taxonomy_id, blob_key, blob_url, marked_best
       FROM tile_generations
       WHERE blob_key IS NOT NULL OR blob_url IS NOT NULL
       ORDER BY taxonomy_id, marked_best DESC, rating DESC NULLS LAST, created_at DESC`,
  ]);

  const bySlug = new Map();
  const byItemLabel = new Map();
  for (const i of boardItems) {
    if (i.taxonomy_slug && !bySlug.has(i.taxonomy_slug)) bySlug.set(i.taxonomy_slug, i.image_key);
    const k = norm(i.label);
    if (k && !byItemLabel.has(k)) byItemLabel.set(k, i.image_key);
  }
  const byBest = new Map(bestGens.map((g) => [g.taxonomy_id, { key: g.blob_key, url: g.blob_url, starred: !!g.marked_best }]));
  const defaultKeyByLabel = new Map();   // label → an already-set default key
  const defaultable = tax.filter(isDefaultableTile);
  for (const t of defaultable) {
    const k = norm(t.label);
    if (t.default_image_key && k && !defaultKeyByLabel.has(k)) defaultKeyByLabel.set(k, t.default_image_key);
  }

  // Work list: default-able rows that need a default, with their chosen source.
  const pending = [];
  const noSource = [];
  let fromUnstarred = 0;
  for (const t of defaultable) {
    if (t.default_image_key && !force) continue;
    const boardKey = bySlug.get(t.id) || null;
    const gen = byBest.get(t.id) || null;
    const labelKey = defaultKeyByLabel.get(norm(t.label)) || null;       // reuse, no copy
    const labelSrc = byItemLabel.get(norm(t.label)) || null;            // copy
    if (boardKey) pending.push({ tax_id: t.id, srcKey: boardKey, via: 'board' });
    else if (gen) {
      if (!gen.starred) fromUnstarred++;
      pending.push({ tax_id: t.id, srcKey: gen.key, srcUrl: gen.url, via: 'lab' });
    }
    else if (labelKey) pending.push({ tax_id: t.id, reuseKey: labelKey, via: 'label-reuse' });
    else if (labelSrc) pending.push({ tax_id: t.id, srcKey: labelSrc, via: 'label-board' });
    else noSource.push(t.label);
  }
  const total = pending.length;
  const slice = pending.slice(offset, offset + POPULATE_BUDGET);

  // Read source bytes by key (private Blob) with a URL fallback — early Lab
  // rows only have blob_url, and some uploads are public where the private
  // getter errors. Either path yields the same bytes.
  async function fetchSource(row) {
    if (row.srcKey) {
      try { return await readBlobBytes(row.srcKey); } catch (_) { /* fall through */ }
    }
    if (row.srcUrl) {
      const r = await fetch(row.srcUrl);
      if (!r.ok) throw new Error('source fetch ' + r.status);
      return { buffer: Buffer.from(await r.arrayBuffer()),
               contentType: r.headers.get('content-type') || 'image/png' };
    }
    throw new Error('no readable source');
  }

  const results = await mapPool(slice, 4, async (row) => {
    if (row.reuseKey) {
      // Same word, another category — point at the existing default, no new blob.
      await db`UPDATE taxonomy SET default_image_key = ${row.reuseKey}, updated_at = NOW() WHERE id = ${row.tax_id}`;
      return row.reuseKey;
    }
    const { buffer, contentType } = await fetchSource(row);
    const ext = (String(contentType || '').includes('jpeg') || String(contentType || '').includes('jpg')) ? 'jpg' : 'png';
    const key = `taxonomy-defaults/${row.tax_id}/${randomUUID()}.${ext}`;
    await put(key, buffer, { access: 'private', contentType: contentType || 'image/png', addRandomSuffix: false });
    await db`UPDATE taxonomy SET default_image_key = ${key}, updated_at = NOW() WHERE id = ${row.tax_id}`;
    return key;
  });

  let processed = 0, failed = 0;
  for (const r of results) { if (r && r.ok) processed++; else failed++; }
  const nextOffset = offset + slice.length;
  const done = nextOffset >= total;

  let note = `${defaultable.length} default-able rows; ${total} fillable this run` +
    (fromUnstarred ? ` (${fromUnstarred} from unstarred Lab generations — audit them on the Default board)` : '') +
    `; ${noSource.length} have no image anywhere (need Lab generation first)` +
    (noSource.length ? `: ${noSource.slice(0, 8).join(', ')}${noSource.length > 8 ? '…' : ''}` : '.');
  let diag;
  if (total === 0 && offset === 0) {
    diag = { sourceChildId, itemsWithImage: sourceImages, labGenerations: byBest.size, defaultable: defaultable.length, noSource: noSource.slice(0, 20) };
    note = `Nothing fillable: ${defaultable.length} default-able rows, ${byBest.size} Lab generations, ${sourceImages} board images on "${sourceChildId}".` +
      (noSource.length ? ` Missing everywhere (${noSource.length}): ${noSource.slice(0, 10).join(', ')}…` : '');
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true, mode: 'populate', done, nextOffset, total, processed, failed,
    sourceChildId, defaultableCount: defaultable.length, note, ...(diag ? { diag } : {}),
  });
}

// ── mode=apply ───────────────────────────────────────────────────────────────
async function applyToChild(req, res, db, gate) {
  const childId = String((req.query && req.query.childId) || '').trim();
  if (!childId) { res.status(400).json({ error: 'childId required for apply mode' }); return; }
  const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);

  // Primary: the child's items whose taxonomy row (by slug) is default-able AND
  // has a default image, that aren't already pointing at it.
  const linked = await db`
    SELECT i.id AS item_id, i.label, i.image_key,
           t.default_image_key, t.column_name, t.subject_mode, t.prompt_template
    FROM items i
    JOIN taxonomy t ON t.id = i.taxonomy_slug
    WHERE i.child_id = ${childId}
      AND t.default_image_key IS NOT NULL
      AND i.image_key IS DISTINCT FROM t.default_image_key
    ORDER BY i.id`;
  let eligible = linked.filter(isDefaultableTile);
  let matchedBy = 'slug';

  // Fallback: not slug-linked → match by label to default-able rows that have a
  // default image.
  if (eligible.length === 0) {
    const [map, items] = await Promise.all([
      defaultableLabelMap(db),
      db`SELECT id AS item_id, label, image_key FROM items WHERE child_id = ${childId} AND image_key IS NOT NULL`,
    ]);
    const alt = [];
    for (const it of items) {
      const t = map.get(norm(it.label));
      if (!t || !t.default_image_key || it.image_key === t.default_image_key) continue;
      alt.push({ item_id: it.item_id, label: it.label, image_key: it.image_key,
                 default_image_key: t.default_image_key, column_name: t.column_name,
                 subject_mode: t.subject_mode, prompt_template: t.prompt_template });
    }
    if (alt.length) { eligible = alt; matchedBy = 'label'; }
  }

  const total = eligible.length;
  const slice = eligible.slice(offset, offset + APPLY_BUDGET);
  const childVoiceId = await loadChildVoiceId(db, childId);

  const results = await mapPool(slice, 4, async (row) => {
    // Re-voice in the child's own voice (best-effort). The image just repoints to
    // the shared default key — no per-child copy needed; api/media.js serves a
    // shared library key to any authorized owner.
    let soundKey = null;
    const mp3 = await synthesizeVoice({ text: row.label, voiceId: childVoiceId });
    if (mp3) {
      soundKey = `onboarding/${childId}/voice/${randomUUID()}.mp3`;
      await put(soundKey, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
    }
    await db`UPDATE items
               SET image_key = ${row.default_image_key},
                   sound_key = COALESCE(${soundKey}, sound_key),
                   updated_at = NOW()
             WHERE id = ${row.item_id}`;
    return row.item_id;
  });

  let updated = 0, failed = 0;
  for (const r of results) { if (r && r.ok) updated++; else failed++; }
  const nextOffset = offset + slice.length;
  const done = nextOffset >= total;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true, mode: 'apply', childId, matchedBy, done, nextOffset, total, updated, failed,
    note: `${total} default-able items on this board can adopt a default image (matched by ${matchedBy}).`,
  });
}


// ── mode=cats — folder-icon defaults ─────────────────────────────────────────
// Copy the reference board's category/subcategory chip images into the shared
// category_defaults store (keyed by section + normalized label). /api/sync
// read-throughs these onto any board whose chip has no custom icon — which is
// what fills the blank folder chips on boards built before icons existed.
async function populateCats(req, res, db) {
  const force = String((req.query && req.query.force) || '') === '1';
  const sourceChildId = String((req.query && req.query.sourceChildId) || DEFAULT_SOURCE_CHILD).trim();
  const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);

  await db`
    CREATE TABLE IF NOT EXISTS category_defaults (
      id BIGSERIAL PRIMARY KEY,
      section TEXT NOT NULL,
      label_norm TEXT NOT NULL,
      image_key TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (section, label_norm)
    )`;

  const [chips, existing] = await Promise.all([
    db`SELECT section, label, image_key FROM categories
       WHERE child_id = ${sourceChildId} AND image_key IS NOT NULL
       ORDER BY section, label`,
    db`SELECT section, label_norm FROM category_defaults`,
  ]);
  const have = new Set(existing.map((e) => e.section + '|' + e.label_norm));
  const seen = new Set();
  const pending = chips.filter((c) => {
    const k = c.section + '|' + norm(c.label);
    if (seen.has(k)) return false;
    seen.add(k);
    return force || !have.has(k);
  });
  const total = pending.length;
  const slice = pending.slice(offset, offset + POPULATE_BUDGET);

  const results = await mapPool(slice, 4, async (c) => {
    const { buffer, contentType } = await readBlobBytes(c.image_key);
    const ext = (String(contentType || '').includes('jpeg') || String(contentType || '').includes('jpg')) ? 'jpg' : 'png';
    const key = `category-defaults/${c.section}/${randomUUID()}.${ext}`;
    await put(key, buffer, { access: 'private', contentType: contentType || 'image/png', addRandomSuffix: false });
    await db`INSERT INTO category_defaults (section, label_norm, image_key)
             VALUES (${c.section}, ${norm(c.label)}, ${key})
             ON CONFLICT (section, label_norm) DO UPDATE SET image_key = ${key}, updated_at = NOW()`;
    return key;
  });
  let processed = 0, failed = 0;
  for (const r of results) { if (r && r.ok) processed++; else failed++; }
  const nextOffset = offset + slice.length;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true, mode: 'cats', done: nextOffset >= total, nextOffset, total, processed, failed,
    sourceChildId,
    note: `${chips.length} folder chips with icons on ${sourceChildId}; ${total} ${force ? 'to (re)copy' : 'missing a default'}.`,
  });
}

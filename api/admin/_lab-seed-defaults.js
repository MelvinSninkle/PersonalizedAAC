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

  // Primary: the reference board's tiles joined to their taxonomy row by slug.
  // NB: no status filter — copying a default is fine on a draft row. Dedupe by
  // taxonomy id (first item on a slug wins).
  const linked = await db`
    SELECT t.id AS tax_id, t.column_name, t.subject_mode, t.prompt_template,
           t.default_image_key, i.image_key AS src_key
    FROM items i
    JOIN taxonomy t ON t.id = i.taxonomy_slug
    WHERE i.child_id = ${sourceChildId}
      AND i.image_key IS NOT NULL
      AND COALESCE(t.archived, FALSE) = FALSE
    ORDER BY t.id`;
  const seen = new Set();
  let defaultable = linked.filter((r) => {
    if (seen.has(r.tax_id) || !isDefaultableTile(r)) return false;
    seen.add(r.tax_id); return true;
  });
  let matchedBy = 'slug';

  // Fallback: no slug-linked default-able tiles → match this board's item labels
  // to unambiguous default-able taxonomy labels.
  if (defaultable.length === 0) {
    const [map, items] = await Promise.all([
      defaultableLabelMap(db),
      db`SELECT label, image_key FROM items WHERE child_id = ${sourceChildId} AND image_key IS NOT NULL`,
    ]);
    const seen2 = new Set(); const alt = [];
    for (const it of items) {
      const t = map.get(norm(it.label));
      if (!t || seen2.has(t.id)) continue;
      seen2.add(t.id);
      alt.push({ tax_id: t.id, column_name: t.column_name, subject_mode: t.subject_mode,
                 prompt_template: t.prompt_template, default_image_key: t.default_image_key, src_key: it.image_key });
    }
    if (alt.length) { defaultable = alt; matchedBy = 'label'; }
  }

  const pending = defaultable.filter((t) => force || !t.default_image_key);
  const total = pending.length;
  const slice = pending.slice(offset, offset + POPULATE_BUDGET);

  const results = await mapPool(slice, 4, async (row) => {
    const { buffer, contentType } = await readBlobBytes(row.src_key);
    const ext = String(contentType || '').includes('png') ? 'png'
              : (String(contentType || '').includes('jpeg') || String(contentType || '').includes('jpg')) ? 'jpg' : 'png';
    const key = `taxonomy-defaults/${row.tax_id}/${randomUUID()}.${ext}`;
    await put(key, buffer, { access: 'private', contentType: contentType || 'image/png', addRandomSuffix: false });
    await db`UPDATE taxonomy SET default_image_key = ${key}, updated_at = NOW() WHERE id = ${row.tax_id}`;
    return key;
  });

  let processed = 0, failed = 0;
  for (const r of results) { if (r && r.ok) processed++; else failed++; }
  const nextOffset = offset + slice.length;
  const done = nextOffset >= total;

  // If there's genuinely nothing to do, say WHY.
  let note = `${defaultable.length} default-able tiles on ${sourceChildId} (matched by ${matchedBy}); ${total} ${force ? 'to (re)copy' : 'missing a default'}.`;
  let diag;
  if (defaultable.length === 0 && offset === 0) {
    diag = { sourceChildId, itemsWithImage: sourceImages, slugLinkedRows: linked.length };
    note = sourceImages === 0
      ? `Reference board "${sourceChildId}" has no tiles with images — pass ?sourceChildId=<slug> for the right board.`
      : `"${sourceChildId}" has ${sourceImages} tiles but none matched a default-able taxonomy row (by slug or label).`;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true, mode: 'populate', done, nextOffset, total, processed, failed,
    sourceChildId, matchedBy, defaultableCount: defaultable.length, note, ...(diag ? { diag } : {}),
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

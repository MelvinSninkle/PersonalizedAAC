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
  const sourceChildId = String((req.query && req.query.sourceChildId) || DEFAULT_SOURCE_CHILD).trim();
  const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);

  // Drive from the reference board's own tiles (joined to their taxonomy row) so
  // we only ever try to copy images that actually exist, and the default set is
  // exactly what that board already shows. Deterministic order → stable cursor.
  const rows = await db`
    SELECT t.id AS tax_id, t.column_name, t.subject_mode, t.prompt_template,
           t.default_image_key, i.image_key AS src_key
    FROM items i
    JOIN taxonomy t ON t.id = i.taxonomy_slug
    WHERE i.child_id = ${sourceChildId}
      AND i.image_key IS NOT NULL
      AND t.status = 'published'
      AND COALESCE(t.archived, FALSE) = FALSE
    ORDER BY t.id`;

  // Keep only the default-able tiles (isDefaultableTile reads column_name /
  // subject_mode / prompt_template), and drop dupes if the source board happens
  // to have two items on the same taxonomy slug (first one wins).
  const seen = new Set();
  const defaultable = rows.filter((r) => {
    if (seen.has(r.tax_id)) return false;
    if (!isDefaultableTile(r)) return false;
    seen.add(r.tax_id);
    return true;
  });
  const pending = defaultable.filter((t) => force || !t.default_image_key);
  const total = pending.length;
  const slice = pending.slice(offset, offset + POPULATE_BUDGET);

  const results = await mapPool(slice, 4, async (row) => {
    // Copy the reference tile's bytes into a stable defaults path.
    const { buffer, contentType } = await readBlobBytes(row.src_key);
    const ext = String(contentType || '').includes('png') ? 'png'
              : String(contentType || '').includes('jpeg') || String(contentType || '').includes('jpg') ? 'jpg' : 'png';
    const key = `taxonomy-defaults/${row.tax_id}/${randomUUID()}.${ext}`;
    await put(key, buffer, { access: 'private', contentType: contentType || 'image/png', addRandomSuffix: false });
    await db`UPDATE taxonomy SET default_image_key = ${key}, updated_at = NOW() WHERE id = ${row.tax_id}`;
    return key;
  });

  let processed = 0, failed = 0;
  for (const r of results) { if (r && r.ok) processed++; else failed++; }
  const nextOffset = offset + slice.length;
  const done = nextOffset >= total;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true, mode: 'populate', done, nextOffset, total, processed, failed,
    sourceChildId, defaultableCount: defaultable.length,
    note: `${defaultable.length} default-able tiles on ${sourceChildId}; ${total} ${force ? 'to (re)copy' : 'missing a default'}.`,
  });
}

// ── mode=apply ───────────────────────────────────────────────────────────────
async function applyToChild(req, res, db, gate) {
  const childId = String((req.query && req.query.childId) || '').trim();
  if (!childId) { res.status(400).json({ error: 'childId required for apply mode' }); return; }
  const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);

  // The child's items whose taxonomy row is default-able AND has a default image,
  // that aren't already pointing at it. Join items → taxonomy on taxonomy_slug = id.
  const rows = await db`
    SELECT i.id AS item_id, i.label, i.image_key,
           t.default_image_key, t.column_name, t.subject_mode, t.prompt_template
    FROM items i
    JOIN taxonomy t ON t.id = i.taxonomy_slug
    WHERE i.child_id = ${childId}
      AND t.default_image_key IS NOT NULL
      AND i.image_key IS DISTINCT FROM t.default_image_key
    ORDER BY i.id`;

  const eligible = rows.filter(isDefaultableTile);
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
    ok: true, mode: 'apply', childId, done, nextOffset, total, updated, failed,
    note: `${total} default-able items on this board can adopt a default image.`,
  });
}

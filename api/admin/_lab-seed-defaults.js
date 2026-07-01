// POST /api/admin/lab?action=seed-defaults   (admin only; dispatched from lab.js)
//
// The "default images" system. A GENERIC taxonomy tile — one whose prompt_template
// has no {placeholder}, so it never references the child, a parent, or the chosen
// art style — renders identically for every kid (ball, cup, more, help…). Instead
// of paying a per-child image generation for each of those during onboarding, we
// render ONE canonical image per generic tile here (a one-time admin job), stash
// its Blob key on taxonomy.default_image_key, and let onboarding/seed-core point
// every child's item straight at that shared key (still voicing it in the child's
// own voice). See api/onboarding/seed-core.js for the consumer side.
//
// Two modes (both chunked/resumable — call repeatedly until { done:true }):
//   mode=populate (default)            — render + store defaults for generic tiles
//     ?force=1                           re-render even tiles that already have one
//   mode=apply&childId=<id>            — repoint an EXISTING child's generic items
//                                        at the shared defaults + re-voice them, so
//                                        a board built before defaults existed picks
//                                        them up without a full re-onboard.
//
// Response: { ok, mode, done, nextOffset, total, processed, updated?, failed, note }.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { loadStyleGuide, renderTaxonomyTile, isGenericTemplate,
         loadChildVoiceId, synthesizeVoice, mapPool } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 300 };

// Per-call budgets. populate does a real image generation per tile (~5-10s on
// Flash) so keep it modest; apply is just a TTS + tiny DB update per tile.
const POPULATE_BUDGET = 10;
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
  const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);

  // Every published, non-archived tile is a candidate; we filter to the generic
  // ones (no {placeholder}) in JS so the definition stays in one place
  // (isGenericTemplate). Deterministic order so the offset cursor is stable.
  const rows = await db`
    SELECT id, id AS slug, column_name, category, subcategory, label, prompt_template, subject_mode, default_image_key
    FROM taxonomy
    WHERE status = 'published'
      AND COALESCE(archived, FALSE) = FALSE
      AND COALESCE(is_event, FALSE) = FALSE
      AND COALESCE(is_gestalt, FALSE) = FALSE
    ORDER BY column_name, category NULLS LAST, label, id`;

  const generic = rows.filter((t) => isGenericTemplate(t.prompt_template));
  const pending = generic.filter((t) => force || !t.default_image_key);
  const total = pending.length;
  const slice = pending.slice(offset, offset + POPULATE_BUDGET);

  // Neutral house style so every board's generic tiles look the same regardless
  // of the child's own chosen art style. No subject anchor — these never depict a
  // person. Falls back to text-only style if no active guide exists.
  const [styleGuide, settingsRows] = await Promise.all([
    loadStyleGuide(db, null).catch(() => null),
    db`SELECT master_prompt, size_default FROM lab_settings WHERE id = 1`,
  ]);
  const settings = settingsRows[0] || { master_prompt: '', size_default: '1024x1024' };

  const results = await mapPool(slice, 3, async (tax) => {
    const r = await renderTaxonomyTile({ tax, styleGuide, childAnchor: null, settings });
    if (!r.ok) throw new Error(r.detail || 'render failed');
    const png = Buffer.from(r.b64, 'base64');
    const key = `taxonomy-defaults/${tax.id}/${randomUUID()}.png`;
    await put(key, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
    await db`UPDATE taxonomy SET default_image_key = ${key}, updated_at = NOW() WHERE id = ${tax.id}`;
    return key;
  });

  let processed = 0, failed = 0;
  for (const r of results) { if (r && r.ok) processed++; else failed++; }
  const nextOffset = offset + slice.length;
  const done = nextOffset >= total;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true, mode: 'populate', done, nextOffset, total,
    processed, failed, genericCount: generic.length,
    note: `${generic.length} generic tiles; ${total} ${force ? 'to (re)render' : 'missing a default'}.`,
  });
}

// ── mode=apply ───────────────────────────────────────────────────────────────
async function applyToChild(req, res, db, gate) {
  const childId = String((req.query && req.query.childId) || '').trim();
  if (!childId) { res.status(400).json({ error: 'childId required for apply mode' }); return; }
  const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);

  // The child's items whose taxonomy row is generic AND has a default image, that
  // aren't already pointing at it. Join items → taxonomy on taxonomy_slug = id.
  const rows = await db`
    SELECT i.id AS item_id, i.label, i.image_key, t.default_image_key, t.prompt_template
    FROM items i
    JOIN taxonomy t ON t.id = i.taxonomy_slug
    WHERE i.child_id = ${childId}
      AND t.default_image_key IS NOT NULL
      AND i.image_key IS DISTINCT FROM t.default_image_key
    ORDER BY i.id`;

  const eligible = rows.filter((r) => isGenericTemplate(r.prompt_template));
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
    note: `${total} generic items on this board can adopt a default image.`,
  });
}

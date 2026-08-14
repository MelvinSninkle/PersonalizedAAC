// /api/admin/lab?action=tile-lab  (admin only)
// Body JSON: { photoB64, photoType?, label?, detail?, section?, styleGuideId?,
//              noStyle?, model?, priorB64?, siblingKeys?, noStuffRef? }
//
// Siblings A/B experiment: `siblingKeys` (≤3 blob keys of same-board tiles)
// ride as extra style references, and `noStuffRef: true` suppresses the
// style guide's objects reference — the three arms are today's stack (neither
// param), siblings-instead (both), and both-references (siblingKeys alone).
// Bench-only: no production path sets either.
//
// A Lab bench for the ADD-TILE photo pipeline — the exact renderStyledPhoto
// the iPad's add flow runs (style-guide attachment, people → keystone-portrait
// branch, objects → nano), so what you see here is what a parent gets.
//
// Retry iteration: pass `priorB64` (the previous result) + `detail` (the
// correction) and the bench runs the REAL guided-retry edit pass — the prior
// image alone plus the correction, no reference stack — exactly what the
// board's guided retry does in production. With `priorB64` but no `detail`
// it's a blind re-roll from the photo, also matching production. `noStyle`
// disables the style guide entirely (raw-photo restyle, no style matching).
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { loadStyleGuide, readBlobBytes } from '../_lib/onboarding-render.js';
import { renderStyledPhoto } from '../_lib/tile-jobs.js';

// BENCH loader for an explicit styleGuideId: unlike loadStyleGuide (which
// demands active = TRUE — production must never render a family's board with
// an unpublished style), the admin bench may test DRAFT/inactive styles and
// any family's own guide by id. requireAdmin gates this file (C8: per-request
// styleGuideId overrides are admin-only). Falls back to loadStyleGuide's
// resolution when no id is given.
async function loadBenchStyle(db, styleGuideId) {
  if (!styleGuideId) return loadStyleGuide(db, null);
  let row;
  try {
    row = (await db`SELECT id, label, description, blob_key, person_ref_key, stuff_ref_key
                    FROM style_guides WHERE id = ${styleGuideId} LIMIT 1`)[0] || null;
  } catch (_) {
    row = (await db`SELECT id, label, description, blob_key
                    FROM style_guides WHERE id = ${styleGuideId} LIMIT 1`)[0] || null;
  }
  if (!row) {
    throw Object.assign(new Error('style guide not found'), { status: 404, code: 'style_not_found' });
  }
  let image = null;
  if (row.blob_key) { try { image = await readBlobBytes(row.blob_key); } catch (_) {} }
  return { id: Number(row.id), label: row.label, description: row.description || '',
           blob_key: row.blob_key, person_ref_key: row.person_ref_key || null,
           stuff_ref_key: row.stuff_ref_key || null, image };
}

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const strip = (v) => typeof v === 'string' ? v.replace(/^data:[^;]+;base64,/, '') : '';
  const photoB64 = strip(b.photoB64);
  const priorB64 = strip(b.priorB64);
  if (!photoB64 && !priorB64) { res.status(400).json({ error: 'photoB64 (base64 image) required' }); return; }
  const photoType = typeof b.photoType === 'string' ? b.photoType : 'image/jpeg';
  const label = typeof b.label === 'string' ? b.label.slice(0, 80) : '';
  const detail = typeof b.detail === 'string' ? b.detail.slice(0, 400) : '';
  const section = b.section === 'people' ? 'people' : 'nouns';
  // Bench the People branch's age treatment: 'adult' | 'child' | omitted
  // (apparent-age fallback) — mirrors relationship-derived production values.
  const ageGroup = (b.ageGroup === 'adult' || b.ageGroup === 'child') ? b.ageGroup : null;
  const model = typeof b.model === 'string' && b.model ? b.model.slice(0, 60) : null;
  const noStyle = b.noStyle === true;
  const styleGuideId = Number.isFinite(Number(b.styleGuideId)) && Number(b.styleGuideId) > 0 ? Number(b.styleGuideId) : null;
  // Siblings experiment (admin-gated, so cross-board key reads are the
  // admin's existing privilege — same short-circuit /api/media relies on).
  const siblingKeys = Array.isArray(b.siblingKeys)
    ? b.siblingKeys.filter((k) => typeof k === 'string' && k && !k.startsWith('data:')).slice(0, 3)
    : [];
  const noStuffRef = b.noStuffRef === true;

  try {
    const db = sql();
    let styleGuide = null;
    if (!noStyle) {
      try { styleGuide = await loadBenchStyle(db, styleGuideId); }
      catch (e) { res.status(e.status || 400).json({ error: e.message || 'style load failed' }); return; }
    }

    // Retry mode: the correction runs as the production edit pass — prior
    // image + guidance, no photo, no reference stack. The photo (or the prior,
    // when only that was sent) still rides as `photo` so a retry WITHOUT a
    // correction falls through to the normal full render, same as production.
    const retryMode = !!(priorB64 && detail);
    const photo = Buffer.from(photoB64 || priorB64, 'base64');

    const r = await renderStyledPhoto({
      db, photo, contentType: photoB64 ? photoType : 'image/png',
      label, detail: retryMode ? '' : detail,
      style: 'soft, friendly children\'s illustration',
      styleGuide, model, bg: '', section, ageGroup,
      guidance: retryMode ? detail : '',
      prior: retryMode ? { buffer: Buffer.from(priorB64, 'base64'), contentType: 'image/png' } : null,
      // First renders only — the retry edit pass carries the prior image
      // alone and ignores the reference stack by construction.
      siblingRefKeys: siblingKeys, noStuffRef,
    });
    if (!r.ok) { res.status(502).json({ error: 'generation failed', detail: r.detail || '' }); return; }

    res.status(200).json({
      ok: true,
      b64: r.b64,
      prompt: r.prompt,
      engine: r.model || null,
      costCents: r.costCents ?? null,
      styleImageAttached: !!(styleGuide && styleGuide.image && styleGuide.image.buffer),
      styleGuideId: styleGuide ? styleGuide.id : null,
      styleLabel: styleGuide ? styleGuide.label : null,
      retriedFromPrior: retryMode,
      siblingCount: siblingKeys.length,
      siblingKeysAttached: siblingKeys,
      stuffRefAttached: !!(styleGuide && styleGuide.stuff_ref_key && !noStuffRef),
      // The EXACT image stack that rode along, in legend order — the bench
      // renders these as thumbnails so "what references were sent?" is
      // answered visually, not by decoding pills.
      refs: r.refs || [],
    });
  } catch (err) {
    res.status(500).json({ error: 'tile-lab failed', detail: String(err.message || err) });
  }
}

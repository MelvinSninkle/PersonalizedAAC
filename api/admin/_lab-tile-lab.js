// /api/admin/lab?action=tile-lab  (admin only)
// Body JSON: { photoB64, photoType?, label?, detail?, section?, styleGuideId?,
//              noStyle?, model?, priorB64? }
//
// A Lab bench for the ADD-TILE photo pipeline — the exact renderStyledPhoto
// the iPad's add flow runs (style-guide attachment, people → keystone-portrait
// branch, objects → nano), so what you see here is what a parent gets.
//
// Retry iteration: pass `priorB64` (the previous result) + `detail` (the
// correction) and the bench re-renders FROM the prior image with the guidance
// applied — mirroring the board's guided retry. `noStyle` disables the style
// guide entirely (the raw-photo restyle with no style matching).
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { loadStyleGuide } from '../_lib/onboarding-render.js';
import { renderStyledPhoto } from '../_lib/tile-jobs.js';

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

  try {
    const db = sql();
    let styleGuide = null;
    if (!noStyle) {
      try { styleGuide = await loadStyleGuide(db, styleGuideId); }
      catch (e) { res.status(e.status || 400).json({ error: e.message || 'style load failed' }); return; }
    }

    // Retry mode: render FROM the previous result (that's what the board's
    // guided retry does — improve this picture, don't re-roll the photo).
    const sourceB64 = priorB64 || photoB64;
    const photo = Buffer.from(sourceB64, 'base64');

    const r = await renderStyledPhoto({
      db, photo, contentType: priorB64 ? 'image/png' : photoType,
      label, detail, style: 'soft, friendly children\'s illustration',
      styleGuide, model, bg: '', section, ageGroup,
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
      retriedFromPrior: !!priorB64,
    });
  } catch (err) {
    res.status(500).json({ error: 'tile-lab failed', detail: String(err.message || err) });
  }
}

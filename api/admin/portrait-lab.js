// POST /api/admin/portrait-lab  (admin only)
// Body JSON: { photoB64, photoType?, styleGuideId?, guidance?, attempt? }
//
// A Lab bench for the ONBOARDING people-portrait generation. Uses the exact same
// shared prompt builder (buildPortraitPrompt) and image composition as the real
// onboarding flow (api/onboarding/family.js), so what you see here is what a
// parent gets. Returns the generated image + the literal prompt sent to Gemini,
// for fast iteration on style/likeness. Does not touch onboarding state.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { geminiKey, geminiProModel, geminiGenerateImage } from '../_lib/gemini.js';
import { loadStyleGuide, buildPortraitPrompt } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const photoB64 = typeof b.photoB64 === 'string' ? b.photoB64.replace(/^data:[^;]+;base64,/, '') : '';
  if (!photoB64) { res.status(400).json({ error: 'photoB64 (base64 image) required' }); return; }
  const photoType = typeof b.photoType === 'string' ? b.photoType : 'image/jpeg';
  const styleGuideId = Number.isFinite(Number(b.styleGuideId)) && Number(b.styleGuideId) > 0 ? Number(b.styleGuideId) : null;
  const guidance = typeof b.guidance === 'string' ? b.guidance.slice(0, 300) : '';
  const attempt = Number.isFinite(Number(b.attempt)) ? Math.min(5, Math.max(0, Math.floor(Number(b.attempt)))) : 0;

  try {
    const gKey = geminiKey();
    if (!gKey) { res.status(500).json({ error: 'GEMINI_API_KEY not configured' }); return; }
    const db = sql();

    // loadStyleGuide throws style_not_found if a specific id is missing — surface it.
    let styleGuide = null;
    try { styleGuide = await loadStyleGuide(db, styleGuideId); }
    catch (e) { res.status(e.status || 400).json({ error: e.message || 'style load failed' }); return; }

    const images = [];
    if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
      images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
    }
    images.push({ buffer: Buffer.from(photoB64, 'base64'), contentType: photoType });

    const prompt = buildPortraitPrompt({ styleGuide, attempt, guidance });
    const g = await geminiGenerateImage({ apiKey: gKey, model: geminiProModel(), prompt, images, aspectRatio: '1:1' });
    if (!g.ok) { res.status(g.status || 502).json({ error: 'Render failed', detail: (g.detail || '').slice(0, 300), prompt }); return; }

    // Light cost log (role excluded from parent quota).
    try {
      await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, reference_keys, size, cost_cents)
               VALUES (${'__lab__'}, ${gate.email || null}, 'portrait_lab', 'portrait-lab',
                       ${styleGuide ? `guide#${styleGuide.id} ${styleGuide.label || ''}`.trim() : 'NO-STYLE'},
                       ${prompt}, ${styleGuide && styleGuide.blob_key ? [styleGuide.blob_key] : []}, '1024x1024', 13)`;
    } catch (_) {}

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      b64: g.b64,
      prompt,
      styleGuideId: styleGuide ? styleGuide.id : null,
      styleLabel: styleGuide ? styleGuide.label : null,
      styleImageAttached: !!(styleGuide && styleGuide.image && styleGuide.image.buffer),
    });
  } catch (err) {
    res.status(500).json({ error: 'portrait-lab failed', detail: String(err.message || err) });
  }
}

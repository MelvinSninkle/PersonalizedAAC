// POST /api/onboarding/scene?action=draft|retry|commit
//
// The no-people KEYSTONE. After the child + parent portraits, the parent confirms
// how OBJECTS and SCENES will look by approving one generated scene — a small
// building with several everyday objects — rendered in the chosen style. This is
// the second half of the style gate: portraits prove the people look, this proves
// the object look.
//
//   ?action=draft    → generate a scene in the working style (advanced Pro model),
//                       return { draftKey }. Free (actor_role='onboarding_draft').
//   ?action=retry  { attempt }  → regenerate with a small variance nudge.
//   ?action=commit { draftKey } → approve. Persists the scene as the lasting
//       object/scene anchor and advances to seed_core. If the working style was a
//       parent-UPLOADED (ephemeral) template, the approved scene BECOMES the
//       permanent style guide: we create a permanent style_guides row from it,
//       repoint child_settings, and delete the temporary upload. A built-in
//       template stays as the anchor (this step is approval-only for it).
import { put, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { geminiKey, geminiProModel, geminiGenerateImage } from '../_lib/gemini.js';
import { openaiEditImage, openaiKeystoneModel } from '../_lib/openai-image.js';
import { ensureProgress, setStep } from '../_lib/onboarding.js';
import { loadStyleGuide, SQUARE_RULE } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 300 };

const SCENE_PROMPT_BASE =
  "A warm, friendly illustration of a small everyday SCENE for a young child's communication board: " +
  "a simple house or building with several familiar objects arranged clearly around it (for example a tree, " +
  "a ball, a cup, a chair, a toy car). NO people anywhere, and NO eyes, mouths, or faces on any object. " +
  "Bright, gentle, age-appropriate. Do not add any text, words, or letters.";

async function generateScene({ db, childId, styleGuide, actorEmail, attempt }) {
  const oaKey = process.env.OPENAI_API_KEY;
  const gKey = geminiKey();
  if (!oaKey && !gKey) throw Object.assign(new Error('No image API key configured (OPENAI_API_KEY or GEMINI_API_KEY)'), { status: 500 });
  const variant = attempt > 0
    ? ` Vary the composition and the objects shown slightly from any previous attempt (attempt ${attempt + 1}).`
    : '';
  const images = [];
  let prompt = SCENE_PROMPT_BASE + variant;
  const styleDesc = (styleGuide && styleGuide.description) ? String(styleGuide.description).trim() : '';
  if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
    images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
    prompt += `\n\nImage 1 is the STYLE reference — copy its art style only, not its content.${styleDesc ? ` (Style: ${styleDesc})` : ''}`;
  } else if (styleDesc) {
    prompt += ` Render it in this art style: ${styleDesc}.`;
  }
  prompt += SQUARE_RULE;

  // KEYSTONE: anchors every object/scene tile, and style transfer matters — use
  // OpenAI gpt-image when a style reference image is present (it copies style far
  // better); fall back to Gemini Pro (incl. the no-style-image case, since
  // OpenAI edits requires at least one input image).
  const g = (oaKey && images.length)
    ? await openaiEditImage({ apiKey: oaKey, model: openaiKeystoneModel(), prompt, images, size: '1024x1024' })
    : await geminiGenerateImage({ apiKey: gKey, model: geminiProModel(), prompt, images, aspectRatio: '1:1' });
  if (!g.ok) throw Object.assign(new Error('Scene render failed: ' + (g.detail || '').slice(0, 200)), { status: g.status || 502 });
  const genCost = g.costCents != null ? g.costCents : 13;
  const png = Buffer.from(g.b64, 'base64');
  const blobKey = `onboarding/${childId}/scene/${randomUUID()}.png`;
  await put(blobKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
  // Free during onboarding (actor_role='onboarding_draft' is excluded from quota).
  try {
    await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
             VALUES (${childId}, ${actorEmail || null}, 'onboarding_draft', 'onboarding-scene', ${styleGuide ? styleGuide.label : 'default'}, ${prompt}, '1024x1024', ${genCost})`;
  } catch (_) {}
  return blobKey;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const action = String((req.query && req.query.action) || 'draft');
  try {
    const db = sql();
    const progress = await ensureProgress(db, auth.user);
    const childId = progress.child_id;
    const styleGuideId = (progress.data && progress.data.styleGuideId) ? Number(progress.data.styleGuideId) : null;

    if (action === 'draft' || action === 'retry') {
      const b = (typeof req.body === 'object' && req.body) || {};
      const attempt = action === 'retry' ? (Number(b.attempt) > 0 ? Math.min(5, Math.floor(b.attempt)) : 1) : 0;
      const styleGuide = await loadStyleGuide(db, styleGuideId);
      const draftKey = await generateScene({ db, childId, styleGuide, actorEmail: auth.user.email, attempt });
      res.status(200).json({ ok: true, draftKey });
      return;
    }

    if (action === 'commit') {
      const b = (typeof req.body === 'object' && req.body) || {};
      const draftKey = String(b.draftKey || '');
      if (!draftKey) { res.status(400).json({ error: 'draftKey required' }); return; }

      let anchorId = styleGuideId;
      if (styleGuideId) {
        const sg = (await db`SELECT id, ephemeral, blob_key, description FROM style_guides WHERE id = ${styleGuideId} LIMIT 1`)[0];
        if (sg && sg.ephemeral) {
          // The uploaded template was temporary — the approved scene becomes the
          // lasting anchor. Create a permanent guide from it and repoint the child.
          const blobUrl = `/api/media?key=${encodeURIComponent(draftKey)}`;
          const childName = (progress.data && progress.data.childName) || 'Your';
          const label = `${childName}'s style`.slice(0, 120);
          const ins = await db`
            INSERT INTO style_guides (label, description, blob_url, blob_key, active, sort_order, created_by, child_id, ephemeral)
            VALUES (${label}, ${sg.description || null}, ${blobUrl}, ${draftKey}, TRUE, 0, ${auth.user.email || null}, ${childId}, FALSE)
            RETURNING id`;
          anchorId = Number(ins[0].id);
          const csRow = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
          const settings = (csRow && csRow.settings) || {};
          settings.styleGuideId = anchorId;
          await db`INSERT INTO child_settings (child_id, settings, updated_at) VALUES (${childId}, ${settings}::jsonb, NOW())
                   ON CONFLICT (child_id) DO UPDATE SET settings = ${settings}::jsonb, updated_at = NOW()`;
          // Delete the temporary uploaded template (row + blob).
          try { await db`DELETE FROM style_guides WHERE id = ${styleGuideId}`; } catch (_) {}
          try { if (sg.blob_key) await del(sg.blob_key); } catch (_) {}
        }
      }

      await setStep(db, Number(auth.user.uid), 'seed_core', { sceneKeystoneKey: draftKey, styleGuideId: anchorId });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, step: 'seed_core', styleGuideId: anchorId });
      return;
    }

    res.status(400).json({ error: 'unknown action; expected draft|retry|commit' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: 'scene step failed', detail: String(err.message || err) });
  }
}

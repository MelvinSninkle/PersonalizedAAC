// POST /api/parent/style-regenerate?action=draft|commit   { childId, draftKey? }
//
// Lets a parent regenerate their board's family style image from the parent view.
// Mirrors the onboarding scene keystone (api/onboarding/scene.js): a no-people
// SCENE rendered in the current style on the advanced Pro tier.
//
//   action=draft  → generate a fresh take in the current style; return { draftKey }.
//   action=commit { draftKey } → make it the lasting family style anchor: update
//       the child's own style_guides row in place (or fork one from the template
//       they're on) and repoint child_settings so every future prompt uses it.
//
// Draft→commit so a worse take never silently replaces the working anchor.
import { put, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { isParentOf } from '../_lib/access.js';
import { geminiKey, geminiProModel, geminiGenerateImage } from '../_lib/gemini.js';
import { openaiEditImage, openaiKeystoneModel } from '../_lib/openai-image.js';
import { loadStyleGuide, SQUARE_RULE } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 300 };

const SCENE_PROMPT_BASE =
  "A warm, friendly illustration of a small everyday SCENE for a young child's communication board: " +
  "a simple house or building with several familiar objects arranged clearly around it (for example a tree, " +
  "a ball, a cup, a chair, a toy car). NO people anywhere, and NO eyes, mouths, or faces on any object. " +
  "Bright, gentle, age-appropriate. Do not add any text, words, or letters.";

function prettyName(childId) {
  return String(childId || '').replace(/peterson$/i, '').replace(/^\w/, c => c.toUpperCase()) || 'Your';
}

// Resolve the style guide currently driving the board (same order as GET
// /api/parent/style): pinned pointer → child-scoped family guide → none.
async function resolveStyleGuideId(db, childId) {
  const cs = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
  const pinned = cs && cs.settings && cs.settings.styleGuideId ? Number(cs.settings.styleGuideId) : null;
  if (pinned) {
    const r = (await db`SELECT id FROM style_guides WHERE id = ${pinned} LIMIT 1`)[0];
    if (r) return pinned;
  }
  const own = (await db`
    SELECT id FROM style_guides WHERE child_id = ${childId} AND active = TRUE
    ORDER BY ephemeral ASC, created_at DESC LIMIT 1`)[0];
  return own ? Number(own.id) : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = typeof (req.query.childId || (req.body && req.body.childId)) === 'string'
    ? (req.query.childId || req.body.childId) : '';
  const action = String((req.query && req.query.action) || 'draft');
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    const isAdmin = auth.user.role === 'admin';
    if (!isAdmin && !(await isParentOf(auth.user, childId, db))) {
      res.status(403).json({ error: 'Only a parent can change the family style' }); return;
    }

    const styleGuideId = await resolveStyleGuideId(db, childId);
    if (!styleGuideId) { res.status(400).json({ error: 'No style to regenerate from yet' }); return; }

    if (action === 'draft') {
      const oaKey = process.env.OPENAI_API_KEY;
      const gKey = geminiKey();
      if (!oaKey && !gKey) { res.status(500).json({ error: 'No image API key configured' }); return; }
      const styleGuide = await loadStyleGuide(db, styleGuideId);
      const images = [];
      let prompt = SCENE_PROMPT_BASE + ' Vary the composition and objects from any previous version.';
      const styleDesc = (styleGuide && styleGuide.description) ? String(styleGuide.description).trim() : '';
      if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
        images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
        prompt += `\n\nImage 1 is the STYLE reference — copy its art style only, not its content.${styleDesc ? ` (Style: ${styleDesc})` : ''}`;
      } else if (styleDesc) {
        prompt += ` Render it in this art style: ${styleDesc}.`;
      }
      prompt += SQUARE_RULE;

      // KEYSTONE tier, same as the onboarding scene (api/onboarding/scene.js):
      // this image DEFINES the board's style, so it renders on the keystone
      // model whenever we have a style image to edit from — no fallback to a
      // lesser engine on failure; a miss is just "tap again". (Gemini Pro only
      // when OpenAI is unconfigured or there is no input image for edits.)
      const g = (oaKey && images.length)
        ? await openaiEditImage({ apiKey: oaKey, model: await openaiKeystoneModel(db), prompt, images, size: '1024x1024' })
        : (gKey
            ? await geminiGenerateImage({ apiKey: gKey, model: geminiProModel(), prompt, images, aspectRatio: '1:1' })
            : { ok: false, detail: 'GEMINI_API_KEY not configured (needed when no style image exists yet)' });
      if (!g.ok) { res.status(g.status || 502).json({ error: 'Render failed. Nothing changed. Tap again in a moment.', detail: (g.detail || '').slice(0, 200) }); return; }
      const draftKey = `parent/${childId}/style/${randomUUID()}.png`;
      await put(draftKey, Buffer.from(g.b64, 'base64'), { access: 'private', contentType: 'image/png', addRandomSuffix: false });
      try {
        await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
                 VALUES (${childId}, ${auth.user.email || null}, 'style_regen', 'parent-style-regen',
                         ${styleGuide ? styleGuide.label : 'default'}, ${prompt}, '1024x1024', ${g.costCents != null ? g.costCents : 13})`;
      } catch (_) {}
      res.status(200).json({ ok: true, draftKey, previewUrl: `/api/media?key=${encodeURIComponent(draftKey)}` });
      return;
    }

    if (action === 'commit') {
      const draftKey = String((req.body && req.body.draftKey) || '');
      if (!draftKey || !draftKey.startsWith(`parent/${childId}/style/`)) {
        res.status(400).json({ error: 'valid draftKey required' }); return;
      }
      const blobUrl = `/api/media?key=${encodeURIComponent(draftKey)}`;
      const current = (await db`SELECT id, child_id, blob_key FROM style_guides WHERE id = ${styleGuideId} LIMIT 1`)[0];

      let familyId;
      if (current && current.child_id === childId) {
        // Already the family's own guide — swap the image in place.
        familyId = Number(current.id);
        await db`UPDATE style_guides SET blob_url = ${blobUrl}, blob_key = ${draftKey}, ephemeral = FALSE WHERE id = ${familyId}`;
        if (current.blob_key && current.blob_key !== draftKey) { try { await del(current.blob_key); } catch (_) {} }
      } else {
        // On a public template — fork a persistent family guide and repoint.
        const label = `${prettyName(childId)}'s style`.slice(0, 120);
        const desc = current ? (await db`SELECT description FROM style_guides WHERE id = ${styleGuideId} LIMIT 1`)[0]?.description : null;
        const ins = await db`
          INSERT INTO style_guides (label, description, blob_url, blob_key, active, sort_order, created_by, child_id, ephemeral)
          VALUES (${label}, ${desc || null}, ${blobUrl}, ${draftKey}, TRUE, 0, ${auth.user.email || null}, ${childId}, FALSE)
          RETURNING id`;
        familyId = Number(ins[0].id);
      }

      const csRow = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
      const settings = (csRow && csRow.settings) || {};
      settings.styleGuideId = familyId;
      await db`INSERT INTO child_settings (child_id, settings, updated_at) VALUES (${childId}, ${settings}::jsonb, NOW())
               ON CONFLICT (child_id) DO UPDATE SET settings = ${settings}::jsonb, updated_at = NOW()`;

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, styleGuideId: familyId, imageUrl: blobUrl });
      return;
    }

    res.status(400).json({ error: 'unknown action; expected draft|commit' });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'regenerate failed', detail: String(err.message || err) });
  }
}

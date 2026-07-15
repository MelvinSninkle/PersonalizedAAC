// /api/admin/lab?action=style-wizard  (admin only)
//
// The one-screen "New Style" wizard's server half (admin/style-wizard.html).
// Standing up a new offered style = upload anchor → approve a generated demo
// kid (person ref) + stuff ref → one button fans the whole default board out
// to the durable style_build_jobs queue (drained by the every-minute cron —
// the tab can close) → review → Publish flips the style live in the
// onboarding picker AND the public demo's style switcher.
//
//   GET  ?styleGuideId=N            → { style, status } (progress poll)
//   POST { styleGuideId, op:'person-candidate' } → { key } generated demo-kid
//   POST { styleGuideId, op:'stuff-candidate' }  → { key } generated objects scene
//   POST { styleGuideId, op:'set-ref', kind:'person'|'stuff', blobKey } → save ref
//   POST { styleGuideId, op:'create-jobs' }      → fan out tiles+chips (gap-fill)
//   POST { styleGuideId, op:'publish', active }  → go live (requires 100%) / unpublish
//
// Drafts: wizard-created styles are active=FALSE until Publish — the
// onboarding picker (active=TRUE filter) and the demo switcher can never
// show a half-rendered style (invariant E9).
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { readBlobBytes } from '../_lib/onboarding-render.js';
import { geminiKey, geminiDefaultModel, geminiGenerateImage } from '../_lib/gemini.js';
import { loadStyle, enqueueStyleBuild, styleBuildStatus } from '../_lib/style-build.js';

export const config = { maxDuration: 120 };

const PERSON_PROMPT =
  'A friendly, generic young child (about 3 years old, cheerful, gender-neutral) drawn in EXACTLY the art ' +
  'style of the attached reference image — same line work, palette, shading and rendering. Full body, ' +
  'standing, facing the viewer, simple plain background. This character will stand in for "the child" on a ' +
  'demo communication board, so keep it warm, simple and universal. Copy the reference\'s STYLE only, never ' +
  'its content or any characters in it. No text anywhere in the image.';

const STUFF_PROMPT =
  'A small still-life scene of everyday toddler objects (a cup, a ball, a toy block, an apple) drawn in ' +
  'EXACTLY the art style of the attached reference image — same line work, palette, shading and rendering. ' +
  'Simple plain background. This image anchors how OBJECTS and materials look in this style on a ' +
  'communication board. Copy the reference\'s STYLE only, never its content. No text anywhere in the image.';

async function renderCandidate(style, prompt) {
  const key = geminiKey();
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  if (!style.image || !style.image.buffer) throw new Error('style anchor image missing');
  const g = await geminiGenerateImage({
    apiKey: key, model: geminiDefaultModel(), prompt,
    images: [{ buffer: style.image.buffer, contentType: style.image.contentType }],
    aspectRatio: '1:1',
  });
  if (!g.ok) throw new Error(g.detail || 'candidate render failed');
  return Buffer.from(g.b64, 'base64');
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();

  const q = req.query || {};
  const b = (typeof req.body === 'object' && req.body) || {};
  const styleGuideId = parseInt((req.method === 'GET' ? q.styleGuideId : b.styleGuideId), 10);
  if (!styleGuideId) { res.status(400).json({ error: 'styleGuideId required' }); return; }
  const style = await loadStyle(db, styleGuideId);
  if (!style) { res.status(404).json({ error: 'style guide not found (or not a global one)' }); return; }

  try {
    if (req.method === 'GET') {
      const meta = (await db`SELECT active, preview_blob_key FROM style_guides WHERE id = ${styleGuideId}`)[0] || {};
      const status = await styleBuildStatus(db, styleGuideId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        ok: true,
        style: { id: style.id, label: style.label, description: style.description,
                 blobKey: style.blob_key, personRefKey: style.person_ref_key,
                 stuffRefKey: style.stuff_ref_key, previewKey: meta.preview_blob_key || null,
                 active: !!meta.active },
        status,
      });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const op = String(b.op || '');

    if (op === 'person-candidate' || op === 'stuff-candidate') {
      const png = await renderCandidate(style, op === 'person-candidate' ? PERSON_PROMPT : STUFF_PROMPT);
      const key = `style-wizard/${style.id}/${op === 'person-candidate' ? 'person' : 'stuff'}/${randomUUID()}.png`;
      await put(key, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
      res.status(200).json({ ok: true, key });
      return;
    }

    if (op === 'set-ref') {
      const kind = b.kind === 'stuff' ? 'stuff' : 'person';
      const blobKey = String(b.blobKey || '');
      // Accept wizard candidates or Lab uploads only — and verify the blob
      // actually exists before pointing renders at it.
      if (!/^(style-wizard|styleref|style-guides|styles)\/[A-Za-z0-9/._-]+$/.test(blobKey)) {
        res.status(400).json({ error: 'unexpected blobKey' }); return;
      }
      await readBlobBytes(blobKey);   // throws if missing
      if (kind === 'person') {
        await db`UPDATE style_guides SET person_ref_key = ${blobKey} WHERE id = ${styleGuideId}`;
      } else {
        await db`UPDATE style_guides SET stuff_ref_key = ${blobKey} WHERE id = ${styleGuideId}`;
      }
      res.status(200).json({ ok: true, kind, blobKey });
      return;
    }

    if (op === 'create-jobs') {
      if (!style.person_ref_key || !style.stuff_ref_key) {
        res.status(400).json({ error: 'refs_missing',
          detail: 'Approve the demo kid and the objects reference first — person-y tiles render around them.' });
        return;
      }
      const queued = await enqueueStyleBuild(db, styleGuideId);
      res.status(200).json({ ok: true, queued,
        note: 'Queued — the every-minute cron renders these on its own. You can close this tab.' });
      return;
    }

    if (op === 'publish') {
      const active = b.active !== false;
      if (active) {
        const status = await styleBuildStatus(db, styleGuideId);
        if (!status.complete) {
          res.status(409).json({ error: 'not_complete', status,
            detail: 'Every tile and chip must be rendered before a style goes live.' });
          return;
        }
      }
      await db`UPDATE style_guides SET active = ${active} WHERE id = ${styleGuideId}`;
      res.status(200).json({ ok: true, active });
      return;
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (err) {
    res.status(500).json({ error: 'style-wizard failed', detail: String(err.message || err) });
  }
}

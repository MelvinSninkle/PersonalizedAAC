// POST /api/onboarding/family
//
// Steps 3 + 4 (child photo + first grown-up photo). Three actions:
//
//   POST … ?action=draft     Content-Type: image/jpeg  body=raw bytes
//     Stylizes the photo via Nano Banana and returns the DRAFT blob key.
//     Doesn't commit — the parent reviews it, then either retries or confirms.
//     Onboarding draft generations are FREE (don't count against the parent's
//     monthly image-gen quota); we tag them with actor_role='onboarding_draft'
//     so the quota count excludes them.
//
//   POST … ?action=retry      JSON  { draftKey, role, name }
//     Re-runs the model on the SAME source bytes with a higher temperature
//     so the parent doesn't burn a photo decision on bad luck. Also free.
//
//   POST … ?action=commit     JSON  { draftKey, role, name, relationship?, side? }
//     Promotes the chosen draft to the canonical reference_key on the
//     persons row, AND creates the People tile on the child's board.
//     Advances the onboarding step.
//
// `role` is 'child' (sets is_self=true on the persons row) or 'parent'.
// Behavior parallels /api/onboard-subject but adds the draft/commit dance.
import { put, get as blobGet } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { geminiKey, geminiProModel, geminiGenerateImage } from '../_lib/gemini.js';
import { ensureProgress, nextStep, setStep } from '../_lib/onboarding.js';
import { isValidRelationship, relationshipNeedsSide } from '../_lib/relationships.js';
import { loadStyleGuide, loadChildVoiceId, synthesizeVoice, SQUARE_RULE } from '../_lib/onboarding-render.js';

export const config = { api: { bodyParser: false }, maxDuration: 300 };

const MAX_BYTES = 4 * 1024 * 1024;
const STYLE_PROMPT_BASE =
  "Re-illustrate this photograph as a warm storybook portrait for a young child's communication board. " +
  "Keep the person's face and likeness clearly recognizable; soft even lighting; clean soft pastel pink " +
  "background; centered head-and-shoulders; bright friendly colors; gentle age-appropriate look. " +
  "Do not add any text, words, or letters.";

async function readBody(req) {
  const chunks = []; let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > MAX_BYTES) throw Object.assign(new Error('Photo too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function readBlobBytes(key) {
  const r = await blobGet(key, { access: 'private' });
  if (r.statusCode !== 200 || !r.stream) throw new Error('blob read failed');
  const reader = r.stream.getReader();
  const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
  return Buffer.concat(chunks);
}

async function stylize({ db, childId, sourceBytes, contentType, actorEmail, attempt, styleGuide, guidance }) {
  const gKey = geminiKey();
  if (!gKey) throw new Error('GEMINI_API_KEY not configured');
  // A small variance instruction makes each retry give a fresh look — same
  // person, different lighting / pose interpretation — so the parent isn't
  // burning a photo decision on a bad first roll.
  const variant = attempt > 0
    ? ` Vary the framing and expression slightly from any previous attempt (attempt ${attempt + 1}).`
    : '';
  // The parent's specific correction (e.g. "add white to his eyes"), applied verbatim.
  const fix = guidance ? ` Important correction from the parent — apply this exactly: ${guidance}.` : '';

  // Two render modes:
  //   • style guide chosen → IMAGE 1 = the style reference, IMAGE 2 = the real
  //     photo. Lead with faithful STYLE copying (incl. the eye treatment) AND
  //     preserve IDENTITY, so the result matches both the look of the board and
  //     the specific person.
  //   • no style guide → the original tuned warm-storybook portrait.
  const styleDesc = (styleGuide && styleGuide.description) ? String(styleGuide.description).trim() : '';
  const images = [];
  let prompt;
  if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
    images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
    images.push({ buffer: sourceBytes, contentType: contentType || 'image/jpeg' });
    prompt =
      "TASK: Redraw the real person shown in IMAGE 2 in the EXACT art style of IMAGE 1.\n" +
      "IMAGE 1 is the STYLE reference. Copy its art style faithfully and obviously: its linework weight and color, " +
      "its flat cel coloring and shading, its proportions and shapes, and ESPECIALLY its eye treatment — match how " +
      "eyes, pupils, and the whites of the eyes are drawn. Do NOT copy IMAGE 1's content, background, or the people in it. " +
      (styleDesc ? `The style can be described as: ${styleDesc}. ` : '') +
      "\nIMAGE 2 is the real person. Keep their IDENTITY unmistakable — same skin tone, hair color and hairstyle, " +
      "face shape, eyebrows, apparent age and sex, and any glasses, freckles, or distinctive features — but DRAW every " +
      "one of those features in IMAGE 1's art style (do not render them realistically or in a different cartoon style).\n" +
      "WHY: this is a tile for a young child's AAC communication device; the child has a developmental disability and " +
      "must instantly recognize BOTH this exact person AND the shared art style that helps them focus — so a faithful " +
      "style match and a faithful likeness matter equally.\n" +
      "Head-and-shoulders portrait, centered, clean soft pastel background, bright friendly colors, no text or letters." + variant;
  } else {
    images.push({ buffer: sourceBytes, contentType: contentType || 'image/jpeg' });
    prompt = STYLE_PROMPT_BASE + variant;
  }
  prompt += fix;
  prompt += SQUARE_RULE;

  // KEYSTONE: portraits anchor every later render, so use the advanced Pro tier.
  const g = await geminiGenerateImage({ apiKey: gKey, model: geminiProModel(), prompt, images, aspectRatio: '1:1' });
  if (!g.ok) {
    const err = new Error('Stylization failed: ' + (g.detail || '').slice(0, 200));
    err.status = g.status || 502; throw err;
  }
  const png = Buffer.from(g.b64, 'base64');
  const blobKey = `onboarding/${childId}/${randomUUID()}.png`;
  await put(blobKey, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false });
  // Log generation with actor_role='onboarding_draft' so it doesn't count
  // toward the parent's monthly quota (api/generate-image excludes that role).
  try {
    await db`
      INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
      VALUES (${childId}, ${actorEmail || null}, 'onboarding_draft', 'onboarding-portrait', ${styleGuide ? styleGuide.label : 'soft'}, ${prompt}, '1024x1024', 4)`;
  } catch (_) {}
  return blobKey;
}

async function loadSourceFromDraft(db, childId, draftKey) {
  // Stash the source bytes alongside the draft so retries don't require
  // re-uploading. We keep them in onboarding_progress.data.lastSource so
  // each parent has at most one outstanding source at a time.
  const row = (await db`SELECT data FROM onboarding_progress
                        WHERE child_id = ${childId} LIMIT 1`)[0];
  const src = row && row.data && row.data.lastSourceKey;
  if (!src) throw new Error('No source bytes on file for retry — capture a new photo');
  return await readBlobBytes(src);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const q = req.query || {};
  const action = String(q.action || 'draft');
  try {
    const db = sql();
    const progress = await ensureProgress(db, auth.user);
    const childId = progress.child_id;

    if (action === 'draft') {
      // raw bytes; stash source for retries.
      const bytes = await readBody(req);
      if (!bytes.length) { res.status(400).json({ error: 'Empty body' }); return; }
      const contentType = req.headers['content-type'] || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const sourceKey = `onboarding/${childId}/source/${randomUUID()}.${ext}`;
      await put(sourceKey, bytes, { access: 'private', contentType, addRandomSuffix: false });
      // The chosen style applies to BOTH portraits and the Core seed, so we
      // persist it on the progress row the first time it arrives — retries and
      // the seed step read it back from here.
      const styleGuideId = q.styleGuideId ? parseInt(q.styleGuideId, 10) : (progress.data && progress.data.styleGuideId) || null;
      await db`UPDATE onboarding_progress
                  SET data = COALESCE(data, '{}'::jsonb) || ${JSON.stringify({ lastSourceKey: sourceKey, styleGuideId })}::jsonb,
                      updated_at = NOW()
                WHERE user_id = ${Number(auth.user.uid)}`;
      const styleGuide = await loadStyleGuide(db, styleGuideId);
      const attempt = q.attempt ? Math.min(5, Math.max(0, parseInt(q.attempt, 10) || 0)) : 0;
      const guidance = typeof q.guidance === 'string' ? q.guidance.slice(0, 300) : '';
      const draftKey = await stylize({ db, childId, sourceBytes: bytes, contentType,
                                       actorEmail: auth.user.email, attempt, styleGuide, guidance });
      res.status(200).json({ ok: true, draftKey });
      return;
    }

    if (action === 'retry') {
      // JSON body
      let body = '';
      for await (const c of req) body += c.toString('utf8');
      const b = body ? JSON.parse(body) : {};
      const attempt = Number(b.attempt) > 0 ? Math.min(5, Math.floor(b.attempt)) : 1;
      const bytes = await loadSourceFromDraft(db, childId, b.draftKey);
      const styleGuideId = b.styleGuideId ? parseInt(b.styleGuideId, 10) : (progress.data && progress.data.styleGuideId) || null;
      const styleGuide = await loadStyleGuide(db, styleGuideId);
      const guidance = typeof b.guidance === 'string' ? b.guidance.slice(0, 300) : '';
      const draftKey = await stylize({ db, childId, sourceBytes: bytes,
                                       contentType: 'image/jpeg',
                                       actorEmail: auth.user.email, attempt, styleGuide, guidance });
      res.status(200).json({ ok: true, draftKey });
      return;
    }

    if (action === 'commit') {
      let body = '';
      for await (const c of req) body += c.toString('utf8');
      const b = body ? JSON.parse(body) : {};
      const draftKey = String(b.draftKey || '');
      const role = b.role === 'child' ? 'child' : 'parent';
      const name = String(b.name || '').slice(0, 80).trim();
      if (!draftKey || !name) { res.status(400).json({ error: 'draftKey and name required' }); return; }
      const relationship = isValidRelationship(b.relationship) ? b.relationship : (role === 'child' ? 'self' : 'other');
      const side = relationshipNeedsSide(relationship) && (b.side === 'maternal' || b.side === 'paternal') ? b.side : null;
      const isSelf = role === 'child' || relationship === 'self';

      // Upsert the persons row with the committed draft as reference_key.
      const ex = await db`SELECT id FROM persons
                          WHERE child_id = ${childId} AND lower(display_name) = lower(${name}) LIMIT 1`;
      let personId;
      if (ex.length) {
        personId = ex[0].id;
        await db`UPDATE persons
                    SET relationship = ${relationship}, side = ${side}, is_self = ${isSelf},
                        reference_key = ${draftKey}, updated_at = NOW()
                  WHERE id = ${personId}`;
      } else {
        const inserted = await db`
          INSERT INTO persons (child_id, display_name, given_name, relationship, side, is_self, reference_key)
          VALUES (${childId}, ${name}, ${name}, ${relationship}, ${side}, ${isSelf}, ${draftKey})
          RETURNING id`;
        personId = inserted[0].id;
      }

      // Make/refresh the People tile. Pinned for the child.
      const famCat = (await db`SELECT id FROM categories
                                WHERE child_id = ${childId} AND section = 'people' AND parent_id IS NULL
                                  AND lower(label) = 'family' LIMIT 1`)[0];
      let catId;
      if (famCat) catId = famCat.id;
      else {
        const ins = await db`
          INSERT INTO categories (section, label, parent_id, image_key, keep_aspect, display_order, child_id, updated_at)
          VALUES ('people', 'Family', NULL, ${isSelf ? draftKey : null}, FALSE, 0, ${childId}, NOW())
          RETURNING id`;
        catId = ins[0].id;
      }
      // Voice the People tile in the parent's chosen voice (best-effort).
      let soundKey = null;
      try {
        const voiceId = await loadChildVoiceId(db, childId);
        const mp3 = await synthesizeVoice({ text: name, voiceId });
        if (mp3) {
          soundKey = `onboarding/${childId}/voice/${randomUUID()}.mp3`;
          await put(soundKey, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
        }
      } catch (_) {}

      const existingTile = await db`SELECT id FROM items
                                     WHERE child_id = ${childId} AND section = 'people'
                                       AND lower(label) = lower(${name}) LIMIT 1`;
      if (existingTile.length) {
        await db`UPDATE items SET image_key = ${draftKey}, sound_key = COALESCE(${soundKey}, sound_key),
                   category_id = ${catId}, pinned = ${isSelf}, updated_at = NOW()
                  WHERE id = ${existingTile[0].id}`;
      } else {
        await db`INSERT INTO items (section, category_id, label, image_key, sound_key, keep_aspect, display_order, pinned, child_id, updated_at)
                  VALUES ('people', ${catId}, ${name}, ${draftKey}, ${soundKey}, FALSE, ${Date.now()}, ${isSelf}, ${childId}, NOW())`;
      }

      // Advance the step. child_photo → parent_photo → scene_keystone (the
      // no-people style gate) → seed_core.
      const cur = progress.step;
      const nxt = cur === 'child_photo' ? 'parent_photo' : (cur === 'parent_photo' ? 'scene_keystone' : nextStep(cur));
      await setStep(db, Number(auth.user.uid), nxt);
      res.status(200).json({ ok: true, step: nxt, personId: Number(personId) });
      return;
    }

    res.status(400).json({ error: 'unknown action; expected draft|retry|commit' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: 'family step failed', detail: String(err.message || err) });
  }
}

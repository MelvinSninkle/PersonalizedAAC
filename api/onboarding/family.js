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
import { geminiKey, geminiDefaultModel, geminiGenerateImage } from '../_lib/gemini.js';
import { ensureProgress, nextStep, setStep } from '../_lib/onboarding.js';
import { isValidRelationship, relationshipNeedsSide } from '../_lib/relationships.js';
import { loadStyleGuide } from '../_lib/onboarding-render.js';

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

async function stylize({ db, childId, sourceBytes, contentType, actorEmail, attempt, styleGuide }) {
  const gKey = geminiKey();
  if (!gKey) throw new Error('GEMINI_API_KEY not configured');
  // A small variance instruction makes each retry give a fresh look — same
  // person, different lighting / pose interpretation — so the parent isn't
  // burning a photo decision on a bad first roll.
  const variant = attempt > 0
    ? ` Vary the framing and expression slightly from any previous attempt (attempt ${attempt + 1}).`
    : '';

  // Two render modes:
  //   • style guide chosen → render the person IN that style: image 1 is the
  //     style reference (copy its look only), image 2 is the real photo (keep
  //     the likeness). This is the "style image + real photo" composition the
  //     whole board shares, so People match the rest of the tiles.
  //   • no style guide → the original tuned warm-storybook portrait.
  const images = [];
  let prompt;
  if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
    images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
    images.push({ buffer: sourceBytes, contentType: contentType || 'image/jpeg' });
    prompt =
      "Re-illustrate the person in the photo as a head-and-shoulders portrait for a young child's " +
      "communication board, rendered in the art style of the style-reference image. Keep the person's " +
      "face and likeness clearly recognizable; soft even lighting; clean soft pastel background; centered; " +
      "bright friendly colors. Do not add any text, words, or letters." + variant +
      "\n\nImage 1 is the STYLE reference — copy its art style only, not its content. " +
      "Image 2 shows the person — keep this person's face and likeness clearly recognizable.";
  } else {
    images.push({ buffer: sourceBytes, contentType: contentType || 'image/jpeg' });
    prompt = STYLE_PROMPT_BASE + variant;
  }

  const g = await geminiGenerateImage({ apiKey: gKey, model: geminiDefaultModel(), prompt, images });
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
      const draftKey = await stylize({ db, childId, sourceBytes: bytes, contentType,
                                       actorEmail: auth.user.email, attempt: 0, styleGuide });
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
      const draftKey = await stylize({ db, childId, sourceBytes: bytes,
                                       contentType: 'image/jpeg',
                                       actorEmail: auth.user.email, attempt, styleGuide });
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
      const existingTile = await db`SELECT id FROM items
                                     WHERE child_id = ${childId} AND section = 'people'
                                       AND lower(label) = lower(${name}) LIMIT 1`;
      if (existingTile.length) {
        await db`UPDATE items SET image_key = ${draftKey}, category_id = ${catId}, pinned = ${isSelf}, updated_at = NOW()
                  WHERE id = ${existingTile[0].id}`;
      } else {
        await db`INSERT INTO items (section, category_id, label, image_key, keep_aspect, display_order, pinned, child_id, updated_at)
                  VALUES ('people', ${catId}, ${name}, ${draftKey}, FALSE, ${Date.now()}, ${isSelf}, ${childId}, NOW())`;
      }

      // Advance the step.
      const cur = progress.step;
      const nxt = cur === 'child_photo' ? 'parent_photo' : (cur === 'parent_photo' ? 'seed_core' : nextStep(cur));
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

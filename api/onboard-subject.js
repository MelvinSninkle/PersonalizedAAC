// POST /api/onboard-subject?childId=&style=&role=child|parent&name=&pronunciation=
// Raw photo bytes in the body. Stylizes the person, stores it, saves it as a
// per-child REFERENCE image (subject anchor), and — when a name is given —
// generates a voice and creates/updates a People tile for them (the child is
// pinned). Returns { key, itemId }. Synchronous: this is the onboarding gate.
import { uploadBytes } from './_lib/blob.js';
import { checkAuth } from './_lib/auth.js';
import { archivePriorImage } from './_lib/image-history.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';
import { isValidRelationship, relationshipNeedsSide, relationshipAgeGroup } from './_lib/relationships.js';
import { geminiKey, geminiProModel, geminiGenerateImage } from './_lib/gemini.js';
import { openaiEditImage, openaiKeystoneModel } from './_lib/openai-image.js';
import { loadStyleGuide, loadChildStyleGuideId, loadChildVoiceId, synthesizeVoice, buildPortraitPrompt } from './_lib/onboarding-render.js';
import { chargeForGeneration, grantCredits, requireStyling, NEEDS_SUBSCRIPTION_DETAIL, COST } from './_lib/credits.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const MAX_BYTES = 5 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const q = req.query || {};
  const childId = String(q.childId || 'fletcherpeterson').slice(0, 64);
  const style = String(q.style || '').slice(0, 80);
  // Only 'child' is the child (pinned, is_self, face on the Family chip); every
  // other captured person — a parent, grandparent, sibling — is a grown-up subject.
  const role = q.role === 'child' ? 'child' : 'parent';
  const name = String(q.name || '').slice(0, 200).trim();
  const pronunciation = String(q.pronunciation || '').slice(0, 200).trim();
  // People model (docs/people-data-model.md): structured identity for this person.
  const relationship = String(q.relationship || '').slice(0, 40).trim().toLowerCase();
  const side = (q.side === 'maternal' || q.side === 'paternal') ? q.side : null;
  // Kid or grown-up, for the portrait's age treatment (the style sample shows
  // kids; adults must not inherit its child proportions). Derived from the
  // relationship when unambiguous (mother → adult); the explicit query param —
  // the picker's kid/grown-up toggle — decides siblings, cousins, friends.
  const ageGroupParam = (q.ageGroup === 'adult' || q.ageGroup === 'child') ? q.ageGroup : null;
  const ageGroup = role === 'child' ? 'child' : (relationshipAgeGroup(relationship) || ageGroupParam);
  const givenName = String(q.given || '').slice(0, 120).trim();
  const pronoun = (q.pronoun === 'she' || q.pronoun === 'he' || q.pronoun === 'they') ? q.pronoun : null;
  const birthOrder = (Number.isFinite(+q.birthOrder) && +q.birthOrder > 0) ? Math.floor(+q.birthOrder) : null;
  // YYYY-MM-DD only, used to compute the child's current developmental band so
  // the board can hide vocabulary that isn't age-appropriate yet. Stored only
  // on the is_self row (role==='child').
  const birthDate = (role === 'child' && /^\d{4}-\d{2}-\d{2}$/.test(String(q.birthDate || ''))) ? String(q.birthDate) : null;

  if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }

  let buffer;
  try {
    const chunks = []; let total = 0;
    for await (const chunk of req) { total += chunk.length; if (total > MAX_BYTES) { res.status(413).json({ error: 'Photo too large' }); return; } chunks.push(chunk); }
    buffer = Buffer.concat(chunks);
  } catch (err) { res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) }); return; }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }
  const contentType = req.headers['content-type'] || 'image/jpeg';

  try {
    const db = sql();
    // Family portraits run on the OpenAI keystone tier = 3 credits (admins
    // exempt; the initial onboarding family flow is a different endpoint and
    // stays free). Charged up front — the generation below is the expensive part.
    // Styled family portraits (beyond the two free onboarding keystones) are a
    // membership perk; free accounts can still add people as raw photos via
    // the add-tile flow's "use my photo as-is".
    {
      const gate = await requireStyling(db, { user: auth.user, childId });
      if (!gate.ok) {
        res.status(402).json({ error: 'needs_subscription', tier: gate.ent.tier,
                               detail: NEEDS_SUBSCRIPTION_DETAIL });
        return;
      }
    }
    const charge = await chargeForGeneration(db, auth.user, {
      credits: COST.person, reason: 'family:add', ref: childId,
    });
    if (!charge.ok) {
      res.status(402).json({ error: 'not_enough_credits', needed: COST.person, balance: charge.balance,
                             detail: 'Adding a family member uses 3 image credits. Add credits in the store and try again.' });
      return;
    }
    // 1) Stylize the person in the child's HOUSE STYLE. This MUST match the
    //    onboarding keystone path (api/onboarding/family.js) exactly, so a family
    //    member added here looks like the child + first parent: the same shared
    //    buildPortraitPrompt, the style guide image as IMAGE 1 + the photo as
    //    IMAGE 2, rendered on OpenAI gpt-image when configured (best style
    //    transfer) and falling back to Gemini Pro otherwise. (Previously this
    //    path was Gemini-Pro-only, which is why earlier adds looked different
    //    from the OpenAI keystones.)
    let key;
    const oaKey = process.env.OPENAI_API_KEY;
    const gKey = geminiKey();
    let styleGuide = null;
    try { styleGuide = await loadStyleGuide(db, await loadChildStyleGuideId(db, childId)); } catch (_) {}
    if (oaKey || gKey) {
      const images = [];
      if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
        images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
      }
      images.push({ buffer, contentType });
      const prompt = buildPortraitPrompt({ styleGuide, ageGroup });
      // Keystone tier only — no cross-engine fallback (below 1.5 the portraits
      // don't hold up). Retry the same engine once on a transient error; on a
      // real failure, refund the credits so "try again" never double-charges.
      const render = async () => oaKey
        ? await openaiEditImage({ apiKey: oaKey, model: await openaiKeystoneModel(db), prompt, images, size: '1024x1024' })
        : await geminiGenerateImage({ apiKey: gKey, model: geminiProModel(), prompt, images, aspectRatio: '1:1' });
      let g = await render().catch((e) => ({ ok: false, detail: String(e.message || e) }));
      if (!g.ok && (g.status === 429 || g.status >= 500 || !g.status)) {
        await new Promise((r) => setTimeout(r, 1500));
        g = await render().catch((e) => ({ ok: false, detail: String(e.message || e) }));
      }
      if (!g.ok) {
        if (!charge.exempt) {
          try { await grantCredits(db, { userId: Number(auth.user.uid || auth.user.id), credits: COST.person, reason: 'family:add:refund', ref: childId }); } catch (_) {}
        }
        res.status(g.status === 429 ? 429 : 502).json({
          error: 'Image generation failed. Your credits were returned. Please try again in a moment.',
          detail: (g.detail || '').slice(0, 400),
        });
        return;
      }
      key = await uploadBytes('refimage', 'png', Buffer.from(g.b64, 'base64'), 'image/png');
    } else {
      key = await uploadBytes('refimage', 'jpg', buffer, contentType);
    }

    // 2) Save as a reference image (subject anchor for later renders).
    await db`
      CREATE TABLE IF NOT EXISTS reference_images (
        id BIGSERIAL PRIMARY KEY, child_id TEXT NOT NULL, blob_key TEXT NOT NULL,
        label TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await db`INSERT INTO reference_images (child_id, blob_key, label) VALUES (${childId}, ${key}, ${role})`;

    // 3) Make them a People tile (with voice). Child is pinned; the family
    //    category chip gets the child's face.
    let itemId = null;
    if (name) {
      let soundKey = null;
      // Voice the tile in the CHILD's chosen voice (same as the onboarding
      // keystone path); fall back to the system voice only when none is set.
      // Previously this used the env default voice, so added family spoke in the
      // admin voice instead of the one selected during enrollment.
      try {
        const voiceId = await loadChildVoiceId(db, childId);
        const mp3 = await synthesizeVoice({ text: pronunciation || name, voiceId, db, childId, kind: 'tile' });
        if (mp3) soundKey = await uploadBytes('itemsound', 'mp3', mp3, 'audio/mpeg');
      } catch (_) {}

      const fam = await db`SELECT id, image_key FROM categories WHERE child_id = ${childId} AND section = 'people' AND parent_id IS NULL AND lower(label) = 'family' LIMIT 1`;
      let catId;
      if (fam.length) {
        catId = fam[0].id;
        if (role === 'child' && !fam[0].image_key) await db`UPDATE categories SET image_key = ${key}, updated_at = NOW() WHERE id = ${catId}`;
      } else {
        const c = await db`INSERT INTO categories (section, label, parent_id, image_key, keep_aspect, display_order, child_id, updated_at)
          VALUES ('people', 'Family', NULL, ${role === 'child' ? key : null}, FALSE, 0, ${childId}, NOW()) RETURNING id`;
        catId = c[0].id;
      }

      const pinned = role === 'child';
      const existing = await db`SELECT id, image_key, label, section FROM items WHERE child_id = ${childId} AND section = 'people' AND lower(label) = lower(${name}) LIMIT 1`;
      if (existing.length) {
        if (existing[0].image_key && existing[0].image_key !== key) {
          await archivePriorImage({
            db, childId, itemId: existing[0].id, oldKey: existing[0].image_key,
            label: existing[0].label, section: existing[0].section, source: 'onboarding',
            who: auth.user && auth.user.email || null,
          });
        }
        await db`UPDATE items SET image_key = ${key}, sound_key = ${soundKey}, category_id = ${catId}, pinned = ${pinned}, updated_at = NOW() WHERE id = ${existing[0].id}`;
        itemId = Number(existing[0].id);
      } else {
        const it = await db`INSERT INTO items (section, category_id, label, image_key, sound_key, keep_aspect, display_order, pinned, child_id, updated_at)
          VALUES ('people', ${catId}, ${name}, ${key}, ${soundKey}, FALSE, ${Date.now()}, ${pinned}, ${childId}, NOW()) RETURNING id`;
        itemId = Number(it[0].id);
      }

      // 4) Upsert the structured person behind this tile (docs/people-data-model.md)
      //    and link the tile to it. New captures arrive with a relationship once the
      //    onboarding picker sends it; until then child → self, grown-up → other.
      await db`
        CREATE TABLE IF NOT EXISTS persons (
          id BIGSERIAL PRIMARY KEY, child_id TEXT NOT NULL, display_name TEXT NOT NULL,
          given_name TEXT, relationship TEXT NOT NULL DEFAULT 'other', side TEXT, pronoun TEXT,
          birth_order INTEGER, is_self BOOLEAN NOT NULL DEFAULT FALSE, reference_key TEXT,
          voice_key TEXT, pronunciation TEXT, notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS person_id BIGINT REFERENCES persons(id)`;
      await db`ALTER TABLE persons ADD COLUMN IF NOT EXISTS age_group TEXT`;
      const isSelf = role === 'child' || relationship === 'self';
      const rel = isValidRelationship(relationship) ? relationship : (isSelf ? 'self' : 'other');
      const relSide = relationshipNeedsSide(rel) ? side : null;
      const pex = await db`SELECT id FROM persons WHERE child_id = ${childId} AND lower(display_name) = lower(${name}) LIMIT 1`;
      let personId;
      if (pex.length) {
        personId = pex[0].id;
        await db`
          UPDATE persons SET
            given_name = COALESCE(NULLIF(${givenName}, ''), given_name), relationship = ${rel}, side = ${relSide},
            pronoun = COALESCE(${pronoun}, pronoun), birth_order = COALESCE(${birthOrder}, birth_order),
            is_self = ${isSelf}, reference_key = ${key}, voice_key = COALESCE(${soundKey}, voice_key),
            pronunciation = COALESCE(NULLIF(${pronunciation}, ''), pronunciation),
            birth_date = COALESCE(${birthDate}, birth_date),
            age_group = COALESCE(${ageGroup}, age_group),
            updated_at = NOW()
          WHERE id = ${personId}`;
      } else {
        const pr = await db`
          INSERT INTO persons
            (child_id, display_name, given_name, relationship, side, pronoun, birth_order, is_self, age_group, reference_key, voice_key, pronunciation, birth_date)
          VALUES
            (${childId}, ${name}, ${givenName || null}, ${rel}, ${relSide}, ${pronoun}, ${birthOrder}, ${isSelf}, ${ageGroup}, ${key}, ${soundKey}, ${pronunciation || null}, ${birthDate})
          RETURNING id`;
        personId = pr[0].id;
      }
      await db`UPDATE items SET person_id = ${personId}, updated_at = NOW() WHERE id = ${itemId}`;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, key, itemId });
  } catch (err) {
    res.status(502).json({ error: 'Subject render failed', detail: String(err.message || err) });
  }
}

// POST /api/onboard-subject?childId=&style=&role=child|parent&name=&pronunciation=
// Raw photo bytes in the body. Stylizes the person, stores it, saves it as a
// per-child REFERENCE image (subject anchor), and — when a name is given —
// generates a voice and creates/updates a People tile for them (the child is
// pinned). Returns { key, itemId }. Synchronous: this is the onboarding gate.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { isValidRelationship, relationshipNeedsSide } from './_lib/relationships.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const MAX_BYTES = 5 * 1024 * 1024;

async function uploadBytes(kind, ext, buffer, contentType) {
  const pathname = `${kind}/${randomUUID()}.${ext}`;
  await put(pathname, buffer, { access: 'private', contentType, addRandomSuffix: false });
  return pathname;
}

async function ttsBytes(text) {
  const key = process.env.Fletchers_AAC_Device;
  if (!key) return null;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: modelId }),
  });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const q = req.query || {};
  const childId = String(q.childId || 'fletcherpeterson').slice(0, 64);
  const style = String(q.style || '').slice(0, 80);
  const role = q.role === 'parent' ? 'parent' : 'child';
  const name = String(q.name || '').slice(0, 200).trim();
  const pronunciation = String(q.pronunciation || '').slice(0, 200).trim();
  // People model (docs/people-data-model.md): structured identity for this person.
  const relationship = String(q.relationship || '').slice(0, 40).trim().toLowerCase();
  const side = (q.side === 'maternal' || q.side === 'paternal') ? q.side : null;
  const givenName = String(q.given || '').slice(0, 120).trim();
  const pronoun = (q.pronoun === 'she' || q.pronoun === 'he' || q.pronoun === 'they') ? q.pronoun : null;
  const birthOrder = (Number.isFinite(+q.birthOrder) && +q.birthOrder > 0) ? Math.floor(+q.birthOrder) : null;

  let buffer;
  try {
    const chunks = []; let total = 0;
    for await (const chunk of req) { total += chunk.length; if (total > MAX_BYTES) { res.status(413).json({ error: 'Photo too large' }); return; } chunks.push(chunk); }
    buffer = Buffer.concat(chunks);
  } catch (err) { res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) }); return; }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }
  const contentType = req.headers['content-type'] || 'image/jpeg';

  try {
    // 1) Stylize the person.
    let key;
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && style) {
      const subject = role === 'child' ? 'this child' : 'this person';
      const prompt = `Re-illustrate this photo as a ${style} head-and-shoulders portrait of ${subject} for a young child's ` +
        `communication app. Keep ${subject} clearly recognizable and friendly, on a simple soft background. No text in the image.`;
      const fd = new FormData();
      fd.append('model', 'gpt-image-1'); fd.append('prompt', prompt); fd.append('size', '1024x1024'); fd.append('n', '1');
      fd.append('image[]', new Blob([buffer], { type: contentType }), 'photo.jpg');
      const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: fd });
      if (!r.ok) { const d = await r.text().catch(() => ''); res.status(r.status).json({ error: 'Image generation failed', detail: d.slice(0, 400) }); return; }
      const b64 = (await r.json())?.data?.[0]?.b64_json;
      if (!b64) { res.status(502).json({ error: 'No image returned' }); return; }
      key = await uploadBytes('refimage', 'png', Buffer.from(b64, 'base64'), 'image/png');
    } else {
      key = await uploadBytes('refimage', 'jpg', buffer, contentType);
    }

    const db = sql();
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
      try { const mp3 = await ttsBytes(pronunciation || name); if (mp3) soundKey = await uploadBytes('itemsound', 'mp3', mp3, 'audio/mpeg'); } catch (_) {}

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
      const existing = await db`SELECT id FROM items WHERE child_id = ${childId} AND section = 'people' AND lower(label) = lower(${name}) LIMIT 1`;
      if (existing.length) {
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
            pronunciation = COALESCE(NULLIF(${pronunciation}, ''), pronunciation), updated_at = NOW()
          WHERE id = ${personId}`;
      } else {
        const pr = await db`
          INSERT INTO persons
            (child_id, display_name, given_name, relationship, side, pronoun, birth_order, is_self, reference_key, voice_key, pronunciation)
          VALUES
            (${childId}, ${name}, ${givenName || null}, ${rel}, ${relSide}, ${pronoun}, ${birthOrder}, ${isSelf}, ${key}, ${soundKey}, ${pronunciation || null})
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

// POST /api/onboard-subject?childId=&style=&role=child|parent  — raw photo bytes.
// Stylizes a person (child or parent) in the chosen style, stores it, and saves
// it as a per-child REFERENCE image (the subject anchor the rest of the
// onboarding renders will use). Returns { key } so the page can show it.
// Synchronous on purpose — this is the calibration gate before the walk-through.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const MAX_BYTES = 5 * 1024 * 1024;

async function uploadBytes(kind, ext, buffer, contentType) {
  const pathname = `${kind}/${randomUUID()}.${ext}`;
  await put(pathname, buffer, { access: 'private', contentType, addRandomSuffix: false });
  return pathname;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
  const style = String((req.query && req.query.style) || '').slice(0, 80);
  const role = (req.query && req.query.role) === 'parent' ? 'parent' : 'child';

  let buffer;
  try {
    const chunks = []; let total = 0;
    for await (const chunk of req) { total += chunk.length; if (total > MAX_BYTES) { res.status(413).json({ error: 'Photo too large' }); return; } chunks.push(chunk); }
    buffer = Buffer.concat(chunks);
  } catch (err) { res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) }); return; }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }
  const contentType = req.headers['content-type'] || 'image/jpeg';

  try {
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
      key = await uploadBytes('refimage', 'jpg', buffer, contentType);   // no style → keep original
    }

    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS reference_images (
        id BIGSERIAL PRIMARY KEY, child_id TEXT NOT NULL, blob_key TEXT NOT NULL,
        label TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await db`INSERT INTO reference_images (child_id, blob_key, label) VALUES (${childId}, ${key}, ${role})`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, key });
  } catch (err) {
    res.status(502).json({ error: 'Subject render failed', detail: String(err.message || err) });
  }
}

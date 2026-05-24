// /api/pending — the onboarding capture queue.
//   POST ?childId=&style=   raw photo bytes; uploads it, creates a draft, then
//                           renders (name + pronunciation + art + voice) in the
//                           background and marks the draft "ready". Responds with
//                           the draft id right away so the device never waits.
//   GET  ?childId=          list drafts for the review queue.
//   DELETE ?id=             reject a draft (delete it + its blobs).
// Auth-gated; needs OPENAI_API_KEY (art/name) and the ElevenLabs key (voice).
import { put, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const MAX_BYTES = 5 * 1024 * 1024;

async function ensureTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS pending_tiles (
      id BIGSERIAL PRIMARY KEY,
      child_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      style TEXT, label TEXT, pronunciation TEXT,
      source_key TEXT, image_key TEXT, sound_key TEXT, error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
}

async function uploadBytes(kind, ext, buffer, contentType) {
  const pathname = `${kind}/${randomUUID()}.${ext}`;
  await put(pathname, buffer, { access: 'private', contentType, addRandomSuffix: false });
  return pathname;
}

async function describePhoto(dataUrl, apiKey) {
  const prompt = "Identify the single main subject of this photo for a young child's communication app. " +
    "Respond with strict JSON only: {\"label\":\"<1-2 word everyday name, Capitalized>\",\"pronunciation\":\"<simple phonetic spelling for text-to-speech, e.g. buh-NAN-uh>\"}.";
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }] }],
      response_format: { type: 'json_object' }, max_tokens: 80,
    }),
  });
  if (!r.ok) return { label: '', pronunciation: '' };
  let out = {};
  try { out = JSON.parse((await r.json()).choices[0].message.content); } catch (_) {}
  return { label: typeof out.label === 'string' ? out.label.slice(0, 80) : '', pronunciation: typeof out.pronunciation === 'string' ? out.pronunciation.slice(0, 120) : '' };
}

async function stylizePhoto(buffer, contentType, label, style, apiKey) {
  const subject = label ? `"${label}"` : 'the main subject';
  const prompt = `Re-illustrate this photograph as a ${style} of ${subject} for a young child's communication app. ` +
    `Keep ${subject} clearly recognizable and centered, on a simple soft uncluttered background, bright and gentle. No text in the image.`;
  const fd = new FormData();
  fd.append('model', 'gpt-image-1'); fd.append('prompt', prompt); fd.append('size', '1024x1024'); fd.append('n', '1');
  fd.append('image[]', new Blob([buffer], { type: contentType }), 'photo.jpg');
  const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: fd });
  if (!r.ok) throw new Error('image gen ' + r.status);
  const b64 = (await r.json())?.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image returned');
  return Buffer.from(b64, 'base64');
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

async function processPending(db, id, buffer, contentType, style) {
  try {
    await db`UPDATE pending_tiles SET status = 'processing', updated_at = now() WHERE id = ${id}`;
    const apiKey = process.env.OPENAI_API_KEY;
    const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
    const desc = apiKey ? await describePhoto(dataUrl, apiKey) : { label: '', pronunciation: '' };
    let imageKey;
    if (apiKey && style) imageKey = await uploadBytes('itemimage', 'png', await stylizePhoto(buffer, contentType, desc.label, style, apiKey), 'image/png');
    else imageKey = await uploadBytes('itemimage', 'jpg', buffer, contentType);   // "keep original" path
    let soundKey = null;
    try { const mp3 = await ttsBytes((desc.pronunciation || desc.label || 'this').trim()); if (mp3) soundKey = await uploadBytes('itemsound', 'mp3', mp3, 'audio/mpeg'); } catch (_) {}
    await db`UPDATE pending_tiles SET status='ready', label=${desc.label || null}, pronunciation=${desc.pronunciation || null}, image_key=${imageKey}, sound_key=${soundKey}, updated_at=now() WHERE id=${id}`;
  } catch (err) {
    try { await db`UPDATE pending_tiles SET status='failed', error=${String(err.message || err).slice(0, 300)}, updated_at=now() WHERE id=${id}`; } catch (_) {}
  }
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const db = sql();
  try { await ensureTable(db); } catch (_) {}
  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);

  if (req.method === 'GET') {
    try {
      const rows = await db`
        SELECT id, status, label, pronunciation, image_key, sound_key, error, created_at
        FROM pending_tiles WHERE child_id = ${childId} AND status <> 'approved'
        ORDER BY created_at`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ pending: rows });
    } catch (err) { res.status(500).json({ error: 'List failed', detail: String(err.message || err) }); }
    return;
  }

  if (req.method === 'DELETE') {
    const id = parseInt(req.query.id, 10);
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    try {
      const rows = await db`SELECT source_key, image_key, sound_key FROM pending_tiles WHERE id = ${id} AND child_id = ${childId}`;
      await db`DELETE FROM pending_tiles WHERE id = ${id} AND child_id = ${childId}`;
      for (const k of [rows[0]?.source_key, rows[0]?.image_key, rows[0]?.sound_key]) { if (k) { try { await del(k); } catch (_) {} } }
      res.status(200).json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Delete failed', detail: String(err.message || err) }); }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const style = String((req.query && req.query.style) || '').slice(0, 80);
  let buffer;
  try {
    const chunks = []; let total = 0;
    for await (const chunk of req) { total += chunk.length; if (total > MAX_BYTES) { res.status(413).json({ error: 'Photo too large' }); return; } chunks.push(chunk); }
    buffer = Buffer.concat(chunks);
  } catch (err) { res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) }); return; }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }
  const contentType = req.headers['content-type'] || 'image/jpeg';

  try {
    const sourceKey = await uploadBytes('pendingsrc', 'jpg', buffer, contentType);
    const rows = await db`INSERT INTO pending_tiles (child_id, status, style, source_key) VALUES (${childId}, 'queued', ${style || null}, ${sourceKey}) RETURNING id`;
    const id = Number(rows[0].id);
    res.status(200).json({ id, status: 'queued' });   // device is free immediately
    await processPending(db, id, buffer, contentType, style);   // render continues server-side
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Queue failed', detail: String(err.message || err) });
  }
}

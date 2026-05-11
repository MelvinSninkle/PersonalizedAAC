// POST /api/upload?kind=image|sound&ext=jpg|mp3 — raw bytes in body.
// Uploads to the private Blob store; only the `key` is meaningful to the
// client (reads go through /api/media). Auth-gated.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB ceiling — Vercel Function body limit is ~4.5 MB

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const kind = (req.query.kind || 'misc').toString().replace(/[^a-z0-9]/gi, '') || 'misc';
  const ext = (req.query.ext || 'bin').toString().replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
  const contentType = req.headers['content-type'] || 'application/octet-stream';

  let buffer;
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        res.status(413).json({ error: 'Payload too large', max: MAX_BYTES });
        return;
      }
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  } catch (err) {
    res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) });
    return;
  }
  if (!buffer.length) {
    res.status(400).json({ error: 'Empty body' });
    return;
  }

  const pathname = `${kind}/${randomUUID()}.${ext}`;
  try {
    await put(pathname, buffer, {
      access: 'private',
      contentType,
      addRandomSuffix: false,
    });
    res.status(200).json({ key: pathname });
  } catch (err) {
    res.status(500).json({ error: 'Blob upload failed', detail: String(err.message || err) });
  }
}

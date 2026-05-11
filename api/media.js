// GET /api/media?key=<pathname> — auth-gated proxy for private blobs.
// The client passes the bearer token; we stream the bytes back so <img>/<audio>
// elements can use a same-origin URL (after the client wraps the response in
// an object URL).
import { get } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (!key) {
    res.status(400).json({ error: 'key required' });
    return;
  }

  let result;
  try {
    result = await get(key, { access: 'private' });
  } catch (err) {
    res.status(404).json({ error: 'Blob not found', detail: String(err.message || err) });
    return;
  }
  if (result.statusCode !== 200 || !result.stream) {
    res.status(502).json({ error: 'Unexpected blob response' });
    return;
  }

  res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
  if (result.blob.size) res.setHeader('Content-Length', result.blob.size);
  // Private, short-lived browser cache — the bytes are sensitive.
  res.setHeader('Cache-Control', 'private, max-age=300');

  const reader = result.stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Stream failed', detail: String(err.message || err) });
    } else {
      res.end();
    }
  }
}

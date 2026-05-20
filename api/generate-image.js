// POST /api/generate-image?label=&style= — raw photo bytes in the body.
// Re-illustrates the photo in the chosen art style via OpenAI's image model
// and returns the generated PNG bytes directly (the client uploads/caches it
// the same way as any other tile image). Auth-gated. Requires OPENAI_API_KEY.
import { checkAuth } from './_lib/auth.js';

// Image generation is slow (often 15–40s) — give the function room. bodyParser
// off so we can stream the raw photo bytes.
export const config = { api: { bodyParser: false }, maxDuration: 60 };

const MAX_BYTES = 5 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY env var not configured' });
    return;
  }

  const label = String((req.query && req.query.label) || '').slice(0, 80).trim();
  const style = String((req.query && req.query.style) || 'illustrated').slice(0, 80).trim();

  let buffer;
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) { res.status(413).json({ error: 'Photo too large', max: MAX_BYTES }); return; }
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  } catch (err) {
    res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) });
    return;
  }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }

  const subject = label ? `"${label}"` : 'the main subject';
  const prompt =
    `Re-illustrate this photograph as a ${style} of ${subject} for a young child's ` +
    `communication app. Keep ${subject} clearly recognizable and centered, on a simple, ` +
    `soft, uncluttered background, with bright friendly colors and a gentle, age-appropriate ` +
    `look. Do not include any text, words, or letters in the image.`;

  try {
    const fd = new FormData();
    fd.append('model', 'gpt-image-1');
    fd.append('prompt', prompt);
    fd.append('size', '1024x1024');
    fd.append('n', '1');
    fd.append('image', new Blob([buffer], { type: req.headers['content-type'] || 'image/jpeg' }), 'photo.jpg');

    const upstream = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: fd,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      res.status(upstream.status).json({ error: 'Image generation failed', detail: detail.slice(0, 500) });
      return;
    }
    const data = await upstream.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) { res.status(502).json({ error: 'No image returned from generator' }); return; }
    const out = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', out.length);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(out);
  } catch (err) {
    res.status(502).json({ error: 'Generator request failed', detail: String(err.message || err) });
  }
}

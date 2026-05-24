// POST /api/describe-image — raw photo bytes in the body. Uses an OpenAI vision
// model to suggest a toddler-friendly label and a phonetic pronunciation for TTS.
// Returns { label, pronunciation }. Auth-gated; needs OPENAI_API_KEY.
import { checkAuth } from './_lib/auth.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

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

  const contentType = req.headers['content-type'] || 'image/jpeg';
  const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
  const prompt =
    "You are labeling a photo for a young child's communication (AAC) app. Identify the single main " +
    "subject. Respond with strict JSON only: {\"label\":\"<1-2 word everyday name, Capitalized>\", " +
    "\"pronunciation\":\"<simple phonetic spelling for a text-to-speech voice, e.g. buh-NAN-uh>\"}. " +
    "Keep the label concrete and child-friendly. No extra text.";

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
          ],
        }],
        response_format: { type: 'json_object' },
        max_tokens: 80,
      }),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      res.status(upstream.status).json({ error: 'Vision request failed', detail: detail.slice(0, 400) });
      return;
    }
    const data = await upstream.json();
    let out = {};
    try { out = JSON.parse(data.choices[0].message.content); } catch (_) {}
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      label: typeof out.label === 'string' ? out.label.slice(0, 80) : '',
      pronunciation: typeof out.pronunciation === 'string' ? out.pronunciation.slice(0, 120) : '',
    });
  } catch (err) {
    res.status(502).json({ error: 'Vision request failed', detail: String(err.message || err) });
  }
}

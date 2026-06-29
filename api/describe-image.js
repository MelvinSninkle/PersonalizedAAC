// POST /api/describe-image — raw photo bytes in the body. Uses an OpenAI vision
// model to suggest a toddler-friendly label and a phonetic pronunciation for TTS.
// Returns { label, pronunciation }. Auth-gated; needs OPENAI_API_KEY.
import { checkAuth } from './_lib/auth.js';
import { describePhotoLabel } from './_lib/vision.js';

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
  // Phonetic-pronunciation generation was removed (PRD: "selection over
  // generation" — TTS speaks straight from the tile title, which the parent
  // can correct). We only suggest a label now; cheaper + fewer tokens.
  const prompt =
    "You are labeling a photo for a young child's communication (AAC) app. Identify the single main " +
    "subject. Respond with strict JSON only: {\"label\":\"<1-2 word everyday name, Capitalized>\"}. " +
    "Keep the label concrete and child-friendly. No extra text.";

  const result = await describePhotoLabel({ apiKey, dataUrl, prompt });
  if (!result.ok) {
    res.status(result.status).json({ error: 'Vision request failed', detail: result.detail });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ label: result.label });
}

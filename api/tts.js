// Vercel Serverless Function: POST /api/tts { text: string } -> audio/mpeg bytes
// Env vars:
//   Fletchers_AAC_Device  (required — ElevenLabs API key)
//   ELEVENLABS_VOICE_ID   (optional, defaults to "Rachel")
//   ELEVENLABS_MODEL_ID   (optional, defaults to "eleven_turbo_v2_5")

const MAX_TEXT_LEN = 300;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.Fletchers_AAC_Device;
  if (!apiKey) {
    res.status(500).json({ error: 'Fletchers_AAC_Device env var not configured' });
    return;
  }
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  const text = typeof req.body === 'object' && req.body !== null ? req.body.text : null;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing "text" string in body' });
    return;
  }
  if (text.length > MAX_TEXT_LEN) {
    res.status(400).json({ error: `text too long (max ${MAX_TEXT_LEN} chars)` });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: modelId }),
    });
  } catch (err) {
    res.status(502).json({ error: 'Upstream fetch failed', detail: String(err) });
    return;
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    res.status(upstream.status).json({ error: 'ElevenLabs error', detail: detail.slice(0, 500) });
    return;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(buffer);
}

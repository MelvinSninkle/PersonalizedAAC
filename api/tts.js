// Vercel Serverless Function: POST /api/tts { text, emotion? } -> audio/mpeg
// emotion: one of EMOTIONS keys; maps to ElevenLabs voice_settings.
// Env vars:
//   Fletchers_AAC_Device  (required — ElevenLabs API key)
//   ELEVENLABS_VOICE_ID   (optional, defaults to "Rachel")
//   ELEVENLABS_MODEL_ID   (optional, defaults to "eleven_turbo_v2_5")
import { checkAuth } from './_lib/auth.js';

const MAX_TEXT_LEN = 300;

// Voice-settings presets. Sent to ElevenLabs as `voice_settings`.
// 'default' is omitted so ElevenLabs uses the voice's stored defaults.
const EMOTIONS = {
  default:  null,
  happy:    { stability: 0.35, similarity_boost: 0.75, style: 0.65, use_speaker_boost: true },
  sad:      { stability: 0.70, similarity_boost: 0.85, style: 0.20, use_speaker_boost: true },
  excited:  { stability: 0.20, similarity_boost: 0.70, style: 0.85, use_speaker_boost: true },
  calm:     { stability: 0.85, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true },
  whisper:  { stability: 0.60, similarity_boost: 0.90, style: 0.10, use_speaker_boost: false },
};

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

  const apiKey = process.env.Fletchers_AAC_Device;
  if (!apiKey) {
    res.status(500).json({ error: 'Fletchers_AAC_Device env var not configured' });
    return;
  }
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
  const text = body.text;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing "text" string in body' });
    return;
  }
  if (text.length > MAX_TEXT_LEN) {
    res.status(400).json({ error: `text too long (max ${MAX_TEXT_LEN} chars)` });
    return;
  }

  const emotionKey = typeof body.emotion === 'string' ? body.emotion.toLowerCase() : 'default';
  const voiceSettings = EMOTIONS[emotionKey] ?? null;

  const elevenBody = { text, model_id: modelId };
  if (voiceSettings) elevenBody.voice_settings = voiceSettings;

  let upstream;
  try {
    upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(elevenBody),
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

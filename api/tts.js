// Vercel Serverless Function: POST /api/tts { text, emotion? } -> audio/mpeg
// emotion: one of EMOTIONS keys; maps to ElevenLabs voice_settings.
// Env vars:
//   Fletchers_AAC_Device  (required — ElevenLabs API key)
//   ELEVENLABS_VOICE_ID   (optional, defaults to "Rachel")
//   ELEVENLABS_MODEL_ID   (optional, defaults to "eleven_turbo_v2_5")
//
// Server-side cache. The same phrase ("This is a dog", "Item 1 of 5", "Happy
// Birthday!") is asked for thousands of times across slideshows + scheduled
// prompts + reward cheers + AAC speech. Caching by sha256(model|voice|emotion|
// text) in Vercel Blob means ElevenLabs is hit once per unique phrase ever, not
// once per playback — at scale this is the single biggest TTS cost lever.
//
// Key includes voice so per-child voice cloning (when shipped) stores its own
// rendition without colliding. MP3s are tiny (~5-30KB), so we let the cache
// accumulate indefinitely; Blob storage is ~$0.023/GB/mo.
import { createHash } from 'node:crypto';
import { put, get } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { entitlementFor, boardOwnerId } from './_lib/credits.js';
import { voiceCharsThisMonth, logVoiceGeneration } from './_lib/voice-usage.js';

const MAX_TEXT_LEN = 300;

const EMOTIONS = {
  default:  null,
  happy:    { stability: 0.35, similarity_boost: 0.75, style: 0.65, use_speaker_boost: true },
  sad:      { stability: 0.70, similarity_boost: 0.85, style: 0.20, use_speaker_boost: true },
  excited:  { stability: 0.20, similarity_boost: 0.70, style: 0.85, use_speaker_boost: true },
  calm:     { stability: 0.85, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true },
  whisper:  { stability: 0.60, similarity_boost: 0.90, style: 0.10, use_speaker_boost: false },
};

function cacheKeyFor(modelId, voiceId, emotionKey, text) {
  const h = createHash('sha256')
    .update(`${modelId}|${voiceId}|${emotionKey}|${text}`)
    .digest('hex')
    .slice(0, 40);
  return `tts/${h}.mp3`;
}

async function readCached(key) {
  try {
    const result = await get(key, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const reader = result.stream.getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const apiKey = process.env.Fletchers_AAC_Device;
  if (!apiKey) { res.status(500).json({ error: 'Fletchers_AAC_Device env var not configured' }); return; }
  let voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
  const text = body.text;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing "text" string in body' }); return;
  }
  if (text.length > MAX_TEXT_LEN) {
    res.status(400).json({ error: `text too long (max ${MAX_TEXT_LEN} chars)` }); return;
  }

  // Per-child voice: an explicit voiceId wins; else resolve the child's saved
  // voice (child_settings.voiceId); else the env default above. The cache key
  // includes the voice, so each voice's renditions cache independently.
  const explicitVoice = String((typeof body.voiceId === 'string' && body.voiceId) || (req.query && req.query.voiceId) || '');
  if (/^[A-Za-z0-9]{8,40}$/.test(explicitVoice)) {
    voiceId = explicitVoice;
  } else {
    const childId = String((typeof body.childId === 'string' && body.childId) || (req.query && req.query.childId) || '').slice(0, 64);
    if (childId) {
      try {
        const row = (await sql()`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
        const v = row && row.settings && row.settings.voiceId;
        if (typeof v === 'string' && /^[A-Za-z0-9]{8,40}$/.test(v)) voiceId = v;
      } catch (_) { /* fall back to default voice */ }
    }
  }

  const emotionKey = typeof body.emotion === 'string' ? body.emotion.toLowerCase() : 'default';
  const voiceSettings = EMOTIONS[emotionKey] ?? null;

  // 1) Cache lookup. A force-refresh path is supported via ?nocache=1 so the
  //    Lab can re-render a phrase after a voice settings change.
  const noCache = String((req.query && req.query.nocache) || '') === '1';
  const key = cacheKeyFor(modelId, voiceId, emotionKey, text);
  if (!noCache) {
    const cached = await readCached(key);
    if (cached) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', cached.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-TTS-Cache', 'HIT');
      res.setHeader('X-TTS-Key', key);
      res.status(200).send(cached);
      return;
    }
  }

  // 2) MISS — this is the only path that costs money, so it's the only path
  //    that's metered. Attribute the spend to the signed-in account, else the
  //    board owner's account (the kid board authenticates as a device).
  //    Enforce the tier's monthly voice budget: cached phrases above never
  //    count; only NEW synthesis does.
  const meterChildId = String((typeof body.childId === 'string' && body.childId) || (req.query && req.query.childId) || '').slice(0, 64);
  let meterUid = Number(auth.user && (auth.user.uid || auth.user.id)) || null;
  let db2 = null;
  try {
    db2 = sql();
    if (!meterUid && meterChildId) meterUid = await boardOwnerId(db2, meterChildId);
    const ent = await entitlementFor(db2, meterUid ? { uid: meterUid, role: auth.user && auth.user.role } : (auth.user || null));
    const cap = ent.features.voiceCharsPerMonth;
    if (Number.isFinite(cap)) {
      const used = meterUid ? await voiceCharsThisMonth(db2, meterUid) : 0;
      if (cap <= 0 || used + text.length > cap) {
        res.status(402).json({
          error: 'voice_limit',
          detail: cap <= 0
            ? 'Speech mode is part of My World memberships — subscribe to turn spoken words into tiles.'
            : 'This month’s voice budget is used up. Already-spoken words keep working; new ones resume next month (or upgrade for a bigger budget).',
          used, cap: cap <= 0 ? 0 : cap, tier: ent.tier,
        });
        return;
      }
    }
  } catch (_) { /* metering must never take speech down — fall through */ }

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

  // 3) Cache the bytes for everyone else. Best-effort — a Blob write failure
  //    never blocks the response the caller is already waiting for.
  try {
    await put(key, buffer, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
  } catch (_) { /* logging-only path; caller already has its audio */ }

  // 4) Book the spend (admin Usage panel + the monthly tier budget). The
  //    client may tag what kind of speech this was (listen | teach | board |
  //    reward); untagged calls book as 'other'.
  try {
    const kind = ['listen', 'teach', 'board', 'reward'].includes(String(body.kind || '')) ? String(body.kind) : 'other';
    if (db2) await logVoiceGeneration(db2, { userId: meterUid, childId: meterChildId || null,
                                             chars: text.length, kind, voiceId, text });
  } catch (_) { /* metering must never take speech down */ }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-TTS-Cache', 'MISS');
  res.setHeader('X-TTS-Key', key);
  res.status(200).send(buffer);
}

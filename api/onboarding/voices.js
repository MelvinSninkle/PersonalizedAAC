// GET /api/onboarding/voices → { voices: [{ id, name, description, previewUrl }] }
//
// The onboarding voice picker needs the ElevenLabs voices available to the
// account, with a preview sample, so the parent can choose how the board speaks.
// Read-only; the chosen voice id is saved on the child (child_settings.voiceId)
// by the Child step and used for every tile's generated audio.
import { checkAuth } from '../_lib/auth.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const key = process.env.Fletchers_AAC_Device;
  if (!key) { res.status(500).json({ error: 'ElevenLabs key (Fletchers_AAC_Device) not configured' }); return; }

  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      res.status(502).json({ error: 'voices fetch failed', detail: detail.slice(0, 300) });
      return;
    }
    const data = await r.json();
    const voices = (Array.isArray(data.voices) ? data.voices : []).map(v => {
      const l = v.labels || {};
      const description = [l.gender, l.accent, l.age, l.description, l.use_case]
        .filter(Boolean).join(' · ') || (v.category || null);
      return { id: v.voice_id, name: v.name, description, previewUrl: v.preview_url || null };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ voices });
  } catch (err) {
    res.status(500).json({ error: 'voices failed', detail: String(err.message || err) });
  }
}

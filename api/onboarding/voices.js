// GET /api/onboarding/voices → { voices: [{ id, name, gender, accent }], sampleText }
//
// The curated voice choices shown in onboarding. The parent picks one; the
// chosen id is saved on the child (child_settings.voiceId) by the Child step and
// used for every tile's generated audio. The admin's personal/default voice
// (env ELEVENLABS_VOICE_ID) is appended ONLY for an admin caller, so it stays
// reserved for the admin's own child. Previews are played via /api/tts with the
// shared sampleText so each voice says the same lines.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { listVoices, VOICE_SAMPLE_TEXT } from '../_lib/voices.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  // Lab-managed catalog (voices table, seeded from the legacy hardcoded list).
  const voices = (await listVoices(sql())).map(v => ({ id: v.id, name: v.name, gender: v.gender, accent: v.accent }));
  if (auth.user.role === 'admin' && process.env.ELEVENLABS_VOICE_ID) {
    voices.unshift({ id: process.env.ELEVENLABS_VOICE_ID, name: 'My voice', gender: '', accent: 'Admin default', adminOnly: true });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ voices, sampleText: VOICE_SAMPLE_TEXT });
}

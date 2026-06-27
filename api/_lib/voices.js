// The TTS voices a parent can choose during onboarding. Each is a pre-made
// ElevenLabs voice. The admin's personal/default voice (env ELEVENLABS_VOICE_ID)
// is intentionally NOT in this list — it stays reserved for the admin's own
// child. Only an admin may select it (see isSelectableVoice / onboarding/voices).
export const ONBOARDING_VOICES = [
  { id: 'sB7vwSCyX0tQmU24cW2C', name: 'Jon',   gender: 'Male',   accent: 'American' },
  { id: 'MClEFoImJXBTgLwdLI5n', name: 'Ivy',   gender: 'Female', accent: 'American' },
  { id: 'oO7sLA3dWfQXsKeSAjpA', name: 'Sia',   gender: 'Female', accent: 'Indian' },
  { id: 'wJ5MX7uuKXZwFqGdWM4N', name: 'Raj',   gender: 'Male',   accent: 'Indian' },
  { id: 'Yg7C1g7suzNt5TisIqkZ', name: 'Jude',  gender: 'Male',   accent: 'British' },
  { id: 'LZAcK8Cx5QjdQhfBsJQZ', name: 'Grace', gender: 'Female', accent: 'British' },
];

// What every voice says in its onboarding preview.
export const VOICE_SAMPLE_TEXT =
  "If you select me, I'll be the voice your child hears whenever they tap on a tile. " +
  "I'll do a few tongue twisters if you like. Sally sells sea shells down by the sea shore. " +
  "Peter piper picked a peck of pickle peppers. So, what do you say? Am I the one you're going to choose?";

// May `id` be assigned as a child's voice by this caller? The six catalog voices
// are open to everyone; the admin default (and any other voice) is admin-only.
export function isSelectableVoice(id, { isAdmin = false } = {}) {
  if (ONBOARDING_VOICES.some(v => v.id === id)) return true;
  return !!isAdmin;
}

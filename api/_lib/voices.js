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
// (Sync legacy check — prefer voiceSelectable(db, …) which reads the table.)
export function isSelectableVoice(id, { isAdmin = false } = {}) {
  if (ONBOARDING_VOICES.some(v => v.id === id)) return true;
  return !!isAdmin;
}

// ---- DB-backed voice catalog (Lab-managed; voices are DATA, not code) ------

export async function ensureVoicesTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS voices (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      gender     TEXT,
      accent     TEXT,
      active     BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  // One-time seed from the legacy hardcoded list so existing deployments keep
  // their catalog (and existing children's voiceIds stay selectable).
  const n = await db`SELECT count(*)::int AS n FROM voices`;
  if (!Number(n[0].n)) {
    for (let i = 0; i < ONBOARDING_VOICES.length; i++) {
      const v = ONBOARDING_VOICES[i];
      await db`INSERT INTO voices (id, name, gender, accent, active, sort_order)
               VALUES (${v.id}, ${v.name}, ${v.gender}, ${v.accent}, TRUE, ${i})
               ON CONFLICT (id) DO NOTHING`;
    }
  }
}

/// Active catalog voices in picker order. Falls back to the hardcoded list if
/// the table is unreachable, so onboarding never loses its voice step.
export async function listVoices(db, { includeInactive = false } = {}) {
  try {
    await ensureVoicesTable(db);
    const rows = includeInactive
      ? await db`SELECT id, name, gender, accent, active, sort_order FROM voices ORDER BY sort_order, created_at`
      : await db`SELECT id, name, gender, accent, active, sort_order FROM voices WHERE active = TRUE ORDER BY sort_order, created_at`;
    if (rows.length || includeInactive) return rows.map(r => ({ ...r, active: !!r.active }));
  } catch (_) { /* fall through */ }
  return ONBOARDING_VOICES.map((v, i) => ({ ...v, active: true, sort_order: i }));
}

/// Async, table-aware selectability: any ACTIVE catalog voice is open to
/// everyone; anything else (incl. the env admin voice) is admin-only.
export async function voiceSelectable(db, id, { isAdmin = false } = {}) {
  if (isAdmin) return true;
  try {
    const list = await listVoices(db);
    return list.some(v => v.id === id);
  } catch (_) { return isSelectableVoice(id, { isAdmin }); }
}

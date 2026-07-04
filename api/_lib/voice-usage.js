// ElevenLabs voice-generation metering — the voice twin of image_generations.
//
// Only cache MISSES cost money (api/tts.js caches every rendition forever by
// sha256(model|voice|emotion|text), so a phrase is billed once per voice EVER).
// Each miss is logged here with its character count and an estimated cost so
// the admin Usage panel can tally voice spend per account next to image spend,
// and so the per-tier monthly voice budget can be enforced.
//
// COST_ESTIMATE: ElevenLabs bills by character; turbo-family models run
// roughly $0.10–0.30 per 1k chars depending on plan volume. We book a
// conservative 15¢/1k so the admin tally errs high, never low.
export const VOICE_CENTS_PER_1K_CHARS = 15;

export function voiceCostCents(chars) {
  return Math.round((chars * VOICE_CENTS_PER_1K_CHARS) / 1000 * 100) / 100;
}

export async function ensureVoiceGenerations(db) {
  await db`
    CREATE TABLE IF NOT EXISTS voice_generations (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT,
      child_id TEXT,
      chars INT NOT NULL,
      cost_cents REAL,
      kind TEXT,
      voice_id TEXT,
      text_preview TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE INDEX IF NOT EXISTS voice_gen_user_month_idx ON voice_generations(user_id, created_at)`;
}

export async function logVoiceGeneration(db, { userId = null, childId = null, chars, kind = 'other', voiceId = null, text = '' }) {
  await ensureVoiceGenerations(db);
  await db`
    INSERT INTO voice_generations (user_id, child_id, chars, cost_cents, kind, voice_id, text_preview)
    VALUES (${userId ? Number(userId) : null}, ${childId || null}, ${Math.max(0, Math.floor(chars))},
            ${voiceCostCents(chars)}, ${kind}, ${voiceId || null}, ${String(text).slice(0, 120)})`;
}

// Characters of NEW speech synthesized for this account this calendar month.
export async function voiceCharsThisMonth(db, userId) {
  const uid = Number(userId);
  if (!uid) return 0;
  try {
    const r = await db`
      SELECT COALESCE(SUM(chars), 0)::int AS n FROM voice_generations
      WHERE user_id = ${uid} AND created_at >= date_trunc('month', NOW())`;
    return Number(r[0]?.n || 0);
  } catch (_) { return 0; }
}

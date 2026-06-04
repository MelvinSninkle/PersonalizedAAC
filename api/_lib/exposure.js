// Exposure-tick core logic, shared by /api/exposure-tick and inline from
// /api/game-log (where every finished session implies one exposure of its
// dominant skill_slug). PRD §8.

/// Stage targets per PRD §8.3 escalation ladder.
const STAGE_TARGETS = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 };

/// Minutes until the next exposure given (stage, post-increment count).
/// Stage 1 is "dense clustering, catch active-attention windows" (PRD §8.4).
/// Stages 3-5 are maintenance rotation (~monthly).
export function intervalMinutes(stage, count) {
  if (stage <= 1) {
    if (count < 3)  return 10;                    // intra-session, ~5-10 min apart
    if (count < 5)  return 24 * 60;               // next day, AM/PM
    if (count < 7)  return 2 * 24 * 60;
    if (count < 9)  return 7 * 24 * 60;
    return 14 * 24 * 60;                          // exposure 10 → +2 weeks
  }
  if (stage === 2) {
    if (count < 15) return 2 * 24 * 60;
    if (count < 19) return 7 * 24 * 60;
    return 10 * 24 * 60;
  }
  return 30 * 24 * 60;                            // stages 3-5 monthly
}

/// Tick one exposure for (childId, skillSlug). Idempotent only in the sense
/// that calling it N times records N exposures — that's by design.
/// Returns the updated protocol row.
export async function tickExposure(db, { childId, skillSlug, source = 'game', sessionId = null }) {
  // Upsert protocol row.
  const existing = await db`
    SELECT id, stage, target_count, current_count, spacing_mode, status
    FROM exposure_protocols
    WHERE child_id = ${childId} AND skill_slug = ${skillSlug} LIMIT 1`;
  let row;
  if (existing.length === 0) {
    const created = await db`
      INSERT INTO exposure_protocols (child_id, skill_slug, stage, target_count, current_count, spacing_mode, status, last_seen_at, next_due_at)
      VALUES (${childId}, ${skillSlug}, 1, 10, 0, 'standard', 'intro', NOW(), NOW())
      RETURNING id, stage, target_count, current_count, spacing_mode, status`;
    row = created[0];
  } else {
    row = existing[0];
  }

  // Log the event.
  await db`
    INSERT INTO exposure_events (protocol_id, session_id, source, occurred_at)
    VALUES (${row.id}, ${sessionId}, ${source}, NOW())`;

  // Advance + maybe escalate.
  let stage = Number(row.stage);
  let target = Number(row.target_count);
  let nextCount = Number(row.current_count) + 1;
  let status = row.status;

  if (status !== 'eval_flagged' && status !== 'mastered' && nextCount >= target) {
    if (stage >= 5) {
      status = 'eval_flagged';                    // PRD §8.6 consider-eval signal
    } else {
      stage += 1;
      target = STAGE_TARGETS[stage] || target;
      status = 'spacing';
    }
  } else if (status === 'intro' && nextCount >= 3) {
    status = 'spacing';
  }

  // Tightened spacing halves the interval (PRD §8.5 — Phase 7 flips the
  // spacing_mode based on spike absence).
  const mins = intervalMinutes(stage, nextCount);
  const adjMins = row.spacing_mode === 'tightened' ? Math.max(5, Math.round(mins / 2)) : mins;

  const updated = await db`
    UPDATE exposure_protocols SET
      stage = ${stage},
      target_count = ${target},
      current_count = ${nextCount},
      status = ${status},
      last_seen_at = NOW(),
      next_due_at = NOW() + (${adjMins}::int || ' minutes')::interval
    WHERE id = ${row.id}
    RETURNING id, stage, target_count, current_count, spacing_mode, status, next_due_at`;
  return updated[0];
}

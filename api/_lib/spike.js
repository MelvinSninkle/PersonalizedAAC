// Mastery-signal detection per PRD §6. Runs INLINE inside /api/game-log
// after a session is persisted: pull the last 15 prior sessions for the
// child × skill × mode, compute μ/σ over their pass rate, and flag any
// session whose pass rate clears the 2σ / 3σ threshold (or is 100%).
//
// Computed twice per session:
//   1. All methods (button taps + facilitator marks all count).
//   2. Child-generated-only subset (voice/gesture/object) — these spikes
//      carry the most evidentiary weight (PRD §4.2) because they show the
//      child producing the answer themselves.
//
// Skipped:
//   - Pre-cutover sessions (scoring_version < 2) so the legacy first-try-only
//     scoring doesn't contaminate the baseline.
//   - Sessions with no skill_slug, no mode, or fewer than 10 prior sessions
//     in the same (skill, mode) bucket (PRD §6.1 baseline gate).
//
// Returns the inserted session_flags rows so callers can include them in
// the session response if useful.

const MIN_BASELINE_N = 10;          // PRD §6.1 — ≥10 sessions before any flag
const ROLLING_WINDOW = 15;           // PRD §6.3 — rolling window, not all-time
const MIN_SIGMA = 0.05;              // PRD §6.3 + plan sign-off — 5pct floor

function computeBaseline(samples) {
  const rates = samples
    .map(s => ({ correct: Number(s.correct), total: Number(s.total) }))
    .filter(s => Number.isFinite(s.total) && s.total > 0)
    .map(s => s.correct / s.total);
  if (rates.length < MIN_BASELINE_N) return null;
  const mu = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((acc, x) => acc + (x - mu) * (x - mu), 0) / rates.length;
  const sigma = Math.max(MIN_SIGMA, Math.sqrt(variance));
  return { mu, sigma, n: rates.length };
}

function flagsForRate(currentPct, base, childGeneratedOnly) {
  if (!base || !Number.isFinite(currentPct)) return [];
  const out = [];
  const sigmaLevel = (currentPct - base.mu) / base.sigma;
  // Perfect-pass is logged INDEPENDENT of sigma so a 100% session in a
  // high-baseline child still surfaces, and a 100% session that's also 3σ
  // gets BOTH flags (the badge UI can dedupe).
  if (currentPct >= 0.999) {
    out.push({ kind: 'perfect_pass', sigma: sigmaLevel, observedPct: currentPct,
               baselineMu: base.mu, baselineSigma: base.sigma, childGeneratedOnly });
  }
  if (sigmaLevel >= 3) {
    out.push({ kind: 'spike_3sigma', sigma: sigmaLevel, observedPct: currentPct,
               baselineMu: base.mu, baselineSigma: base.sigma, childGeneratedOnly });
  } else if (sigmaLevel >= 2) {
    out.push({ kind: 'spike_2sigma', sigma: sigmaLevel, observedPct: currentPct,
               baselineMu: base.mu, baselineSigma: base.sigma, childGeneratedOnly });
  }
  return out;
}

export async function detectSpikes(db, { sessionId, childId, skillSlug, mode, scoringVersion }) {
  if (Number(scoringVersion) < 2 || !skillSlug || !mode || !Number.isFinite(sessionId)) return [];

  // ---- All-methods baseline. Pass rate uses the honest denominator
  // (slides_attempted when present, item_count for legacy fallback). ----
  const allPrior = await db`
    SELECT correct_count::float AS correct,
           COALESCE(NULLIF(slides_attempted, 0), NULLIF(item_count, 0))::float AS total
    FROM sessions
    WHERE child_id = ${childId} AND skill_slug = ${skillSlug} AND mode = ${mode}
      AND id <> ${sessionId} AND scoring_version >= 2
      AND started_at >= now() - interval '90 days'
    ORDER BY started_at DESC
    LIMIT ${ROLLING_WINDOW}`;
  const allCurrent = await db`
    SELECT correct_count::float AS correct,
           COALESCE(NULLIF(slides_attempted, 0), NULLIF(item_count, 0))::float AS total
    FROM sessions WHERE id = ${sessionId} LIMIT 1`;
  const allBase = computeBaseline(allPrior);
  const allPct  = (allCurrent.length && Number(allCurrent[0].total) > 0)
    ? Number(allCurrent[0].correct) / Number(allCurrent[0].total)
    : NaN;
  const allFlags = flagsForRate(allPct, allBase, false);

  // ---- Child-generated-only baseline. PRD §6.2 weighting: spikes via
  // voice/gesture/object carry the strongest evidence the child knows it. ----
  const cgPrior = await db`
    SELECT
      SUM(CASE WHEN a.correct AND a.child_generated THEN 1 ELSE 0 END)::float AS correct,
      SUM(CASE WHEN a.child_generated THEN 1 ELSE 0 END)::int AS total
    FROM sessions s
    JOIN game_attempts a ON a.session_id = s.id
    WHERE s.child_id = ${childId} AND s.skill_slug = ${skillSlug} AND s.mode = ${mode}
      AND s.id <> ${sessionId} AND s.scoring_version >= 2
      AND s.started_at >= now() - interval '90 days'
    GROUP BY s.id
    ORDER BY MAX(s.started_at) DESC
    LIMIT ${ROLLING_WINDOW}`;
  const cgCurrent = await db`
    SELECT
      SUM(CASE WHEN correct AND child_generated THEN 1 ELSE 0 END)::float AS correct,
      SUM(CASE WHEN child_generated THEN 1 ELSE 0 END)::int AS total
    FROM game_attempts WHERE session_id = ${sessionId}`;
  const cgBase = computeBaseline(cgPrior);
  const cgPct  = (cgCurrent.length && Number(cgCurrent[0].total) > 0)
    ? Number(cgCurrent[0].correct) / Number(cgCurrent[0].total)
    : NaN;
  const cgFlags = flagsForRate(cgPct, cgBase, true);

  // ---- Persist. ----
  const inserted = [];
  for (const f of [...allFlags, ...cgFlags]) {
    const row = await db`
      INSERT INTO session_flags (session_id, kind, sigma, observed_pct, baseline_mu, baseline_sigma, child_generated_only)
      VALUES (${sessionId}, ${f.kind}, ${f.sigma}, ${f.observedPct}, ${f.baselineMu}, ${f.baselineSigma}, ${f.childGeneratedOnly})
      RETURNING id, kind, sigma, observed_pct, baseline_mu, baseline_sigma, child_generated_only, created_at`;
    inserted.push(row[0]);
  }
  return inserted;
}

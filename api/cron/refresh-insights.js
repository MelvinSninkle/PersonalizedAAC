// GET /api/cron/refresh-insights — Vercel cron handler (daily ~03:00 local).
// Walks every (child, skill, mode) bucket that's had spike activity or
// open exposure protocols and writes a consolidated narrative to
// skill_insights. Also flips exposure_protocols.spacing_mode based on
// recent spike absence (PRD §8.5 adaptive tightening) so the next
// exposure tick uses the right cadence.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when configured.
// We accept anything when CRON_SECRET is unset (dev), since this handler is
// idempotent and the data it writes is recomputable.
import { sql } from '../_lib/db.js';

const INSIGHT = {
  improving:    'joint_attention_improving',
  inconsistent: 'present_but_inconsistent',
  mastered:     'mastered',
  considerEval: 'consider_eval',
};

const MS_DAY = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (got !== expected) { res.status(401).json({ error: 'unauthorized' }); return; }
  }

  try {
    const db = sql();
    // Buckets to consider: anything with a flag in the last 60 days OR a
    // live exposure protocol that's not yet mastered.
    const buckets = await db`
      SELECT DISTINCT s.child_id, s.skill_slug, s.mode
      FROM sessions s
      JOIN session_flags f ON f.session_id = s.id
      WHERE f.created_at >= now() - interval '60 days'
        AND s.skill_slug IS NOT NULL AND s.mode IS NOT NULL
      UNION
      SELECT DISTINCT child_id, skill_slug, mode
      FROM (
        SELECT p.child_id, p.skill_slug, s.mode
        FROM exposure_protocols p
        JOIN sessions s ON s.skill_slug = p.skill_slug AND s.child_id = p.child_id
        WHERE p.status <> 'mastered'
      ) x
      WHERE skill_slug IS NOT NULL AND mode IS NOT NULL`;

    let upserts = 0;
    for (const b of buckets) {
      const result = await refreshBucket(db, b);
      if (result) upserts++;
    }

    // Adaptive tightening pass: any open protocol whose latest spike is
    // > 10 days ago (or never) goes tightened; mastered/recent-spike →
    // standard. Stage 5 + no mastery → eval_flagged.
    await refreshSpacingModes(db);

    res.status(200).json({ ok: true, buckets: buckets.length, upserts });
  } catch (err) {
    res.status(500).json({ error: 'refresh failed', detail: String(err.message || err) });
  }
}

async function refreshBucket(db, { child_id, skill_slug, mode }) {
  // All spike rows for this bucket, oldest first.
  const flags = await db`
    SELECT f.kind, f.child_generated_only, f.created_at
    FROM session_flags f
    JOIN sessions s ON s.id = f.session_id
    WHERE s.child_id = ${child_id} AND s.skill_slug = ${skill_slug} AND s.mode = ${mode}
    ORDER BY f.created_at ASC`;
  if (flags.length === 0) return null;

  const times = flags.map(f => new Date(f.created_at).getTime());
  const recent14 = flags.filter(f => Date.now() - new Date(f.created_at).getTime() <= 14 * MS_DAY);
  const recentChildGen = recent14.some(f => f.child_generated_only);

  // PRD §7 — derive the right label.
  let label = INSIGHT.inconsistent;
  let evidence = {};

  // Mastered: ≥2 spikes within 14 days AND at least one child-generated
  // (matches the plan's sign-off rule).
  if (recent14.length >= 2 && recentChildGen) {
    label = INSIGHT.mastered;
    evidence = { recentSpikes: recent14.length, anyChildGenerated: true };
  } else if (times.length >= 4) {
    // Inter-spike intervals; trend the last 3 vs the median of all priors.
    const intervals = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
    const last3 = intervals.slice(-3);
    const priors = intervals.slice(0, -3);
    if (priors.length) {
      const median = quickMedian(priors);
      const last3Median = quickMedian(last3);
      if (last3Median < median) {
        label = INSIGHT.improving;
        evidence = {
          last3IntervalDays: last3.map(ms => Math.round(ms / MS_DAY)),
          priorMedianDays: Math.round(median / MS_DAY),
        };
      } else {
        evidence = {
          last3IntervalDays: last3.map(ms => Math.round(ms / MS_DAY)),
          priorMedianDays: Math.round(median / MS_DAY),
        };
      }
    }
  } else {
    evidence = { recentSpikes: recent14.length, totalSpikes: flags.length };
  }

  // Consider-eval signal flag (lives alongside the narrative label so the
  // dashboard can render both: the label is the headline, consider_eval is
  // a separate alert badge).
  const protoRow = await db`
    SELECT status FROM exposure_protocols
    WHERE child_id = ${child_id} AND skill_slug = ${skill_slug} LIMIT 1`;
  const considerEval = protoRow.length > 0 && protoRow[0].status === 'eval_flagged';

  // Upsert. ON CONFLICT respects an existing dismissed_at so a therapist's
  // dismissal stays sticky until something materially changes (the cron
  // could be improved to clear dismissed_at on label change later).
  await db`
    INSERT INTO skill_insights (child_id, skill_slug, mode, label, evidence, consider_eval, generated_at)
    VALUES (${child_id}, ${skill_slug}, ${mode}, ${label}, ${JSON.stringify(evidence)}::jsonb, ${considerEval}, NOW())
    ON CONFLICT (child_id, skill_slug, mode) DO UPDATE
    SET label = EXCLUDED.label,
        evidence = EXCLUDED.evidence,
        consider_eval = EXCLUDED.consider_eval,
        generated_at = NOW()`;
  return label;
}

/// PRD §8.5: if a protocol has no spike in the last 10 days and isn't
/// already mastered, cluster closer ('tightened'). If mastered or a spike
/// happened recently, widen back to 'standard'.
async function refreshSpacingModes(db) {
  await db`
    UPDATE exposure_protocols p SET spacing_mode =
      CASE WHEN p.status = 'mastered' THEN 'standard'
           WHEN EXISTS (
             SELECT 1 FROM sessions s
             JOIN session_flags f ON f.session_id = s.id
             WHERE s.child_id = p.child_id AND s.skill_slug = p.skill_slug
               AND f.created_at >= now() - interval '10 days')
           THEN 'standard'
           ELSE 'tightened'
      END
    WHERE p.status <> 'mastered'`;
}

function quickMedian(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

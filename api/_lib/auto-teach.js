// Shared core for the Auto-teach subsystem.
//
// Two endpoints sit on top of this:
//   /api/auto-teach/state  — what's the system doing right now?
//   /api/auto-teach/next   — give me the next batch to teach
//
// Design (the parent-facing summary lives in CLAUDE-CODE.md):
//
//   • Two channels, different rhythms — micro-exposure slideshows every N
//     minutes (default 90), one full game session per day at a parent-chosen
//     time. Honors the existing child_settings.schedule (sleep, school,
//     meals) AND a hard 30-minute cooldown between auto-triggered activities.
//   • Mastery = clinical 80/90 (acquired @ 80% across last 3 attempts;
//     mastered @ 90% across last 3 AND ≥ 5 days since acquisition). Mastered
//     words drop into MAINTENANCE — biweekly check-in instead of removal,
//     because language is use-it-or-lose-it.
//   • Tile picker priority:
//       1. Age-band-eligible tiles with zero recorded exposures
//       2. Active-rotation tiles with the longest gap since last exposure
//       3. Acquired-but-not-mastered tiles approaching their next test
//       4. One stretch tile from the next band up
//       5. One maintenance tile due for its biweekly recheck
//
// The picker is read-only and deterministic for a given (childId, now). The
// iPad's runner POSTs /api/exposure-tick after it actually shows the tile, so
// counts only update for real exposures, not previews.
import { sql } from './db.js';
import { bandForBirthDate, higherBand, AGE_BANDS } from './age-band.js';

// ---- Settings ----------------------------------------------------------
//
// Defaults are CONSERVATIVE per the user's explicit pick. Parent can dial
// any of these up; nothing in the system caps the parent's choice.
export const DEFAULTS = {
  enabled: false,
  cadence: 'conservative',         // 'conservative' | 'standard' | 'intensive'
  tier:    'under3',                // 'under3' | '3to5' | '5plus'
  dailyGameAt: '15:30',             // HH:MM — when the daily game runs
  cooldownMin: 30,                  // hard cooldown between auto-triggered activities
  batchSize: 4,                     // tiles per micro-exposure
};

// Cadence → micro-exposure spacing + daily budget.
export const CADENCE = {
  conservative: { minutesBetween: 60, dailyBudgetMin: { under3: 8,  '3to5': 12, '5plus': 18 } },
  standard:     { minutesBetween: 90, dailyBudgetMin: { under3: 12, '3to5': 18, '5plus': 25 } },
  intensive:    { minutesBetween: 45, dailyBudgetMin: { under3: 18, '3to5': 25, '5plus': 35 } },
};

// Tier → session-length cap (drives game length too).
export const TIER_CAPS = {
  under3:  { sessionMaxMin: 5,  microSec: 45 },
  '3to5':  { sessionMaxMin: 8,  microSec: 60 },
  '5plus': { sessionMaxMin: 12, microSec: 90 },
};

export async function loadSettings(db, childId) {
  const rows = await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`;
  const s = (rows[0] && rows[0].settings) || {};
  // Family timezone (IANA, e.g. "America/Denver") — auto-detected and saved by
  // the devices. Every time gate MUST evaluate in this zone: the server runs
  // UTC, so comparing wall-clock strings against new Date() hours made
  // "bedtime 20:00" trip at ~1pm Mountain — auto-teach refused all afternoon.
  return { tz: s.tz || null, ...DEFAULTS, ...(s.autoTeach || {}) };
}

/// Persist the device-reported IANA timezone (best-effort, only sane values).
export async function saveTimezone(db, childId, tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z_]+\/[A-Za-z_+-]+/.test(tz)) return;
  try {
    await db`INSERT INTO child_settings (child_id, settings)
             VALUES (${childId}, ${JSON.stringify({ tz })}::jsonb)
             ON CONFLICT (child_id) DO UPDATE
             SET settings = COALESCE(child_settings.settings, '{}'::jsonb) || ${JSON.stringify({ tz })}::jsonb`;
  } catch (_) { /* best-effort */ }
}

/// Wall-clock parts of `now` in the family's timezone: { hhmm: "HH:MM", dow: 0-6,
/// minutes: minutes-since-midnight }. Falls back to server time without a tz.
export function localParts(now = new Date(), tz = null) {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short',
      }).formatToParts(now);
      const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
      const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const hh = get('hour') === '24' ? '00' : get('hour');   // Intl quirk at midnight
      const h = parseInt(hh, 10) || 0, m = parseInt(get('minute'), 10) || 0;
      return { hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
               dow: dowMap[get('weekday')] ?? now.getDay(), minutes: h * 60 + m };
    } catch (_) { /* bad tz string → server time */ }
  }
  return { hhmm: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
           dow: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
}

// ---- Schedule + cooldown gates ----------------------------------------

/// Is `now` within any blackout window the parent has declared?
/// Reads child_settings.schedule (the existing routine + locations payload).
/// Blackouts (all evaluated in the FAMILY's timezone, not the server's):
///   - Outside [wake, bedtime] (default 7am-8pm if unset)
///   - During [breakfast/lunch/dinner ± 20 min]
///   - During any active school OR therapy location time window
export function inBlackout(scheduleObj, now = new Date(), tz = null) {
  if (!scheduleObj || typeof scheduleObj !== 'object') return false;
  const { hhmm, dow, minutes } = localParts(now, tz);
  const within = (start, end) => {
    if (!start || !end) return false;
    return start <= hhmm && hhmm <= end;
  };
  const toMin = (t) => {
    if (!t || !/^\d\d:\d\d$/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const aroundMeal = (mealTime) => {
    const mm = toMin(mealTime);
    return mm != null && Math.abs(minutes - mm) <= 20;
  };
  const wake    = scheduleObj.wake    || '07:00';
  const bedtime = scheduleObj.bedtime || '20:00';
  if (hhmm < wake || hhmm > bedtime) return true;
  for (const m of ['breakfast', 'lunch', 'dinner']) if (aroundMeal(scheduleObj[m])) return true;
  for (const t of (scheduleObj.snacks || [])) if (aroundMeal(t)) return true;
  for (const loc of (scheduleObj.locations || [])) {
    if ((loc.type === 'school' || loc.type === 'therapy')
        && Array.isArray(loc.days) && loc.days.includes(dow)
        && within(loc.start, loc.end)) return true;
  }
  return false;
}

/// Auto-teach may only be ENABLED once the parent has told us when NOT to run:
/// sleep times are required; school/therapy windows must be entered or
/// explicitly declared not-applicable (schedule.noOutsideCare = true).
export function scheduleReady(scheduleObj) {
  const s = scheduleObj && typeof scheduleObj === 'object' ? scheduleObj : {};
  const hasSleep = /^\d\d:\d\d$/.test(s.wake || '') && /^\d\d:\d\d$/.test(s.bedtime || '');
  const hasCare = (s.locations || []).some((l) => l && (l.type === 'school' || l.type === 'therapy')
                                                   && l.start && l.end && Array.isArray(l.days) && l.days.length);
  return hasSleep && (hasCare || s.noOutsideCare === true);
}

// Has the child tapped anything in the last 5 minutes? Active board use beats
// auto-teach — don't interrupt.
export async function recentlyActive(db, childId, withinMinutes = 5) {
  const rows = await db`
    SELECT 1 FROM events
    WHERE child_id = ${childId} AND role = 'student'
      AND occurred_at > NOW() - (${withinMinutes} || ' minutes')::interval
    LIMIT 1`;
  return rows.length > 0;
}

// Last auto-teach trigger time (cooldown gate).
export async function lastTriggerAt(db, childId) {
  const rows = await db`
    SELECT max(occurred_at) AS t
    FROM exposure_events
    WHERE source IN ('auto_slideshow','auto_game')
      AND protocol_id IN (SELECT id FROM exposure_protocols WHERE child_id = ${childId})`;
  return rows[0] && rows[0].t ? new Date(rows[0].t) : null;
}

// Today's auto-teach minutes used (against the daily budget).
export async function todaysBudgetUsed(db, childId) {
  const rows = await db`
    SELECT count(*)::int AS n
    FROM exposure_events
    WHERE source IN ('auto_slideshow','auto_game')
      AND protocol_id IN (SELECT id FROM exposure_protocols WHERE child_id = ${childId})
      AND occurred_at >= date_trunc('day', NOW())`;
  // Best-effort: each exposure_event is one tile shown; convert to minutes
  // by assuming the tier's microSec value. The runner could log a duration
  // someday but this is the right approximation today.
  return Number((rows[0] && rows[0].n) || 0);
}

// ---- Tile picking ------------------------------------------------------

const MASTERY_ACCURACY_ACQUIRED = 0.80;
const MASTERY_ACCURACY_MASTERED = 0.90;
const MASTERY_SESSION_WINDOW    = 3;
const MAINTENANCE_DAYS          = 14;
const RETENTION_DAYS            = 5;

/// Picks the next batch of skill_slugs (taxonomy ids) to expose now, for the
/// `mode` ('exposure' = slideshow or 'game' = matching/auditory/expressive).
/// Honors the priority list described at the top of this file; returns at
/// most `batchSize` rows. Read-only; doesn't write any state.
export async function pickNextBatch({ db, childId, mode = 'exposure', batchSize = 4 }) {
  // Resolve the child's current band so the picker pulls age-appropriate tiles.
  const me = (await db`SELECT birth_date, advanced_to_band FROM persons
                       WHERE child_id = ${childId} AND is_self = TRUE LIMIT 1`)[0];
  const natural = me && me.birth_date ? bandForBirthDate(me.birth_date) : null;
  const advanced = me ? (me.advanced_to_band || null) : null;
  const currentBand = higherBand(natural, advanced) || AGE_BANDS[0];
  const stretchBand = AGE_BANDS[Math.min(AGE_BANDS.length - 1, AGE_BANDS.indexOf(currentBand) + 1)];

  // 1) Pool: all taxonomy rows the child should be working on at or below
  //    their current band. Personal-photo tiles (no taxonomy_slug) aren't
  //    auto-teachable by design — the picker only handles canonical content.
  const inBand = AGE_BANDS.slice(0, AGE_BANDS.indexOf(currentBand) + 1);
  const pool = await db`
    SELECT id AS slug, label, category, acquisition_age
    FROM taxonomy
    WHERE acquisition_age = ANY(${inBand})
      AND COALESCE(is_event, FALSE) = FALSE
      AND archived = FALSE`;
  if (!pool.length) return [];

  // 2) Existing protocols for those slugs — gives us status + last_seen_at.
  const slugs = pool.map(r => r.slug);
  const protos = slugs.length
    ? await db`SELECT skill_slug, status, last_seen_at, mastered_at
               FROM exposure_protocols
               WHERE child_id = ${childId} AND skill_slug = ANY(${slugs})`
    : [];
  const byProto = new Map(protos.map(p => [p.skill_slug, p]));

  // 3) Mastery signal from last-3-sessions accuracy — used to PROMOTE protocols
  //    independent of the spacing-stage progression that already exists.
  const recentAcc = await db`
    WITH last_three AS (
      SELECT a.taxonomy_slug, s.id AS sid, count(*) AS total,
             sum(case when a.correct then 1 else 0 end) AS ok
      FROM game_attempts a JOIN sessions s ON s.id = a.session_id
      WHERE a.child_id = ${childId} AND a.taxonomy_slug = ANY(${slugs})
      GROUP BY 1, 2
    )
    SELECT taxonomy_slug AS slug,
           sum(ok)::int   AS ok,
           sum(total)::int AS total,
           count(*)::int  AS sessions
    FROM (SELECT taxonomy_slug, ok, total,
                 row_number() OVER (PARTITION BY taxonomy_slug ORDER BY sid DESC) AS rn
          FROM last_three) t
    WHERE rn <= ${MASTERY_SESSION_WINDOW}
    GROUP BY 1`;
  const accBySlug = new Map(recentAcc.map(r => [r.slug, r]));

  // 4) Build scored candidates per bucket.
  const now = Date.now();
  function bucketOf(row) {
    const proto = byProto.get(row.slug);
    const acc = accBySlug.get(row.slug);
    const accuracy = acc && acc.total >= MASTERY_SESSION_WINDOW * 2
      ? Number(acc.ok) / Number(acc.total) : null;
    const mastered = proto && proto.status === 'mastered'
      || (accuracy != null && accuracy >= MASTERY_ACCURACY_MASTERED
          && proto && proto.mastered_at
          && now - new Date(proto.mastered_at).getTime() >= RETENTION_DAYS * 86400000);
    if (mastered) {
      // Maintenance: only include if last exposure was ≥ 14d ago.
      const lastSeen = proto && proto.last_seen_at ? new Date(proto.last_seen_at).getTime() : 0;
      const dueForMaint = now - lastSeen >= MAINTENANCE_DAYS * 86400000;
      return dueForMaint ? 'maintenance' : 'skip';
    }
    if (!proto || !proto.last_seen_at) return 'unmet';
    if (accuracy != null && accuracy >= MASTERY_ACCURACY_ACQUIRED) return 'acquired';
    return 'active';
  }

  const buckets = { unmet: [], active: [], acquired: [], maintenance: [], stretch: [] };
  for (const row of pool) {
    const b = bucketOf(row);
    if (b === 'skip') continue;
    buckets[b].push(row);
  }
  // Pull a small stretch pool from one band up (rare; just 1 per batch).
  if (stretchBand !== currentBand) {
    const stretch = await db`SELECT id AS slug, label, category FROM taxonomy
                              WHERE acquisition_age = ${stretchBand}
                                AND COALESCE(is_event, FALSE) = FALSE
                                AND archived = FALSE
                              LIMIT 25`;
    buckets.stretch = stretch;
  }

  // Sort active/acquired by longest-gap-since-exposure (oldest first).
  const lastSeenMs = (r) => {
    const p = byProto.get(r.slug);
    return p && p.last_seen_at ? new Date(p.last_seen_at).getTime() : 0;
  };
  buckets.active.sort((a, b) => lastSeenMs(a) - lastSeenMs(b));
  buckets.acquired.sort((a, b) => lastSeenMs(a) - lastSeenMs(b));

  // 5) Pull from buckets in priority order until batchSize is filled.
  const out = [];
  const take = (arr, n) => { for (let i = 0; i < n && arr.length; i++) out.push(arr.shift()); };
  take(buckets.unmet, batchSize);
  take(buckets.active, Math.max(0, batchSize - out.length));
  take(buckets.acquired, Math.max(0, Math.min(2, batchSize - out.length)));
  if (out.length < batchSize) take(buckets.stretch, 1);
  if (out.length < batchSize) take(buckets.maintenance, 1);
  return out.slice(0, batchSize).map(r => ({
    slug: r.slug,
    label: r.label,
    category: r.category,
    bucket: bucketOf(r),
  }));
}

// ---- Mastery roll-up for the parent dashboard --------------------------

export async function masteryByCategory(db, childId) {
  // Counts active / acquired / mastered / maintenance per category, all in
  // one round-trip so the parent dashboard can render "People: 18 mastered,
  // 2 active, 0 left."
  const rows = await db`
    SELECT t.category,
           t.id AS slug,
           p.status,
           p.last_seen_at
    FROM taxonomy t
    LEFT JOIN exposure_protocols p ON p.skill_slug = t.id AND p.child_id = ${childId}
    WHERE t.archived = FALSE AND COALESCE(t.is_event, FALSE) = FALSE`;
  const byCat = new Map();
  const now = Date.now();
  for (const r of rows) {
    if (!r.category) continue;
    const c = byCat.get(r.category) || { active: 0, acquired: 0, mastered: 0, maintenance: 0, unmet: 0, total: 0 };
    c.total++;
    if (!r.status) { c.unmet++; }
    else if (r.status === 'mastered') {
      const last = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
      if (now - last >= MAINTENANCE_DAYS * 86400000) c.maintenance++; else c.mastered++;
    } else { c.active++; }
    byCat.set(r.category, c);
  }
  return [...byCat.entries()].map(([category, counts]) => ({ category, ...counts }));
}

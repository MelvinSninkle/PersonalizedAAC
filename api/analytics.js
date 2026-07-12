// GET /api/analytics?childId=X&bucket=day|week|month — read-only aggregates
// for the parent & therapist dashboards.
//
// Buckets default to DAY (last 14 days) so early data isn't distorted by
// weekly compression; week (8) and month (6) views are available once there's
// more history. Returns per-bucket series for use / games / time, plus current
// 30-day mastery and recent sessions. Each section degrades to [] on error.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';

const MODE_LABEL = {
  self_paced: 'Self-Paced Game',
  facilitated: 'Facilitated',
  // PRD §5 — the three scored game modes.
  auditory_comprehension: 'Auditory Comprehension',
  clue_quiz: 'Clue Quiz',
  teach_slideshow: 'Teach Slideshow',
  expressive_naming: 'Expressive Naming',
  learn_slideshow: 'Learn Slideshow',
  exposure_slideshow: 'Exposure',
  celebration: 'Celebration',
  use: 'Free use',
};

const GRAN = {
  day:   { secs: 86400,   n: 14, unit: 'd' },
  week:  { secs: 604800,  n: 8,  unit: 'w' },
  month: { secs: 2629746, n: 6,  unit: 'mo' },
};

function labelsFor(n, unit) {
  const out = [];
  for (let i = 0; i < n; i++) { const ago = n - 1 - i; out.push(ago === 0 ? 'now' : ago + unit); }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
  const bucket = GRAN[req.query && req.query.bucket] ? req.query.bucket : 'day';
  const G = GRAN[bucket];
  const N = G.n, SECS = G.secs, SPAN = SECS * N;
  const zeros = () => new Array(N).fill(0);
  const idx = (b) => (N - 1) - b; // bucket 0 = current period → last slot
  const db = sql();
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  const out = {
    bucket, labels: labelsFor(N, G.unit),
    use: { series: [] },
    games: { series: [] },               // byCategory (legacy back-compat)
    gamesBySkill: { series: [] },        // PRD §11 — bucketed by taxonomy_slug
    gamesByMode: { series: [] },         // PRD §5.1 — bucketed by session mode
    time: { series: [] },
    mastery: [],
    recentSessions: [],
    recentSpikes: [],                    // PRD §6 mastery signal
    stats: null,                         // "This week" cards: this vs last 7 days
  };

  // ---- USE: taps per category per bucket ----
  try {
    const rows = await db`
      SELECT category_name AS name,
             floor(extract(epoch from (now() - occurred_at)) / ${SECS})::int AS bucket,
             count(*)::int AS n
      FROM events
      WHERE child_id = ${childId} AND role = 'student' AND category_name IS NOT NULL
        AND occurred_at >= now() - ${SPAN} * interval '1 second'
      GROUP BY 1, 2`;
    const daily = await db`
      SELECT category_name AS name, count(distinct date_trunc('day', occurred_at))::int AS days
      FROM events
      WHERE child_id = ${childId} AND role = 'student' AND category_name IS NOT NULL
        AND occurred_at >= now() - interval '7 days'
      GROUP BY 1`;
    const dailyMap = new Map(daily.map(r => [r.name, Number(r.days) >= 7]));
    const byCat = new Map();
    for (const r of rows) {
      const b = Number(r.bucket);
      if (b < 0 || b >= N) continue;
      if (!byCat.has(r.name)) byCat.set(r.name, zeros());
      byCat.get(r.name)[idx(b)] = Number(r.n);
    }
    out.use.series = [...byCat.entries()]
      .map(([name, data]) => ({ name, data, daily: !!dailyMap.get(name) }))
      .sort((a, b) => b.data[N - 1] - a.data[N - 1]);
  } catch (_) { /* table may not exist yet */ }

  // ---- GAMES: accuracy per category per bucket (carry-forward fill) ----
  try {
    const rows = await db`
      SELECT a.category AS name,
             floor(extract(epoch from (now() - a.occurred_at)) / ${SECS})::int AS bucket,
             count(*)::int AS total,
             sum(case when a.correct then 1 else 0 end)::int AS ok,
             min(coalesce(s.scoring_version, 1))::int AS min_sv
      FROM game_attempts a
      LEFT JOIN sessions s ON s.id = a.session_id
      WHERE a.child_id = ${childId} AND a.category IS NOT NULL
        AND a.occurred_at >= now() - ${SPAN} * interval '1 second'
      GROUP BY 1, 2`;
    const byCat = new Map();
    const legacyBuckets = new Map();
    for (const r of rows) {
      const b = Number(r.bucket);
      if (b < 0 || b >= N) continue;
      if (!byCat.has(r.name)) {
        byCat.set(r.name, new Array(N).fill(null));
        legacyBuckets.set(r.name, new Array(N).fill(false));
      }
      byCat.get(r.name)[idx(b)] = Math.round((Number(r.ok) / Number(r.total)) * 100);
      // PRD §3 cutover: mark any bucket whose data includes a pre-v2 session
      // so charts can dot-line / footnote it.
      if (Number(r.min_sv) < 2) legacyBuckets.get(r.name)[idx(b)] = true;
    }
    out.games.series = [...byCat.entries()].map(([name, raw]) => {
      const data = []; let last = 0;
      for (let i = 0; i < N; i++) { if (raw[i] != null) last = raw[i]; data.push(last); }
      return { name, data, legacyScoring: legacyBuckets.get(name) };
    }).sort((a, b) => b.data[N - 1] - a.data[N - 1]);
  } catch (_) { /* */ }

  // ---- GAMES BY SKILL: accuracy per skill_slug per bucket ----
  // PRD §11 anchors mastery to taxonomy_slug. Falls back to label so custom-
  // board items still surface; sessions inherit mode for the byMode pivot.
  // Carries scoring_version so charts can dot-line / footnote legacy buckets.
  try {
    const rows = await db`
      SELECT COALESCE(NULLIF(a.taxonomy_slug, ''), a.label) AS name,
             s.mode AS mode,
             floor(extract(epoch from (now() - a.occurred_at)) / ${SECS})::int AS bucket,
             count(*)::int AS total,
             sum(case when a.correct then 1 else 0 end)::int AS ok,
             min(coalesce(s.scoring_version, 1))::int AS min_sv
      FROM game_attempts a
      LEFT JOIN sessions s ON s.id = a.session_id
      WHERE a.child_id = ${childId} AND COALESCE(NULLIF(a.taxonomy_slug, ''), a.label) IS NOT NULL
        AND a.occurred_at >= now() - ${SPAN} * interval '1 second'
      GROUP BY 1, 2, 3`;
    const bySkill = new Map();
    const legacy = new Map();
    for (const r of rows) {
      const b = Number(r.bucket);
      if (b < 0 || b >= N) continue;
      if (!bySkill.has(r.name)) {
        bySkill.set(r.name, new Array(N).fill(null));
        legacy.set(r.name, new Array(N).fill(false));
      }
      bySkill.get(r.name)[idx(b)] = Math.round((Number(r.ok) / Number(r.total)) * 100);
      if (Number(r.min_sv) < 2) legacy.get(r.name)[idx(b)] = true;
    }
    out.gamesBySkill.series = [...bySkill.entries()].map(([name, raw]) => {
      const data = []; let last = 0;
      for (let i = 0; i < N; i++) { if (raw[i] != null) last = raw[i]; data.push(last); }
      return { name, data, legacyScoring: legacy.get(name) };
    }).sort((a, b) => b.data[N - 1] - a.data[N - 1]);
  } catch (_) { /* */ }

  // ---- GAMES BY MODE: accuracy per session mode per bucket ----
  // PRD §5.1: each mode is a qualitatively different measurement; surface the
  // overall trend by mode so a child who excels at auditory comprehension but
  // struggles with expressive naming is visible.
  try {
    const rows = await db`
      SELECT s.mode AS mode,
             floor(extract(epoch from (now() - a.occurred_at)) / ${SECS})::int AS bucket,
             count(*)::int AS total,
             sum(case when a.correct then 1 else 0 end)::int AS ok
      FROM game_attempts a
      LEFT JOIN sessions s ON s.id = a.session_id
      WHERE a.child_id = ${childId} AND s.mode IS NOT NULL
        AND a.occurred_at >= now() - ${SPAN} * interval '1 second'
      GROUP BY 1, 2`;
    const byMode = new Map();
    for (const r of rows) {
      const b = Number(r.bucket);
      if (b < 0 || b >= N) continue;
      if (!byMode.has(r.mode)) byMode.set(r.mode, new Array(N).fill(null));
      byMode.get(r.mode)[idx(b)] = Math.round((Number(r.ok) / Number(r.total)) * 100);
    }
    out.gamesByMode.series = [...byMode.entries()].map(([mode, raw]) => {
      const data = []; let last = 0;
      for (let i = 0; i < N; i++) { if (raw[i] != null) last = raw[i]; data.push(last); }
      return { name: MODE_LABEL[mode] || mode, mode, data };
    }).sort((a, b) => b.data[N - 1] - a.data[N - 1]);
  } catch (_) { /* */ }

  // ---- MASTERY: current 30-day accuracy per category ----
  try {
    const rows = await db`
      SELECT category AS name, count(*)::int AS total, sum(case when correct then 1 else 0 end)::int AS ok
      FROM game_attempts
      WHERE child_id = ${childId} AND category IS NOT NULL AND occurred_at >= now() - interval '30 days'
      GROUP BY 1`;
    out.mastery = rows
      .map(r => ({ name: r.name, pct: Math.round((Number(r.ok) / Number(r.total)) * 100) }))
      .sort((a, b) => b.pct - a.pct);
  } catch (_) { /* */ }

  // ---- TIME: total vs passive minutes per bucket ----
  try {
    const rows = await db`
      SELECT floor(extract(epoch from (now() - started_at)) / ${SECS})::int AS bucket,
             sum(extract(epoch from (coalesce(ended_at, started_at) - started_at)))::float AS secs,
             sum(case when mode in ('learn_slideshow','exposure_slideshow')
                      then extract(epoch from (coalesce(ended_at, started_at) - started_at)) else 0 end)::float AS passive
      FROM sessions
      WHERE child_id = ${childId} AND started_at >= now() - ${SPAN} * interval '1 second'
      GROUP BY 1`;
    const total = zeros(), passive = zeros();
    let any = false;
    for (const r of rows) {
      const b = Number(r.bucket);
      if (b < 0 || b >= N) continue;
      any = true;
      total[idx(b)] = Math.round(Number(r.secs) / 60);
      passive[idx(b)] = Math.round(Number(r.passive) / 60);
    }
    if (any) out.time.series = [
      { name: 'Total use', data: total },
      { name: 'Passive learning', data: passive },
    ];
  } catch (_) { /* */ }

  // ---- RECENT SESSIONS ----
  try {
    // Sessions store the raw launch scope as "category" (e.g. "cat:123", "people",
    // "all"). Resolve it to a human label so the dashboard never shows a bare id.
    const catMap = new Map();
    try {
      const crows = await db`SELECT id, label FROM categories WHERE child_id = ${childId}`;
      for (const c of crows) catMap.set(String(c.id), c.label);
    } catch (_) { /* categories table may be empty */ }
    const SCOPE_LABEL = { all: 'Everything', people: 'People', nouns: 'Nouns', verbs: 'Verbs' };
    const resolveScope = (scope) => {
      if (!scope) return '—';
      if (scope.startsWith('cat:')) return catMap.get(scope.slice(4)) || 'Category';
      return SCOPE_LABEL[scope] || scope;
    };
    const rows = await db`
      SELECT mode, category, started_at, ended_at, correct_count, item_count,
             slides_attempted, end_reason, scoring_version
      FROM sessions WHERE child_id = ${childId}
      ORDER BY started_at DESC LIMIT 8`;
    out.recentSessions = rows.map(r => {
      // PRD §3.1 honest denominator. Mercy/quit-aware: a session that bailed
      // at slide 5/12 reports "X / 5", not "X / 12".
      const scored = r.mode === 'self_paced' || r.mode === 'facilitated'
                  || r.mode === 'auditory_comprehension' || r.mode === 'expressive_naming';
      const denom = Number.isFinite(Number(r.slides_attempted)) && r.slides_attempted != null
        ? Number(r.slides_attempted)
        : Number(r.item_count);
      const mins = r.ended_at ? Math.max(1, Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000)) : null;
      return {
        date: new Date(r.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        mode: MODE_LABEL[r.mode] || r.mode,
        category: resolveScope(r.category),
        result: scored && denom ? `${r.correct_count} / ${denom}${denom < 3 ? ' · too short to score' : ''}` : '—',
        length: mins ? `${mins} min` : '—',
        // PRD §3 cutover marker: dashboards can dot-line / footnote pre-v2 rows.
        scoringVersion: Number(r.scoring_version) || 1,
        endReason: r.end_reason || null,
      };
    });
    out.hasLegacyScoring = out.recentSessions.some(s => s.scoringVersion < 2);
  } catch (_) { /* */ }

  // ---- "THIS WEEK" STAT CARDS (this vs previous 7 days) ----
  try {
    const rows = await db`
      SELECT (started_at >= now() - interval '7 days') AS this_week,
             mode, correct_count, item_count, slides_attempted, started_at, ended_at
      FROM sessions
      WHERE child_id = ${childId} AND started_at >= now() - interval '14 days'`;
    const half = () => ({ sessions: 0, correct: 0, denom: 0, items: 0, passiveSecs: 0 });
    const now7 = half(), prev7 = half();
    for (const r of rows) {
      const h = r.this_week ? now7 : prev7;
      h.sessions += 1;
      const denom = Number.isFinite(Number(r.slides_attempted)) && r.slides_attempted != null
        ? Number(r.slides_attempted) : Number(r.item_count) || 0;
      h.items += denom;
      const scored = r.mode === 'self_paced' || r.mode === 'facilitated'
                  || r.mode === 'auditory_comprehension' || r.mode === 'expressive_naming';
      // A game abandoned after one or two answers is RECORDED (session +
      // items counts above) but never enters the accuracy total — a lone
      // lucky tap isn't 100%, and unanswered slides were never failures.
      if (scored && denom >= 3) { h.correct += Number(r.correct_count) || 0; h.denom += denom; }
      if ((r.mode === 'learn_slideshow' || r.mode === 'exposure_slideshow') && r.ended_at) {
        h.passiveSecs += Math.max(0, (new Date(r.ended_at) - new Date(r.started_at)) / 1000);
      }
    }
    const pct = (h) => h.denom ? Math.round(100 * h.correct / h.denom) : null;
    out.stats = {
      sessions: { now: now7.sessions, prev: prev7.sessions },
      accuracyPct: { now: pct(now7), prev: pct(prev7) },
      items: { now: now7.items, prev: prev7.items },
      exposureMin: { now: Math.round(now7.passiveSecs / 60), prev: Math.round(prev7.passiveSecs / 60) },
    };
  } catch (_) { /* */ }

  // ---- RECENT SPIKES (PRD §6 mastery signal) ----
  // Last 14 flags for this child, newest first. Joined to sessions so the
  // dashboard can show "X 3σ spike on horse · auditory comprehension · 2 days ago".
  try {
    const rows = await db`
      SELECT f.kind, f.sigma, f.observed_pct, f.baseline_mu, f.baseline_sigma,
             f.child_generated_only, f.created_at,
             s.skill_slug, s.mode
      FROM session_flags f
      JOIN sessions s ON s.id = f.session_id
      WHERE s.child_id = ${childId}
        AND f.created_at >= now() - interval '60 days'
      ORDER BY f.created_at DESC
      LIMIT 14`;
    out.recentSpikes = rows.map(r => ({
      kind: r.kind,                                          // 'spike_2sigma' | 'spike_3sigma' | 'perfect_pass'
      sigma: r.sigma == null ? null : Number(r.sigma),
      observedPct: r.observed_pct == null ? null : Number(r.observed_pct),
      baselineMu: r.baseline_mu == null ? null : Number(r.baseline_mu),
      baselineSigma: r.baseline_sigma == null ? null : Number(r.baseline_sigma),
      childGeneratedOnly: !!r.child_generated_only,
      skillSlug: r.skill_slug || null,
      mode: r.mode || null,
      modeLabel: r.mode ? (MODE_LABEL[r.mode] || r.mode) : null,
      at: r.created_at,
    }));
  } catch (_) { /* */ }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}

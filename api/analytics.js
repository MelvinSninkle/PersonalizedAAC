// GET /api/analytics?childId=X&bucket=day|week|month — read-only aggregates
// for the parent & therapist dashboards.
//
// Buckets default to DAY (last 14 days) so early data isn't distorted by
// weekly compression; week (8) and month (6) views are available once there's
// more history. Returns per-bucket series for use / games / time, plus current
// 30-day mastery and recent sessions. Each section degrades to [] on error.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

const MODE_LABEL = {
  self_paced: 'Self-Paced Game',
  facilitated: 'Facilitated',
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

  const out = { bucket, labels: labelsFor(N, G.unit), use: { series: [] }, games: { series: [] }, time: { series: [] }, mastery: [], recentSessions: [] };

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
      SELECT category AS name,
             floor(extract(epoch from (now() - occurred_at)) / ${SECS})::int AS bucket,
             count(*)::int AS total,
             sum(case when correct then 1 else 0 end)::int AS ok
      FROM game_attempts
      WHERE child_id = ${childId} AND category IS NOT NULL
        AND occurred_at >= now() - ${SPAN} * interval '1 second'
      GROUP BY 1, 2`;
    const byCat = new Map();
    for (const r of rows) {
      const b = Number(r.bucket);
      if (b < 0 || b >= N) continue;
      if (!byCat.has(r.name)) byCat.set(r.name, new Array(N).fill(null));
      byCat.get(r.name)[idx(b)] = Math.round((Number(r.ok) / Number(r.total)) * 100);
    }
    out.games.series = [...byCat.entries()].map(([name, raw]) => {
      const data = []; let last = 0;
      for (let i = 0; i < N; i++) { if (raw[i] != null) last = raw[i]; data.push(last); }
      return { name, data };
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
        result: scored && denom ? `${r.correct_count} / ${denom}` : '—',
        length: mins ? `${mins} min` : '—',
        // PRD §3 cutover marker: dashboards can dot-line / footnote pre-v2 rows.
        scoringVersion: Number(r.scoring_version) || 1,
        endReason: r.end_reason || null,
      };
    });
    out.hasLegacyScoring = out.recentSessions.some(s => s.scoringVersion < 2);
  } catch (_) { /* */ }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}

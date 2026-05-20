// GET /api/analytics?childId=X — read-only aggregates for the parent &
// therapist dashboards. Auth-gated with the shared admin bearer token.
//
// Returns weekly series (7 buckets, oldest → newest) for:
//   use   — taps per category from the event log (real today)
//   games — first-try matching accuracy per category (from game_attempts)
//   time  — total vs. passive-mode minutes (from sessions)
// plus current 30-day mastery and the most recent sessions.
//
// Every section is wrapped so a missing table or empty data yields [] rather
// than failing the whole request — the dashboards fall back to sample data
// for any series that comes back empty.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

const WEEKS = ['6w', '5w', '4w', '3w', '2w', '1w', 'now'];
const WEEK_SECS = 604800;
const MODE_LABEL = {
  self_paced: 'Self-Paced Game',
  facilitated: 'Facilitated',
  learn_slideshow: 'Learn Slideshow',
  exposure_slideshow: 'Exposure',
  celebration: 'Celebration',
  use: 'Free use',
};

const zeros = () => [0, 0, 0, 0, 0, 0, 0];
const idx = (bucket) => 6 - bucket; // bucket 0 = this week → last array slot

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
  const db = sql();

  const out = { weeks: WEEKS, use: { series: [] }, games: { series: [] }, time: { series: [] }, mastery: [], recentSessions: [] };

  // ---- USE: taps per category per week ----
  try {
    const rows = await db`
      SELECT category_name AS name,
             floor(extract(epoch from (now() - occurred_at)) / ${WEEK_SECS})::int AS bucket,
             count(*)::int AS n
      FROM events
      WHERE child_id = ${childId} AND role = 'student' AND category_name IS NOT NULL
        AND occurred_at >= now() - interval '49 days'
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
      if (b < 0 || b > 6) continue;
      if (!byCat.has(r.name)) byCat.set(r.name, zeros());
      byCat.get(r.name)[idx(b)] = Number(r.n);
    }
    out.use.series = [...byCat.entries()]
      .map(([name, data]) => ({ name, data, daily: !!dailyMap.get(name) }))
      .sort((a, b) => b.data[6] - a.data[6]);
  } catch (_) { /* table may not exist yet */ }

  // ---- GAMES: weekly accuracy per category (carry-forward fill) ----
  try {
    const rows = await db`
      SELECT category AS name,
             floor(extract(epoch from (now() - occurred_at)) / ${WEEK_SECS})::int AS bucket,
             count(*)::int AS total,
             sum(case when correct then 1 else 0 end)::int AS ok
      FROM game_attempts
      WHERE child_id = ${childId} AND category IS NOT NULL
        AND occurred_at >= now() - interval '49 days'
      GROUP BY 1, 2`;
    const byCat = new Map();
    for (const r of rows) {
      const b = Number(r.bucket);
      if (b < 0 || b > 6) continue;
      if (!byCat.has(r.name)) byCat.set(r.name, Array(7).fill(null));
      byCat.get(r.name)[idx(b)] = Math.round((Number(r.ok) / Number(r.total)) * 100);
    }
    out.games.series = [...byCat.entries()].map(([name, raw]) => {
      const data = []; let last = 0;
      for (let i = 0; i < 7; i++) { if (raw[i] != null) last = raw[i]; data.push(last); }
      return { name, data };
    }).sort((a, b) => b.data[6] - a.data[6]);
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

  // ---- TIME: total vs passive minutes per week ----
  try {
    const rows = await db`
      SELECT floor(extract(epoch from (now() - started_at)) / ${WEEK_SECS})::int AS bucket,
             sum(extract(epoch from (coalesce(ended_at, started_at) - started_at)))::float AS secs,
             sum(case when mode in ('learn_slideshow','exposure_slideshow')
                      then extract(epoch from (coalesce(ended_at, started_at) - started_at)) else 0 end)::float AS passive
      FROM sessions
      WHERE child_id = ${childId} AND started_at >= now() - interval '49 days'
      GROUP BY 1`;
    const total = zeros(), passive = zeros();
    let any = false;
    for (const r of rows) {
      const b = Number(r.bucket);
      if (b < 0 || b > 6) continue;
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
    const rows = await db`
      SELECT mode, category, started_at, ended_at, correct_count, item_count
      FROM sessions WHERE child_id = ${childId}
      ORDER BY started_at DESC LIMIT 8`;
    out.recentSessions = rows.map(r => {
      const scored = r.mode === 'self_paced' || r.mode === 'facilitated';
      const mins = r.ended_at ? Math.max(1, Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000)) : null;
      return {
        date: new Date(r.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        mode: MODE_LABEL[r.mode] || r.mode,
        category: r.category || '—',
        result: scored && r.item_count ? `${r.correct_count} / ${r.item_count}` : '—',
        length: mins ? `${mins} min` : '—',
      };
    });
  } catch (_) { /* */ }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}

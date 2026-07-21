// #11: movie/show title search — THE single interface behind every client's
// "find a movie or show" step (AC7). Today it queries Wikidata (free, CC0,
// no commercial restriction); when the TMDB commercial license is acquired,
// swap the implementation HERE and every surface upgrades with no UX change.
//
// Hard rule (AC1): this module returns TEXT METADATA ONLY — title, year,
// type, ids. No poster URLs are fetched, cached, or returned; the only tile
// image is whatever the parent uploads themselves.
//
// Wikimedia etiquette (AC6): descriptive User-Agent, one search + one
// entity-detail call per parent keystroke-submit, results capped small.

const WD_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'MyWorldTapToTalk/1.0 (https://myworldtaptotalk.com; AAC board movie-tile lookup)';

// P31 (instance of) values we classify. Anything else with an IMDb id still
// returns as type 'title' — the parent disambiguates, we never auto-pick.
const FILM_TYPES = new Set(['Q11424', 'Q202866', 'Q24869', 'Q506240', 'Q29168811', 'Q20650540']);
const TV_TYPES = new Set(['Q5398426', 'Q581714', 'Q15416', 'Q1259759', 'Q117467246', 'Q63952888', 'Q7724161']);

async function wd(params) {
  const url = WD_API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error(`wikidata ${r.status}`);
  return r.json();
}

function firstClaim(claims, prop) {
  const c = claims?.[prop];
  return Array.isArray(c) && c.length ? c[0]?.mainsnak?.datavalue?.value : undefined;
}

function claimIds(claims, prop) {
  const c = claims?.[prop] || [];
  return c.map((x) => x?.mainsnak?.datavalue?.value?.id).filter(Boolean);
}

/// Search Wikidata for film/TV titles. Returns up to 10 candidates:
/// { qid, title, description, year, type: 'film'|'tv'|'title', imdbId }.
/// Non-film/TV entities without an IMDb id are dropped.
export async function searchTitles(query) {
  const q = String(query || '').trim().slice(0, 120);
  if (q.length < 2) return [];

  const search = await wd({
    action: 'wbsearchentities', search: q, language: 'en', uselang: 'en',
    type: 'item', limit: '12',
  });
  const hits = (search.search || []).slice(0, 12);
  if (!hits.length) return [];

  const detail = await wd({
    action: 'wbgetentities', ids: hits.map((h) => h.id).join('|'),
    props: 'claims', languages: 'en',
  });

  const results = [];
  for (const h of hits) {
    const claims = detail.entities?.[h.id]?.claims;
    if (!claims) continue;
    const p31 = claimIds(claims, 'P31');
    const imdbId = typeof firstClaim(claims, 'P345') === 'string' ? firstClaim(claims, 'P345') : null;
    let type = null;
    if (p31.some((id) => FILM_TYPES.has(id))) type = 'film';
    else if (p31.some((id) => TV_TYPES.has(id))) type = 'tv';
    else if (imdbId && /^tt\d+$/.test(imdbId)) type = 'title';
    if (!type) continue;   // not a film/show — a book, a person, a place
    // Year: publication date (P577) for films, start time (P580) for series.
    let year = null;
    const date = firstClaim(claims, 'P577') || firstClaim(claims, 'P580');
    if (date && typeof date.time === 'string') {
      const m = date.time.match(/([+-]\d{4})/);
      if (m) year = parseInt(m[1], 10);
    }
    results.push({
      qid: h.id,
      title: h.label || h.id,
      description: h.description || '',
      year,
      type,
      imdbId: imdbId && /^tt\d{6,12}$/.test(imdbId) ? imdbId : null,
    });
    if (results.length >= 10) break;
  }
  return results;
}

/// GET handler body: ?movieSearch=<q>. Auth happens in the caller (items.js
/// gates every method); this endpoint reads no child data.
export async function movieSearch(req, res) {
  try {
    const results = await searchTitles(req.query.movieSearch);
    // Titles change rarely; a short private cache absorbs repeat keystrokes.
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.status(200).json({ ok: true, results });
  } catch (err) {
    res.status(502).json({ error: 'Title search is unavailable right now. Try again in a moment.',
                           detail: String(err.message || err) });
  }
}

/// Shared validators for the ids as they land on items rows.
export function cleanQid(v) {
  const s = String(v || '').trim();
  return /^Q\d{1,12}$/.test(s) ? s : null;
}
export function cleanImdbId(v) {
  const s = String(v || '').trim();
  return /^tt\d{6,12}$/.test(s) ? s : null;
}

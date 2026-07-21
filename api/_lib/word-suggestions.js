// Canonical suggestion queue (#10): while listening runs, board-side speech
// matching against the FULL canonical taxonomy (not just the child's board)
// records "the household says this word and the board lacks it" — one row per
// (child, slug) with a hit counter, never one per utterance. Strictly consent-
// gated: capture requires child_settings.suggestFromListening === true, which
// is FALSE until the parent's explicit opt-in. Only vocabulary-library word
// matches are stored — never audio, never transcripts.
//
// Ops (ridden on /api/items.js POST dispatch, all roster-gated):
//   suggest-record  { childId, slugs:[...] }        board → server (batched)
//   suggest-list    { childId }                     parent panel
//   suggest-act     { childId, slug, action }       dismiss | dismiss-forever |
//                                                   added (client completed the
//                                                   Word-Shop add) | restore
// The "Add" itself reuses the existing Word-Shop instantiation path client-
// side (style guide + voice + normal credit rules); this table only tracks
// suggestion state.

export async function ensureSuggestions(db) {
  await db`CREATE TABLE IF NOT EXISTS word_suggestions (
    child_id TEXT NOT NULL,
    taxonomy_slug TEXT NOT NULL,
    hit_count INT NOT NULL DEFAULT 1,
    last_heard_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (child_id, taxonomy_slug)
  )`;
}

async function consented(db, childId) {
  try {
    const r = await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`;
    return r.length && r[0].settings && r[0].settings.suggestFromListening === true;
  } catch (_) { return false; }
}

export async function suggestRecord(req, res, db, user, b, canAccessChild) {
  const childId = String(b.childId || '').slice(0, 64);
  const slugs = [...new Set((Array.isArray(b.slugs) ? b.slugs : [])
    .map((s) => String(s).trim()).filter((s) => /^[a-z0-9_.]{1,80}$/.test(s)))].slice(0, 40);
  if (!childId || !slugs.length) { res.status(400).json({ error: 'childId and slugs required' }); return; }
  if (!(await canAccessChild(user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  // Server-side consent check — the client also gates, but the server is the
  // rule (AC7: nothing recorded before opt-in).
  if (!(await consented(db, childId))) { res.status(200).json({ ok: true, recorded: 0, consent: false }); return; }
  await ensureSuggestions(db);
  let recorded = 0;
  for (const slug of slugs) {
    // dismissed_forever is a per-child tombstone; plain dismissed resurfaces
    // on the next hearing (spec: "may resurface if heard again").
    const r = await db`INSERT INTO word_suggestions (child_id, taxonomy_slug)
      VALUES (${childId}, ${slug})
      ON CONFLICT (child_id, taxonomy_slug) DO UPDATE
        SET hit_count = word_suggestions.hit_count + 1,
            last_heard_at = NOW(),
            status = CASE WHEN word_suggestions.status IN ('dismissed') THEN 'pending'
                          ELSE word_suggestions.status END
      RETURNING status`;
    if (r.length && r[0].status === 'pending') recorded++;
  }
  res.status(200).json({ ok: true, recorded, consent: true });
}

export async function suggestList(req, res, db, user, b, canAccessChild) {
  const childId = String(b.childId || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  await ensureSuggestions(db);
  // Join the taxonomy so the card carries label, section, band, and default
  // art — the parent decides with full context (AC5: above-band words still
  // suggested, band shown).
  const rows = await db`
    SELECT ws.taxonomy_slug, ws.hit_count, ws.last_heard_at, ws.status,
           t.label, t.column_name, t.category, t.acquisition_age, t.default_image_key
    FROM word_suggestions ws
    JOIN taxonomy t ON t.id = ws.taxonomy_slug
    WHERE ws.child_id = ${childId} AND ws.status = 'pending'
    ORDER BY ws.hit_count DESC, ws.last_heard_at DESC LIMIT 100`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, suggestions: rows.map((r) => ({
    slug: r.taxonomy_slug, label: r.label, section: r.column_name, category: r.category,
    band: r.acquisition_age || null, imageKey: r.default_image_key || null,
    hits: r.hit_count, lastHeardAt: r.last_heard_at })) });
}

const ACTIONS = { 'dismiss': 'dismissed', 'dismiss-forever': 'dismissed_forever', 'added': 'added', 'restore': 'pending' };
export async function suggestAct(req, res, db, user, b, canAccessChild) {
  const childId = String(b.childId || '').slice(0, 64);
  const slug = String(b.slug || '').slice(0, 80);
  const status = ACTIONS[String(b.action || '')];
  if (!childId || !slug || !status) { res.status(400).json({ error: 'childId, slug, action required' }); return; }
  if (!(await canAccessChild(user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  await ensureSuggestions(db);
  await db`UPDATE word_suggestions SET status = ${status}
           WHERE child_id = ${childId} AND taxonomy_slug = ${slug}`;
  res.status(200).json({ ok: true, slug, status });
}

// GET lexicon: the canonical matcher vocabulary (slug → label + variants) the
// board tokenizes against. Canonical + universal + live only; gestalts ARE
// included (scripts are exactly what a household says out loud). Small enough
// to ship whole; clients cache it and re-fetch at most daily.
export async function suggestLexicon(req, res, db) {
  let rows;
  try {
    rows = await db`SELECT id, label, match_terms, is_gestalt FROM taxonomy
      WHERE COALESCE(archived, FALSE) = FALSE
        AND COALESCE(authoring_kind, 'canonical') = 'canonical'
        AND COALESCE(audience, 'universal') = 'universal'
        AND COALESCE(status, 'published') = 'published'`;
  } catch (_) {
    rows = await db`SELECT id, label, match_terms FROM taxonomy
      WHERE COALESCE(archived, FALSE) = FALSE`;
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.status(200).json({ ok: true, lexicon: rows.map((r) => ({
    slug: r.id, label: r.label, terms: r.match_terms || [] })) });
}

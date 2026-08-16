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

// Tier gate (gap-fill spec §3.2): listening-driven suggestions are the
// $9.99+ hook — the $4.99 tier keeps the shared library but the board does
// not listen for what to offer next. Server-enforced here because /api/sync's
// entitlement flags are advisory; admin always passes. Resolution failure
// fails OPEN — suggestions are not a spend path, and a DB hiccup must not
// silently drop a consented family's capture.
async function gapFillAllowed(db, childId, user) {
  try {
    const { entitlementFor, boardOwnerId } = await import('./credits.js');
    const ownerId = await boardOwnerId(db, childId);
    const ent = await entitlementFor(db, ownerId || user, { childId });
    return ent.tier === 'admin' || !!(ent.features && ent.features.gapFill);
  } catch (_) { return true; }
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
  if (!(await gapFillAllowed(db, childId, user))) {
    res.status(200).json({ ok: true, recorded: 0, needsSubscription: true }); return;
  }
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
  if (!(await gapFillAllowed(db, childId, user))) {
    // Parent-facing surfaces may upsell (only the CHILD board must never
    // tease, per GF-22) — the flag lets the panel say why it's empty.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, suggestions: [], needsSubscription: true });
    return;
  }
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

// ── Gap-B word requests ─────────────────────────────────────────────────────
// A word the taxonomy does NOT know, explicitly requested by the parent from
// the on-device ledger. PRIVACY MODEL: the tap IS the share — one word, one
// affirmative parent action; no blanket consent needed for this path (the
// automatic research-ledger share is a separate, future Consent B). We store
// the word, who asked (needed to deliver the tile later), a device-reported
// hit count, and locale — never context, never transcripts.
//
// Lifecycle: requested → accepted (admin queued it for authoring) or
// rejected → delivered (the word entered the taxonomy with default art and a
// word_suggestions row was minted, so the parent's existing Add/Dismiss flow
// takes over — GF-26: nothing ever lands on a board unreviewed).
export async function ensureWordRequests(db) {
  await db`CREATE TABLE IF NOT EXISTS word_requests (
    id BIGSERIAL PRIMARY KEY,
    child_id TEXT NOT NULL,
    word TEXT NOT NULL,
    raw_word TEXT,
    locale TEXT DEFAULT 'en-US',
    hit_count INT,
    status TEXT NOT NULL DEFAULT 'requested',
    taxonomy_slug TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (child_id, word)
  )`;
  await db`CREATE INDEX IF NOT EXISTS word_requests_word_idx ON word_requests(word)`;
}

// Normalization is deliberately strict: letters, spaces, hyphens, apostrophes
// only, ≤60 chars — a request is a WORD, not a sentence fragment.
function normalizeRequestWord(s) {
  const w = String(s || '').toLowerCase().normalize('NFC')
    .replace(/[’']/g, "'").replace(/[^a-z' \-]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60);
  return /^[a-z][a-z' \-]*$/.test(w) ? w : '';
}

export async function requestWord(req, res, db, user, b, canAccessChild) {
  const childId = String(b.childId || '').slice(0, 64);
  const word = normalizeRequestWord(b.word);
  if (!childId || !word) { res.status(400).json({ error: 'childId and word required' }); return; }
  if (!(await canAccessChild(user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  if (!(await gapFillAllowed(db, childId, user))) {
    res.status(402).json({ error: 'needs_subscription',
      detail: 'New-word requests are part of Plus and Pro memberships.' });
    return;
  }
  // Never let profanity into the request queue, whatever the recognizer heard.
  try {
    const { BAD_WORDS } = await import('./bad-words.js');
    if (word.split(' ').some((t) => BAD_WORDS.includes(t))) {
      res.status(400).json({ error: 'not_requestable' }); return;
    }
  } catch (_) {}
  // Already in the taxonomy? Then this is a Gap-A suggestion, not a request —
  // mint the suggestion row directly so the parent panel picks it up.
  try {
    const hit = (await db`
      SELECT id FROM taxonomy
      WHERE LOWER(label) = ${word} AND COALESCE(archived, FALSE) = FALSE
      LIMIT 1`)[0];
    if (hit) {
      await ensureSuggestions(db);
      await db`INSERT INTO word_suggestions (child_id, taxonomy_slug)
        VALUES (${childId}, ${hit.id})
        ON CONFLICT (child_id, taxonomy_slug) DO UPDATE
          SET last_heard_at = NOW(),
              status = CASE WHEN word_suggestions.status = 'dismissed' THEN 'pending'
                            ELSE word_suggestions.status END`;
      res.status(200).json({ ok: true, inTaxonomy: true, slug: hit.id }); return;
    }
  } catch (_) {}
  await ensureWordRequests(db);
  const hits = Math.max(0, Math.min(100000, Number(b.hits) || 0));
  const raw = typeof b.rawWord === 'string' ? b.rawWord.slice(0, 80) : null;
  const locale = /^[a-zA-Z-]{2,12}$/.test(String(b.locale || '')) ? String(b.locale) : 'en-US';
  const row = (await db`INSERT INTO word_requests (child_id, word, raw_word, locale, hit_count)
    VALUES (${childId}, ${word}, ${raw}, ${locale}, ${hits})
    ON CONFLICT (child_id, word) DO UPDATE
      SET hit_count = GREATEST(COALESCE(word_requests.hit_count, 0), ${hits}),
          updated_at = NOW()
    RETURNING status`)[0];
  res.status(200).json({ ok: true, status: row.status });
}

// The family's own request states — lets the device show "requested ✓" and
// stop re-offering a word that's already in the pipeline.
export async function requestList(req, res, db, user, b, canAccessChild) {
  const childId = String(b.childId || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  await ensureWordRequests(db);
  const rows = await db`
    SELECT word, status, taxonomy_slug, created_at FROM word_requests
    WHERE child_id = ${childId} ORDER BY created_at DESC LIMIT 200`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, requests: rows.map((r) => ({
    word: r.word, status: r.status, slug: r.taxonomy_slug || null, at: r.created_at })) });
}

// Fulfillment pass (admin, invoked from the gap-words dashboard): any open
// request whose word now exists in the taxonomy WITH default art becomes a
// pending word_suggestions row for every requesting child — the parent's
// existing review flow (Add ⭐1 / Dismiss / Never) is the delivery vehicle.
export async function deliverFulfilled(db) {
  await ensureWordRequests(db);
  await ensureSuggestions(db);
  const ready = await db`
    SELECT wr.id, wr.child_id, wr.word, t.id AS slug
    FROM word_requests wr
    JOIN taxonomy t ON LOWER(t.label) = wr.word
      AND COALESCE(t.archived, FALSE) = FALSE
      AND t.default_image_key IS NOT NULL
    WHERE wr.status IN ('requested', 'accepted')
    LIMIT 500`;
  let delivered = 0;
  for (const r of ready) {
    await db`INSERT INTO word_suggestions (child_id, taxonomy_slug)
      VALUES (${r.child_id}, ${r.slug})
      ON CONFLICT (child_id, taxonomy_slug) DO UPDATE SET last_heard_at = NOW()`;
    await db`UPDATE word_requests SET status = 'delivered', taxonomy_slug = ${r.slug},
             updated_at = NOW() WHERE id = ${r.id}`;
    delivered++;
  }
  return delivered;
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

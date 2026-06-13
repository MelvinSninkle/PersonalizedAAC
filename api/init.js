// POST /api/init — create tables if they don't exist. Idempotent.
// Auth-gated so a stranger can't probe the schema.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  if (auth.user.role !== 'admin') {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  try {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS categories (
        id BIGSERIAL PRIMARY KEY,
        section TEXT NOT NULL,
        label TEXT NOT NULL,
        parent_id BIGINT REFERENCES categories(id) ON DELETE CASCADE,
        image_url TEXT,
        image_key TEXT,
        keep_aspect BOOLEAN NOT NULL DEFAULT FALSE,
        display_order BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`ALTER TABLE categories ADD COLUMN IF NOT EXISTS keep_aspect BOOLEAN NOT NULL DEFAULT FALSE`;
    await db`ALTER TABLE categories ADD COLUMN IF NOT EXISTS child_id TEXT NOT NULL DEFAULT 'fletcher'`;
    await db`CREATE INDEX IF NOT EXISTS categories_section_idx ON categories(section)`;
    await db`CREATE INDEX IF NOT EXISTS categories_parent_idx  ON categories(parent_id)`;
    await db`CREATE INDEX IF NOT EXISTS categories_child_idx   ON categories(child_id)`;

    await db`
      CREATE TABLE IF NOT EXISTS items (
        id BIGSERIAL PRIMARY KEY,
        section TEXT NOT NULL,
        category_id BIGINT REFERENCES categories(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        image_url TEXT,
        image_key TEXT,
        sound_url TEXT,
        sound_key TEXT,
        keep_aspect BOOLEAN NOT NULL DEFAULT FALSE,
        display_order BIGINT NOT NULL DEFAULT 0,
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS keep_aspect BOOLEAN NOT NULL DEFAULT FALSE`;
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS child_id TEXT NOT NULL DEFAULT 'fletcher'`;
    await db`CREATE INDEX IF NOT EXISTS items_section_idx  ON items(section)`;
    await db`CREATE INDEX IF NOT EXISTS items_category_idx ON items(category_id)`;
    await db`CREATE INDEX IF NOT EXISTS items_child_idx    ON items(child_id)`;

    // Content ownership: NULL = shared/parent board (parent or admin may edit);
    // a user id = therapist-owned content on a "custom board" that only that
    // therapist may edit or delete (the child can still see/use it).
    await db`ALTER TABLE categories ADD COLUMN IF NOT EXISTS owner_user_id BIGINT`;
    await db`ALTER TABLE items      ADD COLUMN IF NOT EXISTS owner_user_id BIGINT`;
    await db`CREATE INDEX IF NOT EXISTS categories_owner_idx ON categories(owner_user_id)`;
    await db`CREATE INDEX IF NOT EXISTS items_owner_idx      ON items(owner_user_id)`;

    // §8.3 Therapist custom boards: a template = a category with child_id NULL
    // and owner_user_id = <therapist>. Allow nullable child_id on both tables
    // so a single canonical template (and its items) can be shared with many
    // children. Existing per-child rows keep their child_id; only templates use NULL.
    await db`ALTER TABLE categories ALTER COLUMN child_id DROP NOT NULL`;
    await db`ALTER TABLE items      ALTER COLUMN child_id DROP NOT NULL`;

    // Category "kind" — special-render hint for the kid app. Two values today:
    //   'location' → a place (Home, Grandma's). Tap a location chip and the
    //                tablet speaks its name + shows its children as ROOMS.
    //   'room'     → a room (Kitchen, Bedroom). Short-press speaks its name;
    //                long-press opens the room's interior (its items) in an
    //                overlay; long-press the same room again to back out.
    // null/missing = normal category. This is what lets a parent build a tidy
    // "Places" tree (Places → Home → Kitchen → toaster) without nesting
    // chip-strips four levels deep.
    await db`ALTER TABLE categories ADD COLUMN IF NOT EXISTS kind TEXT`;
    await db`CREATE INDEX IF NOT EXISTS categories_kind_idx ON categories(kind)`;

    // Which template categories are visible on which child's board. A 'removed'
    // row records that a parent has overridden the visibility for their child;
    // re-sharing by the owner flips it back to 'active'.
    await db`
      CREATE TABLE IF NOT EXISTS category_shares (
        id BIGSERIAL PRIMARY KEY,
        category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        child_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'removed'
        created_by BIGINT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (category_id, child_id)
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS category_shares_child_idx    ON category_shares(child_id, status)`;
    await db`CREATE INDEX IF NOT EXISTS category_shares_category_idx ON category_shares(category_id)`;

    // Activity log — kid-mode button taps. No FK to items so history
    // survives item deletes; label / category / subcategory are
    // snapshotted at log time for stable analytics.
    await db`
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        role TEXT NOT NULL,
        item_id BIGINT,
        section TEXT,
        label TEXT,
        category_name TEXT,
        subcategory_name TEXT,
        client_id TEXT,
        occurred_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`ALTER TABLE events ADD COLUMN IF NOT EXISTS category_name TEXT`;
    await db`ALTER TABLE events ADD COLUMN IF NOT EXISTS subcategory_name TEXT`;
    await db`ALTER TABLE events ADD COLUMN IF NOT EXISTS child_id TEXT NOT NULL DEFAULT 'fletcher'`;
    await db`CREATE INDEX IF NOT EXISTS events_role_idx          ON events(role)`;
    await db`CREATE INDEX IF NOT EXISTS events_occurred_at_idx   ON events(occurred_at)`;
    await db`CREATE INDEX IF NOT EXISTS events_item_idx          ON events(item_id)`;
    await db`CREATE INDEX IF NOT EXISTS events_child_idx         ON events(child_id)`;

    // ---- User accounts (login flow) ----
    // email + scrypt password hash + role. reset_token/reset_expires support a
    // password-reset flow (email delivery wired later).
    await db`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'parent',
        child_slug TEXT,
        reset_token TEXT,
        reset_expires TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS users_role_idx        ON users(role)`;
    await db`CREATE INDEX IF NOT EXISTS users_reset_token_idx ON users(reset_token)`;

    // ---- Child access roster (many-to-many) ----
    // Replaces the single users.child_slug: a therapist can be linked to many
    // children; a child can have a parent + several therapists. Data endpoints
    // will scope reads/writes through this (enforcement lands in a follow-up).
    await db`
      CREATE TABLE IF NOT EXISTS child_access (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        child_id TEXT NOT NULL,
        relation TEXT NOT NULL DEFAULT 'therapist',   -- 'parent' | 'therapist'
        status TEXT NOT NULL DEFAULT 'active',         -- 'active' | 'pending'
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, child_id)
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS child_access_user_idx  ON child_access(user_id)`;
    await db`CREATE INDEX IF NOT EXISTS child_access_child_idx ON child_access(child_id)`;
    // Backfill from the legacy single-child column so existing parents keep access.
    await db`
      INSERT INTO child_access (user_id, child_id, relation, status)
      SELECT id, child_slug, CASE WHEN role = 'therapist' THEN 'therapist' ELSE 'parent' END, 'active'
      FROM users WHERE child_slug IS NOT NULL
      ON CONFLICT (user_id, child_id) DO NOTHING
    `;

    // ---- Parent ↔ therapist handshake: an invite (parent → therapist) or a
    // request (therapist → parent). Accepting it creates the child_access row. ----
    await db`
      CREATE TABLE IF NOT EXISTS access_requests (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL,
        therapist_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
        therapist_email TEXT,
        direction TEXT NOT NULL,                       -- 'invite' | 'request'
        status TEXT NOT NULL DEFAULT 'pending',        -- 'pending' | 'accepted' | 'declined'
        created_by BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at TIMESTAMPTZ
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS access_requests_child_idx     ON access_requests(child_id, status)`;
    await db`CREATE INDEX IF NOT EXISTS access_requests_therapist_idx ON access_requests(therapist_user_id, status)`;

    // ---- Learning sessions + game attempts (Interactive Modes PRD v1.0) ----
    // A `session` is one run of any mode (game / slideshow / celebration) or a
    // free-communication "use" window. `game_attempts` are the per-item results
    // inside a scored game. Together they feed the parent/therapist dashboards.
    await db`
      CREATE TABLE IF NOT EXISTS sessions (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL DEFAULT 'fletcherpeterson',
        mode TEXT NOT NULL,
        category TEXT,
        facilitator TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        correct_count INTEGER NOT NULL DEFAULT 0,
        item_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS sessions_child_idx   ON sessions(child_id)`;
    await db`CREATE INDEX IF NOT EXISTS sessions_started_idx ON sessions(started_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS sessions_mode_idx    ON sessions(mode)`;

    await db`
      CREATE TABLE IF NOT EXISTS game_attempts (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT REFERENCES sessions(id) ON DELETE CASCADE,
        child_id TEXT NOT NULL DEFAULT 'fletcherpeterson',
        category TEXT,
        label TEXT,
        item_id BIGINT,
        correct BOOLEAN NOT NULL DEFAULT FALSE,
        input_method TEXT,
        misses INTEGER NOT NULL DEFAULT 0,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS game_attempts_child_idx    ON game_attempts(child_id)`;
    await db`CREATE INDEX IF NOT EXISTS game_attempts_session_idx  ON game_attempts(session_id)`;
    await db`CREATE INDEX IF NOT EXISTS game_attempts_occurred_idx ON game_attempts(occurred_at)`;
    await db`CREATE INDEX IF NOT EXISTS game_attempts_category_idx ON game_attempts(category)`;

    // ---- Learning Engine spine (PRD §3, §4, §6, §7) ----
    // Phase 1 of the data + scoring overhaul: add the columns + empty tables
    // that the later phases (mercy cutover, spike detection, exposure engine,
    // skill insights) will fill in. All migrations idempotent + additive so
    // existing dashboards/payloads keep working unchanged.

    // Sessions: dynamic denominator (slides actually attempted, not full
    // length), why the session ended, the canonical skill anchor, and a
    // scoring-version stamp so dashboards can mark the mercy-mechanic
    // cutover cleanly.
    await db`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS slides_attempted INT`;
    await db`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_reason       TEXT`;
    await db`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS skill_slug       TEXT`;
    await db`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scoring_version  INT NOT NULL DEFAULT 1`;
    await db`CREATE INDEX IF NOT EXISTS sessions_skill_slug_idx       ON sessions(skill_slug)`;
    await db`CREATE INDEX IF NOT EXISTS sessions_scoring_version_idx  ON sessions(scoring_version)`;

    // PRD §5 Auditory Comprehension: optional description on items for the
    // "hear a description, pick the picture" mode. Empty/missing falls back
    // to "Who/what is the [label]?" in the game view.
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS description TEXT`;

    // Rotating TEACHING descriptions — 2-3 short, child-directed sentences per
    // tile, each from a different angle (function / feature / context) so the
    // child builds real understanding of the word, not just picture-recognition.
    // Generated by /api/generate-descriptions; surfaced in board learn-mode and
    // the Auditory Comprehension game. `description` (singular) above stays as
    // the legacy single-clue field; this is the array.
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS descriptions TEXT[]`;

    // Bulk photo import review queue. A tile created by the iOS/web bulk import
    // is added to the board immediately (so the child sees it) but flagged
    // needs_review = TRUE so the parent gets a "review these AI-named tiles"
    // queue on BOTH surfaces (native review sheet + web parent dashboard).
    // Confirming a tile clears the flag; single-tile adds never set it.
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE`;
    await db`CREATE INDEX IF NOT EXISTS items_needs_review_idx ON items(child_id, needs_review)`;

    // Per-attempt mercy + difficulty + child-generated method flag.
    // attempts_taken defaults to 1 (back-compat: every legacy attempt was
    // recorded as "took one try"). child_generated is NULL on legacy rows
    // so analytics can distinguish "not tracked" from "explicitly tap".
    await db`ALTER TABLE game_attempts ADD COLUMN IF NOT EXISTS attempts_taken   INT NOT NULL DEFAULT 1`;
    await db`ALTER TABLE game_attempts ADD COLUMN IF NOT EXISTS distractor_count INT`;
    await db`ALTER TABLE game_attempts ADD COLUMN IF NOT EXISTS child_generated  BOOLEAN`;

    // Per-session mastery flags: 2σ / 3σ / perfect_pass, plus a parallel row
    // computed on the child-generated-only subset (voice/gesture/object).
    // Empty in Phase 1; Phase 6's inline spike check fills it.
    await db`
      CREATE TABLE IF NOT EXISTS session_flags (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,                          -- 'spike_2sigma' | 'spike_3sigma' | 'perfect_pass'
        sigma NUMERIC,
        observed_pct NUMERIC,
        baseline_mu NUMERIC,
        baseline_sigma NUMERIC,
        child_generated_only BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await db`CREATE INDEX IF NOT EXISTS session_flags_session_idx ON session_flags(session_id)`;
    await db`CREATE INDEX IF NOT EXISTS session_flags_kind_idx    ON session_flags(kind, created_at)`;

    // Consolidated per-skill narrative ("joint attention improving",
    // "present but inconsistent", "mastered", "consider_eval"). One row per
    // (child, skill, mode); Phase 7 refreshes via daily cron.
    await db`
      CREATE TABLE IF NOT EXISTS skill_insights (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL,
        skill_slug TEXT NOT NULL,
        mode TEXT NOT NULL,
        label TEXT NOT NULL,
        evidence JSONB,
        consider_eval BOOLEAN NOT NULL DEFAULT FALSE,
        dismissed_at TIMESTAMPTZ,
        dismissed_by TEXT,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (child_id, skill_slug, mode)
      )`;
    await db`CREATE INDEX IF NOT EXISTS skill_insights_child_idx ON skill_insights(child_id, generated_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS skill_insights_eval_idx  ON skill_insights(consider_eval) WHERE consider_eval = TRUE`;

    // Adaptive exposure engine (Phases 5 + 7). Empty until Phase 5 wires the
    // slideshow + /api/exposure-tick to write to them.
    await db`
      CREATE TABLE IF NOT EXISTS exposure_protocols (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL,
        skill_slug TEXT NOT NULL,
        stage INT NOT NULL DEFAULT 1,                -- 1..5 → 10/20/30/40/50 ceiling
        target_count INT NOT NULL DEFAULT 10,
        current_count INT NOT NULL DEFAULT 0,
        spacing_mode TEXT NOT NULL DEFAULT 'standard',  -- 'standard' | 'tightened'
        status TEXT NOT NULL DEFAULT 'intro',         -- 'intro' | 'spacing' | 'mastered' | 'eval_flagged'
        next_due_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ,
        mastered_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (child_id, skill_slug)
      )`;
    await db`CREATE INDEX IF NOT EXISTS exposure_protocols_due_idx ON exposure_protocols(child_id, next_due_at)`;

    await db`
      CREATE TABLE IF NOT EXISTS exposure_events (
        id BIGSERIAL PRIMARY KEY,
        protocol_id BIGINT NOT NULL REFERENCES exposure_protocols(id) ON DELETE CASCADE,
        session_id BIGINT REFERENCES sessions(id) ON DELETE SET NULL,
        source TEXT NOT NULL DEFAULT 'slideshow',   -- 'slideshow' | 'game' | 'free_use'
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await db`CREATE INDEX IF NOT EXISTS exposure_events_protocol_idx ON exposure_events(protocol_id, occurred_at DESC)`;

    // NOTE: the sessions.skill_slug backfill that reads game_attempts.taxonomy_slug
    // is deferred to AFTER the keystone column-adds below (§14), because it depends
    // on game_attempts.taxonomy_slug existing. Running it here failed on any DB
    // where that column hadn't been added yet ("column a.taxonomy_slug does not exist").

    // ---- AI image generation: cost/volume log + per-child reference images ----
    await db`
      CREATE TABLE IF NOT EXISTS image_generations (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT,
        actor_email TEXT,
        actor_role TEXT,
        label TEXT,
        style TEXT,
        prompt TEXT,
        reference_keys TEXT[],
        size TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost_cents NUMERIC(12,4),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS image_generations_child_idx   ON image_generations(child_id)`;
    await db`CREATE INDEX IF NOT EXISTS image_generations_actor_idx   ON image_generations(actor_email)`;
    await db`CREATE INDEX IF NOT EXISTS image_generations_created_idx ON image_generations(created_at DESC)`;

    // Every previous picture a tile has ever had. We never delete a Blob when a
    // tile's image_key changes — the old key gets archived here so the parent
    // can scroll back through the visual memorabilia of their child's board
    // (Grandma at 14 months, Grandma at 3 years, the dog they used to have…).
    // ON DELETE SET NULL on item_id so history outlives the tile that owned it.
    await db`
      CREATE TABLE IF NOT EXISTS item_image_history (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL,
        item_id BIGINT REFERENCES items(id) ON DELETE SET NULL,
        item_label TEXT,                              -- snapshotted at archive time so deleted-tile history is still readable
        section TEXT,
        blob_key TEXT NOT NULL,
        prompt TEXT,
        model TEXT,
        source TEXT,                                  -- 'generated' | 'uploaded' | 'onboarding' | 'lab' | 'pending'
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        archived_by TEXT
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS item_image_history_child_idx   ON item_image_history(child_id, archived_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS item_image_history_item_idx    ON item_image_history(item_id, archived_at DESC)`;

    await db`
      CREATE TABLE IF NOT EXISTS reference_images (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL,
        blob_key TEXT NOT NULL,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS reference_images_child_idx ON reference_images(child_id)`;

    // ---- Live session room (facilitator phone ↔ tablet, polled) ----
    await db`
      CREATE TABLE IF NOT EXISTS live_sessions (
        child_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        payload JSONB,
        cmd JSONB,
        cmd_seq INTEGER NOT NULL DEFAULT 0,
        state_seq INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ---- Onboarding capture queue (snap now, render in the background, review later) ----
    await db`
      CREATE TABLE IF NOT EXISTS pending_tiles (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        style TEXT,
        label TEXT,
        pronunciation TEXT,
        source_key TEXT,
        image_key TEXT,
        sound_key TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS pending_tiles_child_idx ON pending_tiles(child_id, status)`;

    // ---- Taxonomy workbench (Section 17 of the PRD) ----
    // Canonical library of tile prompts, separate from any one child's instance.
    // Edited via /admin/taxonomy; consumed by AI image generation in a later chunk.
    await db`
      CREATE TABLE IF NOT EXISTS taxonomy (
        id TEXT PRIMARY KEY,
        column_name TEXT NOT NULL,
        category TEXT,
        subcategory TEXT,
        label TEXT NOT NULL,
        pronunciation TEXT,
        prompt_template TEXT NOT NULL,
        subject_mode TEXT NOT NULL,
        parent_photo_behavior TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'v1_core',
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT,
        published_at TIMESTAMPTZ
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_column_idx   ON taxonomy(column_name)`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_phase_idx    ON taxonomy(phase)`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_status_idx   ON taxonomy(status)`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_archived_idx ON taxonomy(archived)`;
    // `core` = part of the baseline standard vocabulary a brand-new child starts with (Level 0).
    // Non-core concepts/categories grow in later as competence increases. A whole
    // category/subcategory is "non-core" when its tile rows are flagged non-core.
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS core BOOLEAN NOT NULL DEFAULT TRUE`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_core_idx      ON taxonomy(core)`;

    // ---- PRD §11.1 field additions (March 2026 alignment) ----
    // growth_stage: the developmental stage at which this tile becomes prominent
    // by default for a child on the standard scaffold (§4.2B). Advisory, never
    // a gate — parents/SLPs can surface anything at any stage. NULL = stage_5plus.
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS growth_stage TEXT`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_growth_idx ON taxonomy(growth_stage)`;
    // acquisition_age: the developmental band at which a typical child learns this
    // word (CDI/Brown's-stages bands: 12-18m, 18-30m, 2-3y, 3-4y, 4y+). Advisory
    // like growth_stage; drives early-intervention board filtering so a 14-month-
    // old isn't shown clutter. NULL on rows where the family decides (Personalize).
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS acquisition_age TEXT`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_age_idx ON taxonomy(acquisition_age)`;
    // Special-day events: full-screen celebration scenes (not tiles) that show
    // on the day, personalized with the child + close family. `event_key` is
    // one of the resolver keys in api/_lib/event-dates.js (fixed-date holidays
    // like 'christmas', computed ones like 'easter' / 'thanksgiving', and the
    // per-child 'birthday'). prompt_template uses {reference}, {family_adult},
    // and {family_all} the same way the regular tile generator does.
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS is_event BOOLEAN NOT NULL DEFAULT FALSE`;
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS event_key TEXT`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_event_idx ON taxonomy(event_key) WHERE is_event = TRUE`;
    // meal_context (food only): one of breakfast/lunch/dinner/snack/anytime.
    // Drives mode-based default-category in the Nouns column (§4.2).
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS meal_context TEXT`;
    // Gestalt track (§4.2A): is_gestalt marks whole-phrase tiles; gestalt_type
    // is the adult-supplied typology; gestalt_meaning is what the gestalt means
    // (essential for opaque holophrases); gestalt_target_words lists embedded
    // canonical word ids the system may help the child isolate.
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS is_gestalt BOOLEAN NOT NULL DEFAULT FALSE`;
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS gestalt_type TEXT`;
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS gestalt_meaning TEXT`;
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS gestalt_target_words TEXT[]`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_gestalt_idx ON taxonomy(is_gestalt)`;
    // See and Solve description-matching clues (§4.2C.2): ordered list of
    // meaning/function/relationship clues, easiest first.
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS descriptive_clues TEXT[]`;
    // Symbol-maturation ladder (§11.10): ordered set of renderings from
    // concrete-personal (level 0) to abstract-conventional. JSONB so each
    // rendering can carry its own prompt/notes; per-child operative level is
    // stored elsewhere (in the child's instantiation, not on the canonical row).
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS representation_levels JSONB`;
    // Place semantics for the kid-board drill-in behavior: 'location' = a place
    // you go (Home, Grandma's) that opens into rooms; 'room' = a room (Kitchen)
    // that opens into its items; NULL = an ordinary tile. Mirrors the board's
    // category `kind`, carried on the canonical row so generated boards inherit
    // the behavior. (A plain boolean couldn't tell a place from a room.)
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS place_kind TEXT`;

    // ---- Trainer-pattern columns: who is this row for + what kind of authoring ----
    // audience: who sees this taxonomy entry in their guided authoring flow.
    //   'universal'   → everyone (the standard library tile, e.g. apple)
    //   'parent'      → presented to parents during onboarding / "add favorites"
    //   'therapist'   → presented to therapists in their custom-board flow
    //   'school_team' → presented to teachers / aides authoring class boards
    //   'family'      → extended family (grandparents on the people roster)
    // authoring_kind: is this a pre-generated tile, or a SKELETON the user fills in?
    //   'canonical'         → fully-generated standard tile content (apple, monkey)
    //   'personal_skeleton' → no canonical image; just a label + guidance that
    //                          prompts a parent/teacher/therapist to author their
    //                          own version from a photo (fire drill, library day,
    //                          our pet, grandma's house). This is how the
    //                          "you may want to make tiles for things like this"
    //                          train-the-trainer pattern is represented in data.
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS audience       TEXT NOT NULL DEFAULT 'universal'`;
    await db`ALTER TABLE taxonomy ADD COLUMN IF NOT EXISTS authoring_kind TEXT NOT NULL DEFAULT 'canonical'`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_audience_idx       ON taxonomy(audience)`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_authoring_kind_idx ON taxonomy(authoring_kind)`;

    // §8.2 extension: an invite can target either a 'therapist' or a 'school_team'
    // member. The role applies to child_access.relation on accept. Defaults to
    // 'therapist' so existing invites flowing through keep their semantics.
    await db`ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS invite_relation TEXT NOT NULL DEFAULT 'therapist'`;

    // ---- Keystone fix (§14): the canonical anchor on items/categories/attempts ----
    // taxonomy_slug links a per-child instantiation back to the canonical
    // taxonomy id, so mastery + cross-child measurement can aggregate per
    // concept (not per section). Nullable: legacy rows stay null until touched.
    await db`ALTER TABLE items         ADD COLUMN IF NOT EXISTS taxonomy_slug TEXT`;
    await db`ALTER TABLE categories    ADD COLUMN IF NOT EXISTS taxonomy_slug TEXT`;
    await db`ALTER TABLE game_attempts ADD COLUMN IF NOT EXISTS taxonomy_slug TEXT`;
    await db`CREATE INDEX IF NOT EXISTS items_taxonomy_slug_idx         ON items(taxonomy_slug)`;
    await db`CREATE INDEX IF NOT EXISTS categories_taxonomy_slug_idx    ON categories(taxonomy_slug)`;
    await db`CREATE INDEX IF NOT EXISTS game_attempts_taxonomy_slug_idx ON game_attempts(taxonomy_slug)`;

    // ---- One-shot backfill: sessions.skill_slug from game_attempts ----
    // PRD §11 anchors mastery/spike math to taxonomy_slug. Sessions logged
    // before Phase 2 didn't carry it on the session row; recover it as the
    // most-common taxonomy_slug across the session's attempts (NULL when the
    // session has no slugged attempts — analytics falls back to label).
    // Idempotent: only fills rows where skill_slug IS NULL. MUST run after the
    // game_attempts.taxonomy_slug column-add directly above — it reads that column.
    await db`
      UPDATE sessions s SET skill_slug = sub.slug
      FROM (
        SELECT session_id, slug FROM (
          SELECT a.session_id,
                 NULLIF(a.taxonomy_slug, '') AS slug,
                 count(*) AS n,
                 row_number() OVER (PARTITION BY a.session_id ORDER BY count(*) DESC) AS rn
          FROM game_attempts a
          WHERE a.taxonomy_slug IS NOT NULL AND a.taxonomy_slug <> ''
          GROUP BY a.session_id, a.taxonomy_slug
        ) ranked
        WHERE ranked.rn = 1
      ) sub
      WHERE s.id = sub.session_id AND s.skill_slug IS NULL`;

    // Point-in-time snapshots so any bulk op or restore is itself reversible.
    await db`
      CREATE TABLE IF NOT EXISTS taxonomy_snapshots (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT,
        label TEXT,
        note TEXT,
        row_count INTEGER NOT NULL,
        payload JSONB NOT NULL
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_snapshots_created_idx ON taxonomy_snapshots(created_at DESC)`;

    // Write-only audit trail. Filterable, retained indefinitely.
    await db`
      CREATE TABLE IF NOT EXISTS taxonomy_audit (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor TEXT,
        action TEXT NOT NULL,
        row_ids TEXT[],
        summary TEXT,
        note TEXT
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_audit_ts_idx     ON taxonomy_audit(ts DESC)`;
    await db`CREATE INDEX IF NOT EXISTS taxonomy_audit_action_idx ON taxonomy_audit(action)`;

    // ---- Admin Lab (/admin/lab.html): prompt + style + model QC workbench ----
    // Style guides are admin-uploaded reference images used as the visual style
    // anchor when generating canonical taxonomy images. Distinct from per-child
    // reference_images (which are a kid's own photos). One singleton lab_settings
    // row holds the master wrapper prompt + global model defaults. model_routes
    // maps a scope (e.g. category=People) to a preferred model; per-row override
    // wins over routes which win over master defaults. tile_generations is the
    // per-tile QC gallery; image_generations remains the cost log of record.
    await db`
      CREATE TABLE IF NOT EXISTS style_guides (
        id BIGSERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT,
        blob_url TEXT NOT NULL,
        blob_key TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS style_guides_active_idx ON style_guides(active)`;
    await db`CREATE INDEX IF NOT EXISTS style_guides_sort_idx   ON style_guides(sort_order)`;

    await db`
      CREATE TABLE IF NOT EXISTS lab_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        master_prompt TEXT NOT NULL DEFAULT '',
        model_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
        size_default TEXT NOT NULL DEFAULT '1024x1024',
        notes TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT
      )
    `;
    // Seed the singleton row with a starter master prompt the user can edit later.
    await db`
      INSERT INTO lab_settings (id, master_prompt, model_defaults, size_default)
      VALUES (
        1,
        'Generate a child-friendly illustration in the visual style of the attached style reference image.

Subject: {content}

Tile label: "{label}" — bake the label as clean, large, sans-serif text along the bottom edge of the image, on a soft contrasting band that does not obscure the subject. The label must be spelled exactly and easy for a non-reader to associate with the picture.

Composition: centered subject, generous negative space, simple uncluttered background. Friendly, warm, never frightening. {no_face_rule}

Size: {size}. No watermarks, no extra text other than the tile label.',
        '{"default":"gpt-image-1.5","face_safe":"gpt-image-2"}'::jsonb,
        '1024x1024'
      )
      ON CONFLICT (id) DO NOTHING
    `;

    await db`
      CREATE TABLE IF NOT EXISTS model_routes (
        id BIGSERIAL PRIMARY KEY,
        scope_kind TEXT NOT NULL,
        scope_value TEXT NOT NULL,
        model TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS model_routes_lookup_idx   ON model_routes(scope_kind, scope_value)`;
    await db`CREATE INDEX IF NOT EXISTS model_routes_priority_idx ON model_routes(priority DESC)`;

    await db`
      CREATE TABLE IF NOT EXISTS tile_generations (
        id BIGSERIAL PRIMARY KEY,
        taxonomy_id TEXT NOT NULL,
        style_guide_id BIGINT REFERENCES style_guides(id) ON DELETE SET NULL,
        model TEXT NOT NULL,
        prompt_used TEXT,
        blob_url TEXT NOT NULL,
        blob_key TEXT,
        rating SMALLINT,
        marked_best BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        cost_cents NUMERIC(12,4),
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS tile_generations_taxonomy_idx ON tile_generations(taxonomy_id, created_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS tile_generations_best_idx     ON tile_generations(taxonomy_id, marked_best)`;
    await db`CREATE INDEX IF NOT EXISTS tile_generations_style_idx    ON tile_generations(style_guide_id)`;

    // ---- Private-preview invite codes (redeemed at /welcome via /api/invite) ----
    await db`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id BIGSERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        label TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        uses INTEGER NOT NULL DEFAULT 0,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS invite_codes_active_idx ON invite_codes(active)`;

    // ---- Per-child settings (reward cheers/music + scheduled prompts); parent writes, kid app reads ----
    await db`
      CREATE TABLE IF NOT EXISTS child_settings (
        child_id TEXT PRIMARY KEY,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ---- Interactive question answers (bathroom/hunger checks etc.); push hook in Phase C ----
    await db`
      CREATE TABLE IF NOT EXISTS interaction_log (
        id BIGSERIAL PRIMARY KEY,
        child_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'question',
        prompt TEXT,
        response TEXT,
        schedule_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS interaction_log_child_idx ON interaction_log(child_id, created_at DESC)`;

    // ---- Device push tokens (self-hosted APNs); only parent-role tokens are pushed ----
    await db`
      CREATE TABLE IF NOT EXISTS push_tokens (
        token TEXT PRIMARY KEY,
        child_id TEXT,
        role TEXT,
        platform TEXT DEFAULT 'ios',
        user_email TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS push_tokens_child_role_idx ON push_tokens(child_id, role)`;

    // ---- Landing-page email capture ----
    await db`
      CREATE TABLE IF NOT EXISTS waitlist (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        style TEXT,
        note TEXT,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS waitlist_email_idx   ON waitlist(email)`;
    await db`CREATE INDEX IF NOT EXISTS waitlist_created_idx ON waitlist(created_at DESC)`;

    // ---- People identities: name vs. relationship (docs/people-data-model.md) ----
    // The real person behind the People-section tiles. Separates the spoken/shown
    // name (display_name) from the actual given name, and captures a structured
    // relationship to the child (+ which side of the family), pronoun, and birth
    // order — so a sibling can be distinguished ("Brother 1", "Brother 2") and a
    // feature can ask for "the child's mother" and get her name + photo + pronoun.
    // Owns the stylized reference photo + voice clip. relationship values live in
    // api/_lib/relationships.js.
    await db`
      CREATE TABLE IF NOT EXISTS persons (
        id            BIGSERIAL PRIMARY KEY,
        child_id      TEXT NOT NULL,
        display_name  TEXT NOT NULL,                  -- shown + spoken on the tile ("Papa Gary", "Mama")
        given_name    TEXT,                           -- the real first name ("Gary", "Jane")
        relationship  TEXT NOT NULL DEFAULT 'other',  -- mother | father | grandfather | brother | …
        side          TEXT,                           -- 'maternal' | 'paternal' | NULL
        pronoun       TEXT,                           -- 'she' | 'he' | 'they' | NULL
        birth_order   INTEGER,                        -- among siblings; lower = older
        is_self       BOOLEAN NOT NULL DEFAULT FALSE, -- the child whose board this is
        reference_key TEXT,                           -- stylized subject-anchor photo
        voice_key     TEXT,                           -- TTS clip
        pronunciation TEXT,                           -- "say it as…" phonetic
        notes         TEXT,
        birth_date    DATE,                           -- on the is_self row, drives age-band board filtering
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`ALTER TABLE persons ADD COLUMN IF NOT EXISTS birth_date DATE`;
    // Parent-set or auto-mastery-set unlock: 'show me at least this far up the
    // age-band ladder, even if the child's birth date suggests younger.' Only
    // meaningful on the is_self row; resolved alongside birth_date in age-band.
    await db`ALTER TABLE persons ADD COLUMN IF NOT EXISTS advanced_to_band TEXT`;
    await db`ALTER TABLE persons ADD COLUMN IF NOT EXISTS advanced_at TIMESTAMPTZ`;
    // 'parent' (manual unlock) | 'mastery' (auto-advanced from assessment perf)
    await db`ALTER TABLE persons ADD COLUMN IF NOT EXISTS advanced_reason TEXT`;

    // Sign in with Apple. apple_user_id is the stable identifier from Apple's
    // JWT 'sub' claim; we keep it separate from the email because Apple may
    // return a private-relay address that the user can revoke later.
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_user_id TEXT UNIQUE`;
    await db`CREATE INDEX IF NOT EXISTS users_apple_idx ON users(apple_user_id) WHERE apple_user_id IS NOT NULL`;

    // Onboarding progress — durable per-account, so a parent who starts on
    // the web and finishes on the phone (or vice versa) picks up exactly
    // where they left off. step values are the ordered flow keys:
    //   'account' | 'child' | 'child_photo' | 'parent_photo' | 'seed_core' | 'complete'
    await db`
      CREATE TABLE IF NOT EXISTS onboarding_progress (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        child_id TEXT,
        step TEXT NOT NULL DEFAULT 'account',
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await db`CREATE INDEX IF NOT EXISTS persons_child_idx ON persons(child_id)`;
    await db`CREATE INDEX IF NOT EXISTS persons_rel_idx   ON persons(child_id, relationship)`;
    // People-section tiles point at the person they depict (nullable: only people tiles use it).
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS person_id BIGINT REFERENCES persons(id)`;
    await db`CREATE INDEX IF NOT EXISTS items_person_idx ON items(person_id)`;

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Init failed', detail: String(err.message || err) });
  }
}

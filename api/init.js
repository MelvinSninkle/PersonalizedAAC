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

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Init failed', detail: String(err.message || err) });
  }
}

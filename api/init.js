// POST /api/init — create tables if they don't exist. Idempotent.
// Auth-gated so a stranger can't probe the schema.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
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

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Init failed', detail: String(err.message || err) });
  }
}

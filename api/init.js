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
    await db`CREATE INDEX IF NOT EXISTS categories_section_idx ON categories(section)`;
    await db`CREATE INDEX IF NOT EXISTS categories_parent_idx  ON categories(parent_id)`;

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
    await db`CREATE INDEX IF NOT EXISTS items_section_idx  ON items(section)`;
    await db`CREATE INDEX IF NOT EXISTS items_category_idx ON items(category_id)`;

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
    await db`CREATE INDEX IF NOT EXISTS events_role_idx          ON events(role)`;
    await db`CREATE INDEX IF NOT EXISTS events_occurred_at_idx   ON events(occurred_at)`;
    await db`CREATE INDEX IF NOT EXISTS events_item_idx          ON events(item_id)`;

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Init failed', detail: String(err.message || err) });
  }
}

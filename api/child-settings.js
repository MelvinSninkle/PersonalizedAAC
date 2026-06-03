// /api/child-settings — per-child config the parent sets (often from their phone)
// and the kid app reads. Holds reward cheers/music now, and scheduled prompts
// (timed games + reminders) next. Stored as one JSON blob per child.
//   GET  ?childId=            → { settings }
//   POST ?childId= { settings }  → replace the whole settings object
// Auth-gated; writes are limited to parent/therapist/admin (not the child view).
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

async function ensureTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS child_settings (
      child_id TEXT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
  const db = sql();
  try { await ensureTable(db); } catch (_) {}

  if (req.method === 'GET') {
    try {
      const rows = await db`SELECT settings FROM child_settings WHERE child_id = ${childId}`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ settings: rows.length ? rows[0].settings : {} });
    } catch (err) { res.status(500).json({ error: 'Load failed', detail: String(err.message || err) }); }
    return;
  }

  if (req.method === 'POST') {
    if (!['admin', 'parent', 'therapist', 'school_team'].includes(auth.user.role)) { res.status(403).json({ error: 'Not allowed' }); return; }
    const b = (typeof req.body === 'object' && req.body) || {};
    const settings = (b.settings && typeof b.settings === 'object') ? b.settings : {};
    try {
      await db`
        INSERT INTO child_settings (child_id, settings, updated_at)
        VALUES (${childId}, ${JSON.stringify(settings)}::jsonb, NOW())
        ON CONFLICT (child_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Save failed', detail: String(err.message || err) }); }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

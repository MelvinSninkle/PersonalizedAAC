// POST /api/push-token { token, childId?, platform? } — store this device's APNs
// token, tagged with the signed-in user's role. Only parents are ever pushed,
// so the app should register only when the session role is parent/admin.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';

async function ensureTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS push_tokens (
      token TEXT PRIMARY KEY,
      child_id TEXT,
      role TEXT,
      platform TEXT DEFAULT 'ios',
      user_email TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE INDEX IF NOT EXISTS push_tokens_child_role_idx ON push_tokens(child_id, role)`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const token = typeof b.token === 'string' ? b.token.trim().slice(0, 200) : '';
  if (!token) { res.status(400).json({ error: 'token required' }); return; }
  const childId = (typeof b.childId === 'string' && b.childId ? b.childId : (auth.user.slug || '')).slice(0, 64) || null;
  const role = auth.user.role || 'parent';
  const platform = (typeof b.platform === 'string' ? b.platform : 'ios').slice(0, 20);

  try {
    const db = sql();
    await ensureTable(db);
    if (childId && !(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    await db`
      INSERT INTO push_tokens (token, child_id, role, platform, user_email, updated_at)
      VALUES (${token}, ${childId}, ${role}, ${platform}, ${auth.user.email || null}, NOW())
      ON CONFLICT (token) DO UPDATE SET child_id = EXCLUDED.child_id, role = EXCLUDED.role,
        user_email = EXCLUDED.user_email, updated_at = NOW()`;
    res.status(200).json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Register failed', detail: String(err.message || err) }); }
}

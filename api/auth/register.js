// POST /api/auth/register { email, password, role?, slug? } — create or update
// a user. Admin-only: requires a valid admin session OR the legacy ADMIN_TOKEN
// bearer. The bearer path is the bootstrap — it lets the very first admin
// account be created (and the table to be lazily made) before anyone can log in.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { hashPassword } from '../_lib/password.js';

const ROLES = new Set(['admin', 'parent', 'therapist']);

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
  const body = (typeof req.body === 'object' && req.body) || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = ROLES.has(body.role) ? body.role : 'parent';
  const slug = typeof body.slug === 'string' && body.slug ? body.slug.slice(0, 64) : null;
  if (!email || password.length < 8) {
    res.status(400).json({ error: 'Email and a password of at least 8 characters are required' });
    return;
  }
  try {
    const db = sql();
    // Lazily ensure the table exists so the first admin can be created without
    // having run /api/init first.
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
    const hash = hashPassword(password);
    const rows = await db`
      INSERT INTO users (email, password_hash, role, child_slug)
      VALUES (${email}, ${hash}, ${role}, ${slug})
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            child_slug = EXCLUDED.child_slug
      RETURNING id, email, role, child_slug
    `;
    res.status(200).json({ ok: true, user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Create failed', detail: String(err.message || err) });
  }
}

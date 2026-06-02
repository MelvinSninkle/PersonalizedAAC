// POST /api/auth/register { email, password, role?, slug?, inviteToken? }
// Two entry paths:
//   1. Admin-created: a signed-in admin (or the legacy ADMIN_TOKEN bearer)
//      creates or updates any user with any role. The bootstrap for the
//      very first admin is the legacy path.
//   2. Self-signup via invite: an anonymous visitor with a valid `inviteToken`
//      (HMAC-signed by /api/access/invite) creates their own account. The role
//      is forced to 'therapist' regardless of body; the email is forced to the
//      one in the invite. This is how a therapist invited by a parent gets an
//      account without an admin in the loop.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { hashPassword } from '../_lib/password.js';
import { signSession, serializeCookie, verifySession, SESSION_MAX_AGE } from '../../lib/session.js';

const ROLES = new Set(['admin', 'parent', 'therapist']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body = (typeof req.body === 'object' && req.body) || {};
  const password = typeof body.password === 'string' ? body.password : '';
  const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken : '';
  if (password.length < 8) {
    res.status(400).json({ error: 'A password of at least 8 characters is required' });
    return;
  }

  // Path 2 — invite-gated self-signup. Validate the token first; if it's good,
  // we DO NOT require admin auth (this is how a parent's invitee onboards).
  let invitePayload = null;
  if (inviteToken) {
    const secret = process.env.SESSION_SECRET;
    invitePayload = secret ? await verifySession(inviteToken, secret) : null;
    if (!invitePayload || invitePayload.kind !== 'invite' || !invitePayload.email) {
      res.status(400).json({ error: 'Invalid or expired invite token' }); return;
    }
  }

  let role, email, slug;
  if (invitePayload) {
    role = 'therapist';
    email = String(invitePayload.email || '').trim().toLowerCase();
    slug = null;            // therapist accounts aren't tied to one child slug
  } else {
    const auth = await checkAuth(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
    if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }
    role = ROLES.has(body.role) ? body.role : 'parent';
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    slug = typeof body.slug === 'string' && body.slug ? body.slug.slice(0, 64) : null;
  }
  if (!email) { res.status(400).json({ error: 'Email required' }); return; }

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
            role = CASE WHEN users.role = 'admin' THEN users.role ELSE EXCLUDED.role END,
            child_slug = COALESCE(EXCLUDED.child_slug, users.child_slug)
      RETURNING id, email, role, child_slug
    `;
    const user = rows[0];

    // Self-signup path: drop a session cookie so the very next request from
    // accept-invite.html can call /api/access/respond as the new user.
    if (invitePayload) {
      const secret = process.env.SESSION_SECRET;
      const exp = Date.now() + SESSION_MAX_AGE * 1000;
      const token = await signSession({ uid: Number(user.id), email: user.email, role: user.role, slug: user.child_slug, exp }, secret);
      res.setHeader('Set-Cookie', serializeCookie(token));
      try { await db`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`; } catch (_) {}
    }

    res.status(200).json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Create failed', detail: String(err.message || err) });
  }
}

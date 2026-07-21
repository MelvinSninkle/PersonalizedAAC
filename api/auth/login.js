// POST /api/auth/login { email, password } — verify credentials, set a signed
// session cookie. Public (no auth required to attempt a login).
import { timingSafeEqual } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { verifyPassword } from '../_lib/password.js';
import { signSession, serializeCookie, SESSION_MAX_AGE } from '../../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Login is not configured (SESSION_SECRET not set on the server).' });
    return;
  }
  const body = (typeof req.body === 'object' && req.body) || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }
  // Demo/test-board login (#14): the literal user ID "admin" plus the
  // Vercel-set ADMIN_TOKEN unlocks the native style-demo board. Validated
  // here only (the token is never in the client); NO session is minted,
  // because the demo board reads exclusively the public /api/demo +
  // public-prefix media, so a demo iPad handed to a therapist carries no
  // credentials. Real accounts can't collide: registration requires an
  // email address, and "admin" is not one.
  if (email === 'admin') {
    const adminToken = process.env.ADMIN_TOKEN || '';
    const a = Buffer.from(password), b = Buffer.from(adminToken);
    if (adminToken && a.length === b.length && timingSafeEqual(a, b)) {
      res.status(200).json({ ok: true, demo: true });
    } else {
      res.status(401).json({ error: 'Invalid email or password' });
    }
    return;
  }
  try {
    const db = sql();
    const rows = await db`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
    const user = rows[0];
    // Same generic message whether the email is unknown or the password is wrong.
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    const exp = Date.now() + SESSION_MAX_AGE * 1000;
    const token = await signSession(
      { uid: Number(user.id), email: user.email, role: user.role, slug: user.child_slug, exp },
      secret
    );
    res.setHeader('Set-Cookie', serializeCookie(token));
    try { await db`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`; } catch (_) {}
    res.status(200).json({ ok: true, user: { email: user.email, role: user.role, slug: user.child_slug } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', detail: String(err.message || err) });
  }
}

// POST /api/auth/login { email, password } — verify credentials, set a signed
// session cookie. Public (no auth required to attempt a login).
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

// POST /api/auth/reset-request { email } — start a password reset.
// Generates a one-hour token and stores it. Email delivery is wired later;
// for now an ADMIN caller gets the link back so it can be shared manually.
// Anonymous callers always get a generic { ok: true } (no account enumeration).
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { randomToken } from '../_lib/password.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body = (typeof req.body === 'object' && req.body) || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ error: 'Email required' });
    return;
  }
  try {
    const db = sql();
    const rows = await db`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
    let link = null;
    if (rows[0]) {
      const token = randomToken(24);
      await db`UPDATE users SET reset_token = ${token}, reset_expires = now() + interval '1 hour' WHERE id = ${rows[0].id}`;
      link = '/reset?token=' + token;
    }
    const auth = await checkAuth(req);
    const isAdmin = auth.ok && auth.user.role === 'admin';
    res.status(200).json({ ok: true, ...(isAdmin && link ? { resetUrl: link } : {}) });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

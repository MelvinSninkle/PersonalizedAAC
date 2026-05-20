// POST /api/auth/reset { token, password } — set a new password using a valid,
// unexpired reset token. Public (the token is the credential).
import { sql } from '../_lib/db.js';
import { hashPassword } from '../_lib/password.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body = (typeof req.body === 'object' && req.body) || {};
  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!token || password.length < 8) {
    res.status(400).json({ error: 'A reset token and a password of at least 8 characters are required' });
    return;
  }
  try {
    const db = sql();
    const rows = await db`SELECT id FROM users WHERE reset_token = ${token} AND reset_expires > now() LIMIT 1`;
    if (!rows[0]) {
      res.status(400).json({ error: 'This reset link is invalid or has expired.' });
      return;
    }
    const hash = hashPassword(password);
    await db`UPDATE users SET password_hash = ${hash}, reset_token = NULL, reset_expires = NULL WHERE id = ${rows[0].id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed', detail: String(err.message || err) });
  }
}

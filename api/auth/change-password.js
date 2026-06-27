// POST /api/auth/change-password { currentPassword, newPassword }
// Logged-in password change. Verifies the current password, then sets the new
// one and clears any outstanding reset token. Auth required (cookie or bearer).
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { hashPassword, verifyPassword } from '../_lib/password.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const body = (typeof req.body === 'object' && req.body) || {};
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (next.length < 8) { res.status(400).json({ error: 'New password must be at least 8 characters' }); return; }

  try {
    const db = sql();
    const uid = Number(auth.user.uid || auth.user.id);
    if (!uid) { res.status(400).json({ error: 'No account on this session' }); return; }
    const rows = await db`SELECT password_hash FROM users WHERE id = ${uid} LIMIT 1`;
    if (!rows[0]) { res.status(404).json({ error: 'Account not found' }); return; }
    if (!verifyPassword(current, rows[0].password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect' }); return;
    }
    const hash = hashPassword(next);
    await db`UPDATE users SET password_hash = ${hash}, reset_token = NULL, reset_expires = NULL WHERE id = ${uid}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Change failed', detail: String(err.message || err) });
  }
}

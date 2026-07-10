// POST /api/auth/change-password { currentPassword, newPassword }
//   or { currentPassword, newEmail } — same verify-then-update flow changes
//   the account email instead (kept in this function to stay under Vercel's
//   route budget; both are "prove the current password, change a credential").
// Verifies the current password, then sets the new credential and clears any
// outstanding reset token. Auth required (cookie or bearer).
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
  const newEmail = typeof body.newEmail === 'string' ? body.newEmail.trim().toLowerCase() : '';
  if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    res.status(400).json({ error: 'That does not look like an email address' }); return;
  }
  if (!newEmail && next.length < 8) { res.status(400).json({ error: 'New password must be at least 8 characters' }); return; }

  try {
    const db = sql();
    const uid = Number(auth.user.uid || auth.user.id);
    if (!uid) { res.status(400).json({ error: 'No account on this session' }); return; }
    const rows = await db`SELECT password_hash FROM users WHERE id = ${uid} LIMIT 1`;
    if (!rows[0]) { res.status(404).json({ error: 'Account not found' }); return; }
    if (!verifyPassword(current, rows[0].password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect' }); return;
    }
    if (newEmail) {
      const taken = await db`SELECT id FROM users WHERE email = ${newEmail} AND id <> ${uid} LIMIT 1`;
      if (taken.length) { res.status(409).json({ error: 'That email is already in use' }); return; }
      await db`UPDATE users SET email = ${newEmail}, reset_token = NULL, reset_expires = NULL WHERE id = ${uid}`;
      res.status(200).json({ ok: true, email: newEmail });
      return;
    }
    const hash = hashPassword(next);
    await db`UPDATE users SET password_hash = ${hash}, reset_token = NULL, reset_expires = NULL WHERE id = ${uid}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Change failed', detail: String(err.message || err) });
  }
}

// POST /api/auth/reset-request { email } — start a password reset.
// Generates a one-hour token, stores it, and emails the reset link (best-effort
// via Resend). An ADMIN caller also gets the link back for manual sharing.
// Anonymous callers always get a generic { ok: true } (no account enumeration).
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { randomToken } from '../_lib/password.js';
import { sendEmail, emailConfigured, escapeHtml } from '../_lib/email.js';

function appUrl() {
  return process.env.APP_URL || process.env.PUBLIC_URL || 'https://aac.andrewpeterson.io';
}

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
      // Email the link (best-effort — the stored token is the source of truth).
      if (emailConfigured()) {
        const url = appUrl() + link;
        const html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px;">
            <h2 style="color:#ad1457;margin:0 0 12px;font-family:'Fredoka',system-ui;">Reset your My World password</h2>
            <p>We got a request to reset the password for this account. Click below to choose a new one — the link expires in 1 hour.</p>
            <p style="margin:22px 0;">
              <a href="${escapeHtml(url)}" style="display:inline-block;background:#ff1493;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px;">Choose a new password →</a>
            </p>
            <p style="font-size:12px;color:#6b7280;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
          </div>`;
        try { await sendEmail({ to: email, subject: 'Reset your My World password', html }); } catch (_) {}
      }
    }
    const auth = await checkAuth(req);
    const isAdmin = auth.ok && auth.user.role === 'admin';
    res.status(200).json({ ok: true, ...(isAdmin && link ? { resetUrl: link } : {}) });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

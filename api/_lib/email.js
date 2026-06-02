// Minimal Resend wrapper. One POST → /emails. Returns { ok, id?, error? }.
// Env vars required:
//   RESEND_API_KEY      — Resend API key (no SDK; we just POST)
//   INVITE_FROM_EMAIL   — From address, e.g. 'My World <hello@aac.andrewpeterson.io>'
//                          (must be from a verified Resend domain)
// Failures never throw — callers can still proceed (the invite row is the
// source of truth; the email is best-effort).
const ENDPOINT = 'https://api.resend.com/emails';

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY && !!process.env.INVITE_FROM_EMAIL;
}

export async function sendEmail({ to, subject, html, text }) {
  if (!emailConfigured()) return { ok: false, error: 'email not configured' };
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.INVITE_FROM_EMAIL,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text: text || stripHtml(html),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data.message || data.error || ('HTTP ' + r.status) };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

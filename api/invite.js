// POST /api/invite { code } — the private-preview gate. If the code matches the
// INVITE_CODE env var, set a signed `mw_invite` cookie so the edge middleware
// lets this device through for 30 days. Gate is OFF unless INVITE_CODE is set.
import { signSession, SESSION_MAX_AGE } from '../lib/session.js';

const INVITE_COOKIE = 'mw_invite';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const secret = process.env.SESSION_SECRET;
  const expected = process.env.INVITE_CODE;
  if (!secret) { res.status(500).json({ error: 'SESSION_SECRET not set' }); return; }
  if (!expected) { res.status(200).json({ ok: true, note: 'Invite gate disabled' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const code = typeof b.code === 'string' ? b.code.trim() : '';
  if (!code || code !== expected) { res.status(401).json({ error: 'Invalid invite code' }); return; }

  const token = await signSession({ inv: true, exp: Date.now() + SESSION_MAX_AGE * 1000 }, secret);
  const cookie = [
    `${INVITE_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure',
    `Max-Age=${SESSION_MAX_AGE}`,
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
}

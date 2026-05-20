// POST /api/auth/logout — clear the session cookie.
import { serializeCookie } from '../../lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', serializeCookie('', { clear: true }));
  res.status(200).json({ ok: true });
}

// GET /api/auth/me — return the current user (from session cookie or bearer).
import { checkAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ user: auth.user });
}

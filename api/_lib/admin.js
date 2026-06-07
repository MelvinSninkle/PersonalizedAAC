// Admin-only gate used by /api/admin/* endpoints. Wraps checkAuth and rejects
// anything that isn't role='admin' (or the legacy bearer-token admin).
// Returns { ok: true, user, email } on success, otherwise sends 401/403 and
// returns { ok: false }. Use like:
//   const gate = await requireAdmin(req, res); if (!gate.ok) return;
import { checkAuth } from './auth.js';

export async function requireAdmin(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status || 401).json({ error: auth.error || 'Unauthorized' });
    return { ok: false };
  }
  const role = auth.user?.role || 'parent';
  if (role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin role required' });
    return { ok: false };
  }
  return { ok: true, user: auth.user, email: auth.user?.email || 'admin' };
}

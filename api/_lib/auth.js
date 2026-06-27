// Auth check shared across all API routes. Accepts EITHER:
//   1. A valid signed session cookie (real user accounts), or
//   2. The legacy ADMIN_TOKEN bearer header (backward compatible, admin-level).
// Returns { ok: true, user } on success, otherwise { ok: false, status, error }.
// `user` = { id?, email?, role, slug? }. Bearer-token callers are treated as admin.
import { verifySession, parseCookies, cookieName } from '../../lib/session.js';

export async function checkAuth(req) {
  const secret = process.env.SESSION_SECRET;
  const adminToken = process.env.ADMIN_TOKEN;

  // 1) Session cookie
  if (secret) {
    const cookies = parseCookies(req.headers.cookie || '');
    const tok = cookies[cookieName()];
    if (tok) {
      const s = await verifySession(tok, secret);
      // Expose both `uid` and `id` (same value) — callers use either name.
      if (s) return { ok: true, user: { uid: s.uid, id: s.uid, email: s.email, role: s.role || 'parent', slug: s.slug || null } };
    }
  }

  // 2) Legacy admin bearer token
  const authz = req.headers.authorization || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (adminToken && bearer && bearer === adminToken) {
    return { ok: true, user: { role: 'admin', legacy: true } };
  }

  if (!secret && !adminToken) {
    return { ok: false, status: 500, error: 'Auth not configured (set SESSION_SECRET)' };
  }
  return { ok: false, status: 401, error: 'Unauthorized' };
}

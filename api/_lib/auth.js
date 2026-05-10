// Bearer-token auth check shared across all API routes.
// Returns { ok: true } on success, otherwise { ok: false, status, error }.
export function checkAuth(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return { ok: false, status: 500, error: 'ADMIN_TOKEN env var not set' };
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token !== expected) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

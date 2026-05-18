// Vercel Edge Middleware — site-wide HTTP Basic Auth while the preview is
// private. Set SITE_PASSWORD on the Vercel project env to enable it.
//
// /api/* is intentionally excluded. The API endpoints already have their own
// admin-bearer-token gate, and basic auth would collide with their
// Authorization header (the browser caches Basic creds, but our fetch() calls
// set Authorization: Bearer explicitly — only one wins). Keeping the API
// outside this gate lets the iPad's bearer-authenticated calls keep working
// unchanged.

export const config = {
  // Match everything except /api/*, favicon, robots.
  matcher: ['/((?!api/|favicon\\.ico|robots\\.txt).*)'],
};

export default function middleware(req) {
  const expected = process.env.SITE_PASSWORD;
  // Fail closed if not configured — better than accidentally shipping a public
  // preview because someone forgot to set the env var.
  if (!expected) {
    return new Response('Preview gate misconfigured: SITE_PASSWORD env var not set on Vercel.', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(':');
      const pass = sep < 0 ? decoded : decoded.slice(sep + 1);
      if (pass === expected) return;   // pass through to the static asset / function
    } catch (_) { /* fall through */ }
  }
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="My World — preview"',
      'content-type': 'text/plain',
    },
  });
}

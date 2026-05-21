// Vercel Edge Middleware — gates every page behind a real login session.
// A valid signed `mw_session` cookie (issued by /api/auth/login) lets the
// request through; anything else is redirected to /login. This replaced the
// old site-wide HTTP Basic Auth.
//
// /api/* is excluded (the API does its own auth and must stay reachable for
// login itself), as are /login, /reset, and the PWA assets (manifest, service
// worker, icons) so the installed app and Add-to-Home-Screen work cleanly.
import { verifySession, parseCookies, cookieName } from './lib/session.js';

export const config = {
  matcher: ['/((?!api/|login|reset|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|sw\\.js|icons/|audio/).*)'],
};

export default async function middleware(req) {
  const secret = process.env.SESSION_SECRET;
  // Fail closed if not configured — better than accidentally exposing content.
  if (!secret) {
    return new Response('Login gate misconfigured: SESSION_SECRET env var not set on Vercel.', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }

  const cookies = parseCookies(req.headers.get('cookie') || '');
  const token = cookies[cookieName()];
  const session = token ? await verifySession(token, secret) : null;
  if (session) return; // authenticated → pass through

  const url = new URL(req.url);
  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, { status: 302, headers: { Location: `/login?next=${next}` } });
}

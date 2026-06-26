// Vercel Edge Middleware — two layers of gating:
//
//   1. Private-preview invite gate. Visitors who are NOT logged in must first
//      present a valid signed `mw_invite` cookie (issued by /api/invite after
//      they type a code on /welcome). The codes are managed from the admin and
//      stored in the DB; this middleware only verifies the signed cookie, so it
//      never touches the DB. A logged-in session bypasses the gate entirely —
//      that's also how the admin gets in to create the first codes.
//
//   2. Login session. Once past the gate, the home/landing page (`/`) is public
//      so we can point everyone there; the app, dashboards, admin and onboarding
//      still require a valid `mw_session` cookie → /login otherwise.
//
// /api/*, /login, /reset, /welcome and the static/PWA assets are excluded from
// the matcher entirely so the gate pages, login and Add-to-Home-Screen work.
import { verifySession, parseCookies, cookieName } from './lib/session.js';

const INVITE_COOKIE = 'mw_invite';

export const config = {
  matcher: ['/((?!api/|login|reset|welcome|accept-invite|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|sw\\.js|icons/|audio/|styles/).*)'],
};

// Fully public — viewable with no invite code and no login. The marketing
// home/benefits page so /welcome, /login and emails can all point people here.
function isPublicPage(pathname) {
  return pathname === '/' || pathname === '/index.html';
}
// Reachable once past the invite gate but WITHOUT a login session: self-service
// account creation. An invited visitor has no account yet, so bouncing them to
// /login here is the bug — they need to be able to reach /signup.
function isInviteGatedNoAuthPage(pathname) {
  return pathname === '/signup' || pathname === '/signup.html';
}

export default async function middleware(req) {
  const secret = process.env.SESSION_SECRET;
  // Fail closed if not configured — better than accidentally exposing content.
  if (!secret) {
    return new Response('Login gate misconfigured: SESSION_SECRET env var not set on Vercel.', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }

  const url = new URL(req.url);
  const cookies = parseCookies(req.headers.get('cookie') || '');

  // Logged-in users bypass the invite gate entirely (and reach the admin to
  // create codes, so the gate can never lock everyone out).
  const token = cookies[cookieName()];
  const session = token ? await verifySession(token, secret) : null;
  if (session) return;

  // The marketing home is public even without an invite code, so the gate and
  // login pages (and emails) can always send people to the benefits page.
  if (isPublicPage(url.pathname)) return;

  // Anonymous visitors must clear the private-preview invite gate first.
  const invToken = cookies[INVITE_COOKIE];
  const invite = invToken ? await verifySession(invToken, secret) : null;
  if (!invite || !invite.inv) {
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, { status: 302, headers: { Location: `/welcome?next=${next}` } });
  }

  // Past the gate but not logged in: self-service signup is allowed (no account
  // exists yet). Everything else still needs a real login session.
  if (isInviteGatedNoAuthPage(url.pathname)) return;

  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, { status: 302, headers: { Location: `/login?next=${next}` } });
}

// Vercel Edge Middleware — two layers of gating:
//
//   1. Private-preview invite gate. Visitors who are NOT logged in must first
//      present a valid signed `mw_invite` cookie (issued by /api/invite after
//      they type a code on /welcome). The codes are managed from the admin and
//      stored in the DB; this middleware only verifies the signed cookie, so it
//      never touches the DB. A logged-in session bypasses the gate entirely —
//      that's also how the admin gets in to create the first codes.
//
//   2. Login session. The public funnel (`/`, `/practice`, `/signup`) needs
//      neither cookie — the invite code is enforced inside account creation
//      (api/auth/register.js) instead of at the page. The app, dashboards,
//      admin and onboarding still require a valid `mw_session` cookie →
//      /login otherwise.
//
// /api/*, /login, /reset, /welcome and the static/PWA assets are excluded from
// the matcher entirely so the gate pages, login and Add-to-Home-Screen work.
import { verifySession, parseCookies, cookieName } from './lib/session.js';

const INVITE_COOKIE = 'mw_invite';

export const config = {
  matcher: ['/((?!api/|login|reset|welcome|accept-invite|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|sw\\.js|icons/|audio/|styles/).*)'],
};

// Fully public — viewable with no invite code and no login: the marketing
// home/benefits page, the practice board (the "try it live" demo — strictly
// read-only, see practice.html), and the signup page. Signup is public so the
// funnel flows landing → practice → signup without a wall; the invite code is
// REQUIRED inline at account creation instead (api/auth/register.js accepts a
// typed code or the mw_invite cookie an invite link set). Everything else
// stays behind the /welcome gate.
function isPublicPage(pathname) {
  return pathname === '/' || pathname === '/index.html'
    || pathname === '/practice' || pathname === '/practice.html'
    || pathname === '/signup' || pathname === '/signup.html';
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

  // The public funnel (home, practice board, signup) needs no invite cookie —
  // account creation itself enforces the code (see isPublicPage above).
  if (isPublicPage(url.pathname)) return;

  // Anonymous visitors must clear the private-preview invite gate first.
  const invToken = cookies[INVITE_COOKIE];
  const invite = invToken ? await verifySession(invToken, secret) : null;
  if (!invite || !invite.inv) {
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, { status: 302, headers: { Location: `/welcome?next=${next}` } });
  }

  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, { status: 302, headers: { Location: `/login?next=${next}` } });
}

// Vercel Edge Middleware — two layers of gating:
//
//   1. Private-preview invite gate. When INVITE_CODE is set, every page first
//      requires a valid signed `mw_invite` cookie (issued by /api/invite after
//      the visitor types the invite code on /welcome). No cookie → /welcome.
//      If INVITE_CODE is unset the gate is off, so nobody gets locked out.
//
//   2. Login session. The home/landing page (`/`) is public so we can point
//      everyone there; the app, dashboards, admin and onboarding still require a
//      valid `mw_session` cookie (issued by /api/auth/login) → /login otherwise.
//
// /api/*, /login, /reset, /welcome and the static/PWA assets are excluded from
// the matcher entirely so the gate pages, login and Add-to-Home-Screen work.
import { verifySession, parseCookies, cookieName } from './lib/session.js';

const INVITE_COOKIE = 'mw_invite';

export const config = {
  matcher: ['/((?!api/|login|reset|welcome|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|sw\\.js|icons/|audio/|styles/).*)'],
};

function isPublicPage(pathname) {
  return pathname === '/' || pathname === '/index.html';
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

  // 1) Invite gate (only enforced when INVITE_CODE is configured).
  if (process.env.INVITE_CODE) {
    const invToken = cookies[INVITE_COOKIE];
    const invite = invToken ? await verifySession(invToken, secret) : null;
    if (!invite || !invite.inv) {
      const next = encodeURIComponent(url.pathname + url.search);
      return new Response(null, { status: 302, headers: { Location: `/welcome?next=${next}` } });
    }
  }

  // 2) The home/landing page is public — send everyone here.
  if (isPublicPage(url.pathname)) return;

  // 3) Everything else needs a real login session.
  const token = cookies[cookieName()];
  const session = token ? await verifySession(token, secret) : null;
  if (session) return; // authenticated → pass through

  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, { status: 302, headers: { Location: `/login?next=${next}` } });
}

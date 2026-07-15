# Domain flip: aac.andrewpeterson.io → myworldtaptotalk.com

## Phase 0 — ADDITIVE mode (both domains serve; done first, zero code)

The safe first step: attach the new domain so BOTH hosts serve the same
deployment as duplicates. No redirects, no code changes — every hardcoded
aac.andrewpeterson.io reference (native app origins, email links, reset
URLs) keeps working untouched.

1. Vercel → Project → Settings → Domains → Add: the apex
   (myworldtaptotalk.com) and www.myworldtaptotalk.com.
2. At the registrar, follow Vercel's shown DNS instructions — either point
   the domain's nameservers at Vercel (easiest), or add records:
   apex `A → 76.76.21.21`, www `CNAME → cname.vercel-dns.com`.
3. In the Domains list, set www to "Redirect to myworldtaptotalk.com"
   (within-brand redirect is fine) and make sure aac.andrewpeterson.io is
   set to SERVE, not redirect — that's the dupe behavior.
4. Wait for the ✓ (DNS + auto-TLS, usually minutes) and load /practice,
   /signup, and a parent login on the new host.

Gotchas in additive mode:
- Cookies are per-host: a parent signed in on the old domain signs in once
  on the new one. Nothing is lost — same account, same board.
- Emails, password resets, Stripe webhooks, and the native apps still say/
  use aac.andrewpeterson.io — correct until Phase 1 below.
- Duplicate content SEO is a non-issue pre-launch; the full flip adds the
  301s.

## Phase 1 — the real flip (later, one commit + env change)

Do this ONCE, in one commit + one env change, after Phase 0 is verified.

## The hardcoded sites (verify with grep before AND after)

    grep -rn "aac.andrewpeterson.io" --include='*.js' --include='*.html' \
        --include='*.swift' --include='*.kt' . | grep -v node_modules

Expected hits to change:
1. iOS `kid-ios/MyWorld/Network/APIClient.swift` — defaultOrigin.
2. Android `net/ApiClient.kt` — ORIGIN.
3. `api/_lib/email.js` — link base for transactional emails.
4. Fallback URLs in `api/auth/register.js` / reset / invite flows
   (APP_URL/PUBLIC_URL fallbacks).
5. HeaderBar therapist pill link (iOS) — `https://aac.andrewpeterson.io/therapist/…`.
6. Any docs/marketing references.

## Also

- Vercel env: set `APP_URL` / `PUBLIC_URL` to https://myworldtaptotalk.com.
- Resend: the sending domain must be myworldtaptotalk.com (verified) and
  `INVITE_FROM_EMAIL` something like hello@myworldtaptotalk.com.
- Stripe webhook endpoint URL → new domain (add a second endpoint first,
  then remove the old after confirming deliveries).
- Apple: Associated domains / Sign in with Apple return URLs if configured.
- Keep the old domain serving 301s for a while (Vercel keeps both domains
  attached; make the new one primary).

## After

- Native apps need a release (the origin is compiled in) — coordinate the
  commit with an app build so testers don't sit on a dead origin. The old
  origin keeps working through Vercel until you remove it, so this is not
  time-critical.
- Run CI + the surface audit; grep again to confirm zero stale references.

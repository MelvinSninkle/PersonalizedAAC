# Domain flip: aac.andrewpeterson.io → myworldtaptotalk.com

Do this ONCE, in one commit + one env change, after the domain is attached
to the Vercel project (Vercel → Settings → Domains → add
myworldtaptotalk.com and www; follow the DNS instructions at the registrar).

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

# Incident triage — where to look first

Start at **admin/reports.html** (sync heartbeats, last logins, purchases vs
fulfillment) — it exists precisely so you don't guess. Then:

## "The board is blank / not updating"

1. reports → sync health: is the device pinging? If the device pings but
   content is stale, it's client cache → board Reload-from-server (edit
   mode), or app relaunch.
2. Hit `/api/sync?childId=<slug>` as yourself (admin) — 200 with items?
   - 500: check Vercel function logs; commonest cause is a migration-order
     issue → confirm `api/init.js` ran (hit any endpoint) and the failing
     query has its pre-migration fallback.
3. Empty board for a NEW family = seeding stalled → next section.

## "Images aren't generating / build is stuck"

1. Onboarding banner stuck at N of M for >30 min → seed jobs dead.
2. Lab board-state / seed tools: dead jobs (failed with no retries) —
   re-arm via the rescue tool.
3. Vercel logs for `cron/run-tile-jobs` — the every-minute drainer. If the
   cron isn't firing at all: Vercel → Settings → Cron Jobs (and CRON_SECRET
   mismatch shows as 401s).
4. Model-side failures (OpenAI/Gemini quota, content flags) appear in the
   job `error` column and `image_generations` log. Daily cap:
   `IMAGE_GEN_DAILY_LIMIT`.
5. **"Everything says done but core/verbs tiles are blank"** — the board was
   wiped or re-placed AFTER a successful build: items came back artless while
   seed_jobs still read done, and done jobs never re-run (dedup by
   child+kind+taxonomy). The taxonomy page's Build board now detects this and
   re-opens done render jobs whose tile has no art (and voice jobs with no
   audio) — the dialog reports "re-opened N art-less renders". If it reports
   0 re-opened and the board is still blank, the items' `taxonomy_slug`
   linkage is the next suspect. Only Needs/Core/Verbs get per-child renders
   (`isRenderScope`); object tiles show shared defaults via sync, which is
   why a broken board looks fine EXCEPT core+verbs.

## "No sound / wrong voice"

1. One tile vs everything? One tile → its sound_key missing; re-voice from
   the tile editor or push sounds (Lab → Publish).
2. Everything, runtime TTS also silent → ElevenLabs: env key
   `Fletchers_AAC_Device` valid? Account quota?
3. Wrong VOICE → child_settings.voiceId; check the voice still exists and
   is active in admin/voices.html; non-English voices only serve testers.
4. Wrong LANGUAGE audio → the tile clips predate a language change: push
   sounds to the child.

## "Purchase didn't grant credits / membership"

1. reports → purchases vs fulfillment: rows marked FAILED/STUCK.
2. Stripe: webhook delivery log (Developers → Webhooks) — 4xx/5xx from our
   endpoint means `STRIPE_WEBHOOK_SECRET` mismatch or a deploy-time error.
3. Google Play: verify-before-consume means an unconsumed purchase re-grants
   on next app open — usually self-heals; check ApiShop logs otherwise.

## "A family says they can see something that isn't theirs"

Treat as a P0. Capture the exact URL/key, then run the media isolation
checks (surface-audit skill section A) and check `api/media.js` ownership
union + the endpoint that returned the data. The public whitelist
(taxonomy-defaults/, category-defaults/, style-defaults/, demo-audio/) is
generic library art — confirm what they saw is actually child content
before escalating internally.

## "Emails not arriving"

Resend dashboard → domain must be VERIFIED (DNS records at the registrar,
not just an API key in Vercel). `RESEND_API_KEY` + `INVITE_FROM_EMAIL` env
vars; from-address domain must match the verified domain.

## Push notifications silent

APNs env quartet (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`,
`APNS_BUNDLE_ID`); tokens in `push_tokens`; milestones respect the
`milestonesPush === false` opt-out — that's a setting, not a bug.

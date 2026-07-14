# My World: Tap to Talk — Owner's Manual

The operating map for the whole product. Written for the owner (Andrew) and
for any future engineer or AI assistant who needs to work on this without
the original build context. Detailed how-tos live in `docs/runbooks/`;
mechanical safety invariants live in `.claude/skills/surface-audit/SKILL.md`
(and run as CI, see below). Content/vocabulary conventions live in
`.claude/skills/update-taxonomy/SKILL.md` and
`.claude/skills/aac-prompt-author/SKILL.md`. The release walk-order
(pre-merge gate → deploy → production smoke → TestFlight/Play + launch
gates) is `.claude/skills/release/SKILL.md`; conventions for any new or
changed server route are `.claude/skills/new-endpoint/SKILL.md`.

## What this product is

A personalized AAC (augmentative/alternative communication) board for
nonverbal children. The core bet: a child recognizes THEIR OWN world — their
people, foods, toys, home — so every tile's art is generated for that child
in a family-chosen style, and every tile speaks in a family-chosen voice.
Reference child: Fletcher. Legal entity: My World Tap to Talk LLC.
Domain: myworldtaptotalk.com · support@myworldtaptotalk.com.

## The surfaces

| Surface | File / target | Who |
|---|---|---|
| Kid board (web) | app.html (`/u/<slug>`) | child |
| Kid board (iPad) | kid-ios/ (XcodeGen → Xcode) | child |
| Kid board (Android/Fire) | android-native/ | child |
| Parent dashboard | parent.html (`/parent/<slug>`) — 5 tabs | parent |
| Onboarding | onboard.html (signup → style → people → scene → board build) | parent |
| Therapist console | therapist*.html | therapist role |
| Store | store.html (+ native IAP) | parent |
| **Public practice board** | practice.html (`/practice`) — the ONLY unauthenticated surface | prospects |
| Landing | index.html | public |
| Admin Lab | admin/*.html (taxonomy, defaults, publish, voices, reports, …) | admin only |

## Architecture in one paragraph

Vercel serverless (ESM) + Neon Postgres + Vercel Blob (private) + OpenAI /
Gemini for image gen + ElevenLabs for TTS + Resend for email + Stripe /
Google Play for billing + APNs for push. Every endpoint self-gates
(`checkAuth`, `canAccessChild`, `requireAdmin`). The board syncs through
`/api/sync`, which resolves per-child data + shared defaults at READ time
(style defaults → generic defaults → word tiles). Migrations run inline in
`api/init.js` (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`);
endpoints reading new columns carry pre-migration fallback queries.

## Non-negotiable invariants (the "why" behind CI)

1. **Family isolation** — one family's media/data must never reach another.
   Enforced per-endpoint + `api/media.js`'s ownership union. CI greps it.
2. **English labels are identity** — translations are a display/audio layer
   (`displayLabel` at sync time); nothing rewrites `label` columns except
   the four whitelisted parent/admin edit paths.
3. **The Vercel 100-function ceiling** — ~88 routed functions live in api/.
   New admin capability goes behind `api/admin/lab.js?action=` as an
   `_`-prefixed file (not counted). CI warns at 96.
4. **No public spend paths** — the practice board pre-renders its audio;
   there is no unauthenticated TTS/image-gen route, ever.
5. **TTS cache-key lockstep** — three sites build the same sha256 key
   (tts.js, synthesizeVoice, publish pushSounds). Change all or none.

## Roles & gating

- `admin` (Andrew) — everything; Lab; access experiments; tier simulator.
- `parent` — their children only.
- `therapist` / `school_team` — invited via child_access.
- `language_tester` — may change board language (dark launch).
- Pre-authorized signups: `role_grants` (Lab → Reports → Accounts) applies
  at BOTH signup paths; `admin` is never grantable.

## Dark-launched features (admin-only while testing)

- **Board languages** (en/zh/es/fr/pt/de): dictionaries in `api/_lib/i18n/`,
  seeded via Lab → Translations, tester loop = CSV export → native review →
  import. Non-English art renders with no baked text.
- **Access experiments** (parent dashboard → Access panel, admin-only):
  `navMode` buttons paging (eye tracker), `sentenceBuilder` (+`sentenceLift`
  hold/drag, `sentenceIdleMin`; staging is silent — ▶ speaks, ✕ clears),
  `listenRepeatNav` (say a word twice → board jumps to the tile).
  Implemented on web + iOS + Android.

## Parent-set controls (NOT dark-launched — every parent has these)

All synced child settings (root keys, deliberately outside the admin
ACCESS_KEYS gate), set from parent dashboard → Board tab (themed accordions)
→ Touch & safety; the kid apps pick them up on launch/refresh:

- `tapInterrupt` — a tap during playback cuts the word off (default OFF so a
  stimming child hears each word complete).
- `doubleTapTeach` — same tile twice within 2.5s speaks its teaching facts
  (English boards only; clues are English prose).
- `easyClose` — game ✕ closes on a quick tap instead of the 1.2s hold.
- `easyUnlock` — the board lock opens edit mode without the password.
  ENABLING re-verifies the account password behind a strong warning (both
  UIs); disabling is friction-free. See surface-audit E6b before touching.
- `toolListen` / `toolTeach` / `toolPlay` / `toolSentence` — header tool
  visibility per child (Board → Board tools; default ON).
- `sentenceDrag` — drag a tile up to the header bar to stage it (default
  OFF; **native apps only** — web keeps the pencil, because the web gesture
  required killing touch scroll). Additive to the pencil and needs the
  admin-gated `sentenceBuilder`; works during normal scroll-mode use.

## Money

Stripe (web) + Google Play billing (Android; verify-before-consume) +
`credits` for image generation. Reports: admin/reports.html (purchases vs
fulfillment, logins, sync health, spend guard). Stripe is in TEST mode until
the LLC bank account clears — see runbooks/stripe-go-live.md.
Subscription credits grant on `invoice.paid` with a `stripe_customer_id`
fallback (an unattributable invoice logs `stripe invoice.paid UNRESOLVED` in
Vercel — investigate immediately: someone paid and got nothing). Failed
renewals email the parent; cancellations stamp `users.sub_canceled_at`.
**Spend guard**: ≥400 credits/hr or ≥800/day auto-pauses an account's spends
(≥200/hr is flagged for review); unblock in Reports → Spend guard. A paused
family keeps everything they have — only new spends wait.

## The pipelines

- **Board build**: onboard places words instantly (chunked `seed-core`),
  then durable `seed_jobs` (render/voice/chip) drain via the every-minute
  cron `run-tile-jobs`. Progress = `seedStatus` (also feeds the onboarding
  "magic gallery"). Stuck builds: Lab tools re-arm dead jobs.
- **Image generation**: `buildPortraitPrompt`/`renderTaxonomyTile` — single
  prompt source; style guides + child anchor photo; `IMAGE_GEN_DAILY_LIMIT`.
  Each style carries up to three reference images (main anchor `blob_key`,
  people `person_ref_key`, objects `stuff_ref_key`); renders attach the
  subject-matched one automatically. Parents see/switch/replace them in
  dashboard → Art style (`/api/parent/style`; uploads fork a child-scoped
  "Your family style" row — public template rows are never edited).
  Every image-add surface asks keep-exact-photo vs draw-in-board-style
  (default: board style; free tier locks to exact) — NO per-image style or
  model pickers exist, and `?styleGuideId=`/`?model=` overrides on
  generate-image + tile-jobs are admin-only. See surface-audit C8.
  Curated defaults can bypass prompts: defaults view 📤 → `default-upload`
  lab action (writes ONLY the shared default layers; sync overlays every
  replaceable tile, never family art). Every image swap archives the old key
  to `item_image_history`; the tile editor's "Previous pictures" strip
  reverts from it (keys contained to the tile's own history).
  Tile shape: family surfaces always produce square tiles (Adjust framing
  picks the crop) — the old keep-original-ratio toggle is retired. The
  stored `keep_aspect` flag still renders uncropped on all three apps and
  stays settable via Lab's ⬜ Square-tiles tool (TV/movie posters).
- **Game scoring**: sessions need ≥3 answers to enter weekly accuracy or
  spike baselines; shorter ones are recorded but annotated "too short to
  score" (analytics.js / spike.js).
- **Audio**: recorded clip per tile (child's chosen voice) with shared
  render cache; runtime TTS through `/api/tts` (triple-guarded).
- **Milestones**: detected inline on `/api/events` (pivot-grammar frames);
  push respects opt-out; keepsakes in parent Home → Moments.
- **Auto-Teach**: scheduled exposure slideshows/games from onboarding prefs.

## CI, backups, audits

- `.github/workflows/ci.yml`: syntax gates + surface-audit invariant greps +
  Playwright smoke (board access features + practice board) on every push.
- `.github/workflows/backup.yml`: nightly pg_dump artifact (needs the
  `BACKUP_DATABASE_URL` secret — see runbooks/backup-restore.md).
- Run the full audit anytime by invoking the `surface-audit` skill, or
  locally: `bash tools/surface-audit/invariants.sh` + the two smoke suites
  against `tools/surface-audit/stub_server.py`.

## Runbooks

- runbooks/tester-family-onboarding.md — invite → role grant → language →
  voices → verify.
- runbooks/release.md — web (Vercel), iOS (TestFlight, hard-won notes),
  Android.
- runbooks/incident-triage.md — sync/images/TTS/credits failures → where to
  look first.
- runbooks/domain-flip.md — moving off aac.andrewpeterson.io (6 hardcoded
  sites).
- runbooks/stripe-go-live.md — test → live.
- runbooks/backup-restore.md — dumps, blob inventory, restores.

## Known open items (as of 2026-07-12)

- `[BUSINESS ADDRESS]` placeholder in privacy.html — needs the LLC address.
- Domain flip pending myworldtaptotalk.com being attached to Vercel.
- Stripe live keys pending LLC bank approval.
- iOS build verified on-device 2026-07-12 (access features + touch controls
  exercised on the web board); the Android build and the native language
  pickers still await a human test pass (mechanically verified only).
- Founder letter in onboard.html Phase 4 is a draft in Andrew's voice —
  edit freely; the support email link is live.
- Demo audio for /practice must be built once: Lab → `action=demo-audio`
  (POST op=build with 2–3 catalog voiceIds; resumable).

---
name: release
description: >-
  Ship My World Tap to Talk: merge-to-main web deploys, iOS TestFlight,
  Android/Fire builds. Use whenever a task is "deploy", "release", "ship",
  "merge to main", "push to TestFlight/Play", "get this live", or after a
  merge when verifying production. Walks the pre-merge gate, the deploy, the
  post-deploy production smoke, both native release cycles, and the one-time
  launch gates — with the standing gotchas (crons, Stripe webhooks, backups,
  stale archives) as explicit checklist items so nothing ships half-armed.
---

# Release

Three surfaces release on three different rhythms: **web/server** deploys the
moment `main` moves (Vercel Git integration — merging IS deploying), **iOS**
goes through TestFlight/App Store review, **Android/Fire** builds locally in
Android Studio. A feature isn't "live" until every surface that renders it has
shipped — server-side changes (api/, defaults, style pipeline) reach native
apps immediately, but Swift/Kotlin changes need a rebuild.

Deep detail lives in `docs/runbooks/release.md` (and `stripe-go-live.md`,
`domain-flip.md`, `backup-restore.md`). This skill is the walk-order.

## Phase 0 — pre-merge gate (never skip)

1. Working tree clean, branch pushed, CI green on the branch
   (`.github/workflows/ci.yml` runs the same checks as below).
2. Locally, from repo root:
   - `bash tools/ci/syntax-checks.sh` — every api/ file parses, every inline
     `<script>` parses, i18n dictionaries valid.
   - `bash tools/surface-audit/invariants.sh` — all lettered invariants.
   - Both smoke suites against `tools/surface-audit/stub_server.py`
     (`access_smoke.cjs`, `practice_smoke.cjs`).
3. If the diff since the last release touches api/, app.html, parent.html,
   onboard.html, store.html, kid-ios/, or android-native/: run the full
   **surface-audit** skill, not just the greps.
4. Schema changes in the diff? Confirm every new table/column is in
   `api/init.js` AND (if a hot path reads it) has a defensive `ensure*`
   helper — see the `new-endpoint` skill. Deploys hit code before schema
   otherwise.
5. Skim the diff for secrets, debug logging, and hardcoded test values.

## Phase 1 — web/server (merge = deploy)

1. Merge the feature branch into `main` (PR or fast-forward — owner's call).
2. Vercel builds automatically. Watch the deployment in the Vercel dashboard
   until it's the active production deployment.
3. If the release added env vars: set them in Vercel → Project → Settings →
   Environment Variables BEFORE merging (the full list:
   `grep -rn "process.env" api/`). A deploy with a missing env var fails at
   request time, not build time.
4. If the release added schema: as admin, `POST /api/init` once after the
   deploy. The `ensure*` helpers make this belt-and-braces, but it front-runs
   the first family hitting a new column.

**Rollback:** Vercel dashboard → Deployments → promote a previous deployment.
Schema is additive-only (`IF NOT EXISTS`), so rolling code back is safe.

## Phase 2 — production smoke (10 minutes, every web release)

- Load `/practice` logged out — renders, tiles speak (pre-rendered audio).
- Log into the parent dashboard — all five tabs render, no console errors.
- Load the kid board `/u/<slug>` — syncs, tiles speak, edit lock works.
- Add one tile from a photo end-to-end (the tile-jobs pipeline exercises
  blob, credits, image gen, TTS, and the cron in one pass).
- Vercel → Logs: no new 5xx; confirm `run-tile-jobs` cron fired within the
  last few minutes.
- If Stripe-adjacent code changed: send a test webhook from the Stripe
  dashboard and watch it 200.

## Phase 3 — iOS (TestFlight) — the hard-won notes

Local Mac clone, then:

    git pull
    xcodegen generate      # ALWAYS — new files don't exist in Xcode until this
    open MyWorld.xcodeproj

- Version/build numbers live in `kid-ios/project.yml` (MARKETING_VERSION +
  CURRENT_PROJECT_VERSION). **The number is stamped at ARCHIVE time** — the
  "Redundant Binary Upload" rejection means a stale archive was re-uploaded.
  Bump project.yml → `xcodegen generate` → Product → Archive → in Organizer,
  CONFIRM the Version column shows the new number BEFORE Distribute.
- App Store Connect: build appears in TestFlight after 10–30 min processing.
  Export compliance is pre-answered (`ITSAppUsesNonExemptEncryption=false`).
- External testers need Beta App Review once per version — fill Test
  Information with a REAL demo login (never "n/a"). Internal testers need no
  review.

## Phase 4 — Android / Fire

No CI build (no gradlew wrapper committed). Open `android-native/` in
Android Studio → build/release. Play billing verifies before consuming
(`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` + `PLAY_PACKAGE_NAME`). Fire tablets:
sideload or Amazon Appstore later — the store screen already falls back to
the web store on non-Play devices.

## One-time launch gates (check until all are done, then delete this list)

- [ ] Vercel plan supports **minute-level crons** (`run-tile-jobs` is
      every-minute; on the wrong plan, board builds crawl).
- [ ] `CRON_SECRET` set in Vercel (crons self-gate on it).
- [ ] Stripe LIVE mode: webhook endpoint at `/api/store?action=stripe-webhook`
      subscribed to `checkout.session.completed`, `invoice.paid`,
      `invoice.payment_failed`, `customer.subscription.deleted`
      (see `runbooks/stripe-go-live.md`).
- [ ] `BACKUP_DATABASE_URL` GitHub secret set (nightly pg_dump workflow).
- [ ] `[BUSINESS ADDRESS]` placeholder in privacy.html replaced.
- [ ] Domain flip to myworldtaptotalk.com (`runbooks/domain-flip.md` — 6
      hardcoded sites).
- [ ] `/practice` demo audio built once: Lab → `action=demo-audio`
      (POST op=build with 2–3 catalog voiceIds; resumable).

## Self-extension rule

Any release that adds a surface, a cron, a webhook, or an env var must add
its verification line to this skill (Phase 2 or the launch gates) in the
same PR. A checklist that lags the product is worse than none.

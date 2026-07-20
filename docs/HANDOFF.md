# Session handoff — read me first in a new thread

Last updated: **2026-07-20**. This is the working-context document for whoever
(human or agent) picks up the project next. Deep product docs live in
`docs/OWNERS-MANUAL.md` and `docs/runbooks/`; this file is the *state of play*.

## Ground rules (non-negotiable)

- **Branch**: all work on `claude/onboarding-photo-upload-huw9jx` in
  MelvinSninkle/PersonalizedAAC. Commit + push **every wave** — containers
  recycle. If the open PR has merged, restart the branch from `origin/main`
  (same name) before new work.
- **Commit trailers** (exact):
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and the
  `Claude-Session:` link the harness provides. Never put a model ID in
  commits, PRs, code comments, or any pushed artifact.
- **Verify before every commit**: `node --check` on touched API files; the
  inline-JS `new Function()` check on touched HTML; brace/paren deltas vs
  HEAD on touched Swift/Kotlin; `bash tools/surface-audit/invariants.sh`
  (expect **18 PASS**); both Playwright smokes (`access_smoke.cjs`,
  `practice_smoke.cjs`) against `python3 tools/surface-audit/stub_server.py`
  (start with a PID file, `sleep 3`, never `pkill -f`).
- **Skills**: `surface-audit` after touching api//app.html/parent.html/
  onboard.html/store.html/kid-ios//android-native/; `new-endpoint` before any
  new route (89/100 Vercel functions used — prefer actions on dispatchers);
  `release` for deploys; `update-taxonomy` + `aac-prompt-author` for
  vocabulary work.
- **Repo quirks**: deliberately NO package-lock.json; XcodeGen (`project.yml`)
  picks up new Swift files; `localStorage` keys keep their `aac*` names
  (renaming breaks installed devices); A-PUBLIC = exactly four public media
  prefixes; the practice board must never expose live TTS.

## State of play

- **PR #141** (branch → main) is OPEN with ~35 commits: landing refresh +
  marketing images + middleware `marketing/` exclusion (fixes the broken
  production hero), two-tier pricing, launch gating, waitlist, practice-board
  polish, enrollment economics, App Store prep fixes. **Everything below the
  merge line is blocked on the owner clicking merge.**
- **Pricing (owner decisions, enforced in code)**: Plus $9.99/⭐50, Pro
  $19.99/⭐150; Starter hidden (`hidden: true`, sku valid for comps); no
  discounts; packs need a membership; enrollment debit
  `min(list, grant, balance − enrollKeep)` once per child (Pro `enrollKeep: 50`);
  free tier exists (standard-art board), customization is the membership
  benefit with **no one-off path**.
- **Launch gating**: invite codes with `max_uses` signup caps. Owner's recipe:
  1,000-cap web code, 100-cap App Store code, unlimited private code for
  family/testers/App Review. Waitlist captures email + art style + child
  paragraph (Admin → Tools → Load waitlist).
  `APPLE_SIGNUP_REQUIRES_INVITE=1` only AFTER the iOS build with the invite
  field ships.
- **App Store Connect** (app: "My World Tap to Talk", individual account,
  seller = Andrew personally until D-U-N-S/org conversion): Paid Apps
  agreement, bank, W-9, DSA — all **Active**. Privacy label published
  (9 types, App Functionality / linked / no tracking). Age rating 4+ (Parental
  Controls = the only YES). Products created with exact IDs `plus.monthly`,
  `pro.monthly`, `credits50|100|250|500|1000` — **do not create
  `starter.monthly`**. Bundle id `io.andrewpeterson.myworld` stays.
- **Stripe**: staying in **sandbox** until the full test loop passes. Checkout
  uses inline price_data (no dashboard products). Needed: sandbox
  `STRIPE_SECRET_KEY` + webhook at
  `https://myworldtaptotalk.com/api/store?action=stripe-webhook`
  (events: `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.deleted`) +
  `STRIPE_WEBHOOK_SECRET` + Customer Portal activated per-mode. Go-live =
  swap both env vars to live values + one real purchase + self-refund.
- **Domains**: Phase 0 additive done (myworldtaptotalk.com serves; old
  aac.andrewpeterson.io still primary in code). **Phase 1 flip is an OPEN
  DECISION** — owner has not said go. When he does:
  `docs/runbooks/domain-flip.md` (one commit: iOS `APIClient.defaultOrigin`,
  `SettingsView`/`HeaderBar` links, Android ORIGIN, email link base, register
  fallbacks) + env/Resend/Stripe-webhook steps. Must land BEFORE the final
  Xcode archive if it's going in this build.

## Owner's next actions (in order)

1. **Merge PR #141** → Vercel deploys → images/waitlist/pricing live.
2. Create the three invite codes; run the Stripe sandbox test-card loop
   (4242… → ⭐50 lands → pack unlocks → portal cancel).
3. Decide the domain flip (tell the agent; it's a code batch).
4. Xcode: bump build, archive, upload → TestFlight on the family iPads.
5. Version 1.0 page: screenshots (iPhone + iPad, from the NEW build),
   description/keywords, support URL, copyright "2026 My World Tap to Talk
   LLC", review notes with **bypass invite code + demo account**.
6. Each of the 7 IAPs: review screenshot + "Add for Review".
7. Submit. (US-only availability; Free app price.)

## Known open items (from the pre-payments audit, still unfixed)

- Web Sign-in-with-Apple needs the Services ID updated with the new domain.
- store.html "Manage billing" 404s for Apple-billed subs before explaining.
- iOS hardcodes price strings (drift risk vs App Store Connect).
- es/fr/pt/de languages are selectable but "coming soon".
- Duplicate `_dmarc` DNS record in GoDaddy (owner-side cleanup).
- Web + Android boards still say "⚙ Display" (iOS renamed to Settings with
  sign-out inside — mirror when convenient).
- One taxonomy render was blocked as "prohibited": **Marlin** reads as the
  Finding Nemo character in 3D-animation styles — fix by prompting the fish's
  anatomy, then check for similar name-collision words.

## Owner context (useful for tone + priorities)

- Andrew Peterson (peterson.andrew.a@gmail.com); son Fletcher is the first
  user; wife Amanda + tester Anne run iPads via Xcode/TestFlight. Business:
  **My World Tap to Talk LLC** (Washington, single-member/disregarded — W-9 in
  Andrew's name, LLC as DBA). Registered-agent address preferred over home
  address anywhere public; `[BUSINESS ADDRESS]` in privacy.html still awaits
  his choice.
- **Interview at Substack** (on-site) — case-study deck reviewed and updated
  (typo fixes + speaker-note upgrades incl. the live practice-board demo cue
  and the "I don't trust the agent; I trust the harness" answer). Remind him:
  fresh stats the morning of; practice board open in a tab.
- Cost paranoia is a feature, not a bug: he capped his own launch on purpose.
  Frame all pricing/marketing honestly — the audit standard is "no promise
  the server doesn't enforce."

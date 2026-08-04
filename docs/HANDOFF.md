# Session handoff — read me first in a new thread

Last updated: **2026-07-24**. This is the working-context document for whoever
(human or agent) picks up the project next. Deep product docs live in
`docs/OWNERS-MANUAL.md` and `docs/runbooks/`; this file is the *state of play*.

## Ground rules (non-negotiable)

- **Branch**: all work on `claude/onboarding-photo-upload-huw9jx` in
  MelvinSninkle/PersonalizedAAC. Commit + push **every wave** — containers
  recycle.
- **⚠️ The branch is currently FULLY MERGED into main (0 commits ahead).**
  Per the rule above, the first action in a new thread is to restart it from
  main before any new work:
  `git fetch origin main && git checkout -B claude/onboarding-photo-upload-huw9jx origin/main`
  Do NOT stack new commits on the already-merged history.
- **Commit trailers** (exact): the `Co-Authored-By:` and `Claude-Session:`
  trailers the harness provides. Never put a model ID in commits, PRs, code
  comments, or any pushed artifact.
- **Verify before every commit**: `node --check` on touched API files; the
  inline-JS `new Function()` check on touched HTML; brace/paren deltas vs
  HEAD on touched Swift/Kotlin; `bash tools/surface-audit/invariants.sh`
  (expect **19 PASS**); the Playwright smokes (`access_smoke.cjs`,
  `practice_smoke.cjs`, `translations_smoke.cjs`, `label_lab_smoke.cjs`,
  `beacon_smoke.cjs`) against `python3 tools/surface-audit/stub_server.py`
  (start with a PID file, `sleep 3`, never `pkill -f` — it matches your own
  shell and kills the session).
- **Skills**: `surface-audit` after touching api//app.html/parent.html/
  onboard.html/store.html/kid-ios//android-native/; `new-endpoint` before any
  new route (90/100 Vercel functions used — prefer actions on dispatchers);
  `release` for deploys; `update-taxonomy` + `aac-prompt-author` for
  vocabulary work.
- **Repo quirks**: deliberately NO package-lock.json; XcodeGen (`project.yml`)
  picks up new Swift files; `localStorage` keys keep their `aac*` names
  (renaming breaks installed devices); A-PUBLIC = exactly four public media
  prefixes; the practice board must never expose live TTS.
- **No native compiler exists in this environment.** No `swiftc`/`xcodebuild`,
  no committed `gradlew`, and CI never touches `kid-ios/` or
  `android-native/`. ~36K lines of Swift/Kotlin are verifiable here only by
  reading + brace/paren deltas. Every native change needs Andrew's Xcode or
  Android Studio to be *actually* proven. Say so plainly when you ship one.

## State of play

- **All branch work through PR #156 is merged and deployed** (merge commits,
  original SHAs preserved — `d727c08` is in main). Nothing is pending review.
  Web/server deploys the moment main moves (Vercel Git integration: merging
  IS deploying), so everything below is live.
- **Two production incidents on 2026-07-21, both fixed in code:**
  1. **Lossy snapshot restore.** The restore INSERT listed only the original
     18 taxonomy columns while snapshots store full `SELECT *` rows, so every
     restore silently WIPED every column added since launch —
     `default_image_key`, `descriptive_clues`, `match_terms`, `sort_order`,
     and the growth/meal/gestalt/audience metadata. This is what deleted the
     tap-to-learn facts from production. Fixed in `2bfb979` (restore now
     writes all ~40 columns) and `d727c08` (new non-destructive **heal** mode,
     `?fn=snapshots&action=heal`, which repairs columns in place instead of
     wipe-and-replace). **The code fix does not undo the data loss — see the
     next section.**
  2. **Cross-family board exposure.** `login.html` and `app.html` both
     defaulted a slugless user to the literal `'fletcherpeterson'`, so a
     tester account's "Go to the board" rendered the operator's own family
     board from the shared-device IndexedDB cache (the server 403 held; the
     leak was client-side). Fixed in `c7af7ad`: no fallback slug, app.html
     requires `/u/<slug>`, `aacCacheOwner` wipes the local cache when the
     signed-in email changes, sync 403 wipes and bounces, and
     sync/items/categories now 400 on a missing childId. Recorded as
     standing invariants **A1b/A1c** in the surface-audit skill.
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

## ⚠️ Production data state — UNVERIFIED, check this first

As of **2026-07-22**, production taxonomy was still carrying the damage from
the lossy restore. Evidence: `GET /api/demo` returned `"tiles": []` with a
healthy `folders`, `voices`, and `styles` payload — meaning **no taxonomy row
had a `default_image_key`**, so the practice board's filter
(`styledTiles.get(r.id) || r.default_image_key` in `api/demo.js`) dropped all
~1,613 rows. The public practice board rendered empty with the message "The
practice board isn't available right now" and no style picker (`boot()` in
`practice.html` returns before `renderStyles()` when tiles are empty — the
missing picker is a symptom, not a second bug).

**Whether the recovery has been run is UNKNOWN.** The heal code deployed
2026-07-22; the button is Andrew's to click. Verify before assuming:

1. `GET /api/demo` → is `tiles` populated? (Response is CDN-cached ~1h:
   `s-maxage=3600`, so allow for staleness right after a fix.)
2. Admin → Taxonomy → Snapshots, or the `taxonomy_audit` table → is there a
   `heal` row?

If not yet done, the recovery sequence is:

1. **Snapshots → Heal** from a snapshot dated **before 2026-07-21**. Not
   Restore — restore is wipe-and-replace and would delete the 417 rows added
   since. Not the newer auto-snapshots (`pre-csv-import-*`, `pre-restore-*`)
   — those captured the already-wiped state.
2. **Merge batch** the 1,237-row master overlay (enrich mode: expect ~1,196
   enriched / ~41 inserted / 0 refused). Run it AFTER the heal so the
   overlay's improved dinosaur/insect facts and listen variants win.
3. Confirm `/api/demo` returns tiles, and that tapping a tile twice on a real
   board cycles its three facts again.

**Heal caveat worth reading before confirming**: `HEAL_DEFAULTED` in
`api/admin/_taxonomy-snapshots.js` (`core`, `is_event`, `is_gestalt`,
`audience`, `authoring_kind`, `has_relationship`, `personalized`) always takes
the snapshot's value, because a wipe stamps the NOT NULL DDL default and a
NULL check cannot detect the damage. Correct for recovery, but it means a
deliberate edit to one of those seven fields made *after* the snapshot gets
reverted. The dry-run surfaces this as a per-column row count — read those
seven numbers before confirming. The nullable columns are safe (they fill
only where currently NULL) and `match_terms` merges as a union.

**The 1,237-row overlay CSV is NOT in the repo** — it lived only in the
session upload dir and dies with the container. Andrew holds the original.
Only the 417-row batch is committed (`data/taxonomy-additions-2026-07.csv`).

## Owner's next actions (in order)

1. **Run the taxonomy recovery above** (heal → overlay merge → verify demo).
   This is the release blocker: the public practice board is the top of the
   funnel and it is currently empty.
2. Check for duplicate-label rows from the 417-row batch — it merged with an
   exact `+417` row delta, which suggests it inserted without label-merge
   donation. Search "go" and "eat" in the taxonomy workbench.
3. Register store-only boards in Lab → Boards (Food expansion, Movies & Shows,
   More core words) **before** publishing the new draft rows, so ~290
   canonical rows never hit default placement or style-build totals.
4. Chinese tester: seed `zh` in Admin → Translations (or import the JSON
   dictionary), confirm the board language, then Lab → Publish → push sounds
   for that child. Tile taps play pre-rendered clips only, so an existing
   board needs the push to speak Chinese.
5. Create the three invite codes; run the Stripe sandbox test-card loop
   (4242… → ⭐50 lands → pack unlocks → portal cancel).
6. Decide the domain flip (tell the agent; it's a code batch).
7. Xcode: bump build, archive, upload → TestFlight on the family iPads. **A
   large batch of Swift has accumulated with no compile verification** (see
   the wave list below) — expect to fix build errors on this pass.
8. Version 1.0 page: screenshots (iPhone + iPad, from the NEW build),
   description/keywords, support URL, copyright "2026 My World Tap to Talk
   LLC", review notes with **bypass invite code + demo account**.
9. Each of the 7 IAPs: review screenshot + "Add for Review". Then submit.
   (US-only availability; Free app price.)

## Known open items

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
- Native drag-pickup thresholds still need on-device tuning with Andrew (the
  failure mode to avoid: every tile-touch reading as a grab).
- Deferred native ports (full detail + a re-verification probe in
  `docs/native-parity-backlog.md`): Android is missing #17 PIN, #15 low-vision
  sizes, #12 repeat count and #11 movie linking; both natives read clues but
  can't author them (#16); #10 capture lives only in app.html, so the iOS
  consent toggle currently has nothing behind it.
- Deferred iOS polish (previously planned in detail): split `CameraCapture`'s
  `.blocked` phase into `.blocked(restricted:)` from
  `AVCaptureDevice.authorizationStatus(for: .video)`, leading the copy with
  the Screen Time steps when `.restricted` and with the Open Settings button
  when `.denied` (`kid-ios/MyWorld/Views/CameraPicker.swift`).

## What shipped 2026-07-21 → 07-22 (since the last handoff)

Requirements queue #10–#17 finished earlier; this wave is the field-bug and
polish run on top of it, driven by Andrew's real device testing and the first
Chinese tester onboarding.

- **Taxonomy importer, enrich mode** (`5d8ba33`, `3f6e6ef`): an id match now
  performs a targeted COALESCE-only UPDATE (clues, prompt, pronunciation,
  category, growth, meal, notes, sort) with `match_terms` merged, instead of
  skipping. A differing label is refused as a rename/migration, never applied.
  Row cap 1000 → 3000 and dispatcher `maxDuration` 60 → 300 so a full master
  overlay fits. Also fixed: skeleton rows don't require a prompt, drinks/treat
  meal contexts accepted, and a `text[]` insert bug (`cluesArr`/`wordsArr`).
- **Snapshot safety** (`2bfb979`, `d727c08`): full-column restore + heal mode
  (above). The `update-taxonomy` skill now requires new columns to be added to
  BOTH the restore INSERT and the heal lists in the same commit.
- **Cross-family exposure fix** (`c7af7ad`) and **granted-role signup cookie**
  (`d846142` — `register.js` signed sessions with a hardcoded `'parent'` after
  applying the role grant, which is why the Chinese voice was invisible at
  signup; affected accounts self-heal on re-login).
- **Onboarding**: incomplete family accounts resume at their saved step after
  login (`fc364d5`, admin/therapist/school keep the launchpad; legacy accounts
  detected by item count); favorite-color banner no longer clobbered by the
  per-device display default; built-in style samples reuse `stuff_ref_key`
  instantly; the magic gallery became a mini board filling in by section with
  per-section caps (`80744d8`).
- **Translations workbench** (`47e773b`, `d14bd3f`): the admin surface that
  was missing entirely — seed, coverage, missing-words, inline edit, CSV
  **and** JSON import.
- **Tap-to-learn** (`8dde6f2`): facts cycle one at a time and are
  non-interruptible on all three platforms; the repeat window restarts at the
  END of speech. (The "facts are missing" report was the restore wipe, not
  this code — the data path was verified end to end.)
- **iOS**: native quick PIN + keypad entry on both surfaces, easy-unlock
  toggle desync fixed (seed/onChange race), synced settings sections disabled
  until the seed lands, sentence-drag toggle surfaced, #15 low-vision
  enlargement, #12 repeat-nav picker and #10 suggest toggle ported
  (`8978187`, `de854b5`, `cba52d5`, `6449e9c`, `4bd5b20`).
- **Landing**: style picker became the onboarding-style card grid (`5bea398`).

## Documentation accuracy notes

- **`docs/native-parity-backlog.md` was re-verified against source on
  2026-07-24 and rewritten.** Its entire original backlog (A1–A4, B1–B6) had
  shipped and is now recorded as closed with evidence anchors. The live gaps
  are different: **android-native missed most of the 2026-07 wave** (#17 PIN,
  #15 low-vision sizes, #12 repeat count, #11 movie linking), both natives can
  read clues but not author them (#16), and #10 suggestion capture exists only
  in app.html — iOS ships the consent toggle with nothing behind it. The doc
  now carries a re-verification probe; run it before opening an item and
  update the doc in the commit that closes one.
- The skills in `.claude/skills/` ARE current and are the most reliable
  documentation in the repo; `surface-audit` in particular carries the
  invariants with their enforcement points and verify commands. Prefer them
  over any narrative doc, this one included, when the two disagree.

## Owner context (useful for tone + priorities)

- Andrew Peterson (peterson.andrew.a@gmail.com); son Fletcher is the first
  user; wife Amanda + tester Anne run iPads via Xcode/TestFlight. A Chinese
  tester family (Yixuan) onboarded 2026-07-22 — the first non-English board.
  Business: **My World Tap to Talk LLC** (Washington, single-member/
  disregarded — W-9 in Andrew's name, LLC as DBA). Registered-agent address
  preferred over home address anywhere public; `[BUSINESS ADDRESS]` in
  privacy.html still awaits his choice.
- **Interview at Substack** (on-site) — case-study deck reviewed and updated
  (typo fixes + speaker-note upgrades incl. the live practice-board demo cue
  and the "I don't trust the agent; I trust the harness" answer). Remind him:
  fresh stats the morning of; practice board open in a tab — **which is
  another reason the empty practice board is urgent.**
- Cost paranoia is a feature, not a bug: he capped his own launch on purpose.
  Frame all pricing/marketing honestly — the audit standard is "no promise
  the server doesn't enforce."
- He merges to main himself and deploys via Vercel; iOS ships from his Xcode
  archive. Work in waves, commit and push each one, and tell him plainly what
  was verified mechanically vs what needs his device.

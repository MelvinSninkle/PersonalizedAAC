---
name: surface-audit
description: Product-surface visibility audit for My World Tap to Talk. Run after changes touching api/, app.html, parent.html, onboard.html, store.html, kid-ios/, or android-native/ — or when asked to "audit the product", "check for leaks", "verify isolation/voices/images/admin", or before a release. Verifies the standing invariants — cross-family media isolation, voice-pipeline correctness per device, image-generation sanity, admin containment, role/language gating, store integrity — each with its enforcement point, a mechanical verify step, and a pass criterion.
---

# Product Surface Visibility Audit

You are auditing a personalized AAC (communication board) app for young children.
The stakes: children's photos and voices are the product's raw material, one
family's content must NEVER reach another family, and the operator's own
family data lives in the same database. Treat every FAIL below as
release-blocking until a human says otherwise.

## How to run this audit

1. **Scope first.** `git diff origin/main --stat` (or the PR diff). Sections
   whose files are untouched may be verified at grep-level only; sections
   whose files changed get full verification including runtime checks.
2. **Verify mechanically.** Every invariant lists WHERE it's enforced and a
   VERIFY step. Run the command / read the code — do not assume from memory.
   Line numbers are avoided on purpose; anchor on symbols and grep patterns.
3. **Report in the standard format** (bottom of this file). PASS needs
   evidence (the grep output / code excerpt); FAIL needs the failing file +
   what regressed; N/A needs the reason.
4. **Runtime checks** use the committed harness:
   `python3 tools/surface-audit/stub_server.py` serves the repo on
   `127.0.0.1:8765` with stubbed `/api/*`. Playwright is preinstalled
   (`executablePath: '/opt/pw-browsers/chromium'`,
   `require('/opt/node22/lib/node_modules/playwright')` on the remote runner).
   Kill the stub with a PID file, never `pkill -f` (it matches your own shell).
5. **This file is load-bearing.** If your change adds a surface (new table
   with blob keys, new lab action, new role, new client render path), you must
   also extend the relevant section here — flag the skill edit in your report.

Glossary: "childId/slug" = one child's board; `child_access` roster maps users
to boards; roles are `parent | therapist | school_team | language_tester |
admin`; "the Lab" = admin pages under /admin backed by
`/api/admin/lab?action=<name>`.

---

## A. Cross-family media isolation (the one that can never fail)

**A1. Every child-scoped endpoint verifies roster access before touching data.**
- **A1b. No childId ever DEFAULTS to a real child, anywhere.** Server: a
  missing childId is a 400 (sync/items/categories) or the event is dropped
  (events) — grep `|| 'fletcher'` in api/ must return only the legacy
  init.js column DEFAULTs. Client: app.html requires a /u/<slug> URL
  (slugless loads redirect to the launchpad); login.html's launchpad emits
  NO board link for slugless accounts. The 2026-07-21 incident: the
  launchpad's `user.slug || 'fletcherpeterson'` fallback plus app.html's
  identical default sent a language_tester to the operator's family board,
  where the shared-device IndexedDB cache rendered it. Which is why:
- **A1c. The local board cache is bound to ONE account.** app.html stores
  `aacCacheOwner` (the signed-in email); a different email on the same
  device wipes IndexedDB + aac* localStorage before anything renders, and a
  403 from /api/sync wipes and bounces to the launchpad instead of leaving
  cached tiles on screen. VERIFY both paths exist whenever loadSession /
  resyncIfChanged change.
- Enforced: `canAccessChild(auth.user, childId)` from `api/_lib/access.js`
  (deny-by-default; admin bypasses; roster row required otherwise).
- Verify: for every routed file in `api/` that reads `childId` from
  query/body, confirm a `canAccessChild` (or `isParentOf` / owner check) gate
  before the first child-scoped query:
  `grep -rln "childId" api --include=*.js | xargs grep -Ln "canAccessChild|isParentOf|owner_user_id|requireAdmin|CRON_SECRET"`
- Known-justified exceptions (compute-only, no child data read):
  `api/tts.js` (roster check exists on the saved-voice path only — that is the
  child-data read), `api/upload.js` (writes a random-UUID blob),
  `api/describe-image.js`, public endpoints (`manifest`, `relationships`,
  `invite`, `waitlist` POST, `style-guides/public`, auth flows).
  Anything ELSE in the gap list = FAIL.

**A2. `/api/media` ownership union covers EVERY table that stores per-child
blob keys.**
- Enforced: the UNION in `api/media.js`. A key found in no listed table is
  served as a shared library asset to any authenticated user — so a missing
  table silently leaks that table's blobs (this bug existed twice: album
  history and tile-job source photos).
- Verify: list blob-key columns in the schema:
  `grep -n "image_key\|sound_key\|source_key\|blob_key\|reference_key\|voice_key\|person_ref_key\|stuff_ref_key" api/init.js`
  Every table that stores keys for a specific child (`items`, `categories`,
  `persons`, `reference_images`, `pending_tiles`, `item_image_history`,
  `tile_jobs`, plus ANY NEW ONE in the diff) must appear in the media.js
  union. Shared-by-design prefixes (taxonomy-defaults/, style-defaults/,
  category-defaults/, tts/, style_guides refs) are intentionally open to any
  *authenticated* user.
- Note: the ownership check fails OPEN on DB error by design (availability
  for the child's own board). Confirm the catch only logs — it must not
  widen: no code path may skip the check when the DB is healthy.
- Resized variants (`?w=`, stored at `thumbs/<w>/<key>.webp`): the variant
  is served ONLY after the ORIGINAL key passes the auth + ownership check
  above, `thumbs/` is deliberately NOT a public prefix, and clients never
  pass `thumbs/` keys directly. VERIFY the resize block sits AFTER the
  ownership check and derives its access decision from the original key —
  a variant reachable by its own key without that check = FAIL.

**A3. Blob keys are unguessable.** Any new blob write must embed
`randomUUID()` (or a content hash) in the key — grep the diff for `blobPut`/
`put(` calls and check key construction. Sequential or childId-only keys = FAIL.

**A4. Content edit rights.** `items`/`categories` PUT/DELETE load the row
then apply `canEditContent` (owner-or-parent-override model). Verify both
files still gate writes through it.

**Runtime spot-check (when api/media.js or access.js changed):** with two real
test accounts on a deployed preview, fetch a media key belonging to family B
while authenticated as family A → expect 403. An anonymous fetch → 401.

**A-PUBLIC. The practice board is the ONLY unauthenticated surface.**
Two deliberate public reads exist: `GET /api/demo` (starter-board projection:
labels + shared default art keys, nothing child-owned, GET-only) and
`/api/media` for the `PUBLIC_PREFIXES` whitelist (`taxonomy-defaults/`,
`category-defaults/`, `style-defaults/`, `demo-audio/`) — generic library
assets with no child data. VERIFY: (1) the whitelist in api/media.js has
exactly those four prefixes and every OTHER key still hits checkAuth +
ownership; (2) api/demo.js selects no child_id / user columns and rejects
non-GET; (3) practice.html contains no add/edit affordances and calls no
writing or generating API (its network surface is demo + media only —
tools/surface-audit runtime check covers this); (4) demo audio is
PRE-RENDERED via Lab → demo-audio; a public live-TTS route must never exist.
The iOS DemoBoardView (#14) is a native consumer of this same surface: it is
unlocked by POST /api/auth/login with the literal user ID "admin" + the
ADMIN_TOKEN env (timing-safe compare, server-side only, NO session cookie
minted — the response is just {ok, demo:true}), and it reads exclusively
/api/demo + public-prefix media, same no-live-TTS rule. VERIFY when
login.js or DemoBoardView changes: the admin branch never calls
signSession/serializeCookie, and DemoBoardView calls no authenticated or
writing API.

## B. Voice pipeline (what speaks, in whose voice, on which device)

**B1. The operator's personal cloned voice is unreachable by non-admins.**
Env `ELEVENLABS_VOICE_ID` is a real family member's voice. Three independent
guards in `api/tts.js`, in resolution order — read the chain top to bottom:
1. Explicit `voiceId` param → must pass `voiceSelectable(db, id, { role })`
   for non-admins (active catalog voice + language rule, B2).
2. `childId` saved-voice path → requires `canAccessChild` (a board's saved
   voice may BE the clone — the roster is what authorizes speaking with it).
3. No voice resolved → non-admin fallback is the FIRST ACTIVE CATALOG voice,
   never the env default.
Also `api/onboarding/child.js` gates voice assignment through
`voiceSelectable`. Any new endpoint accepting a voiceId must do the same.

**B2. Non-English voices are invisible AND unusable for ordinary accounts.**
- Enforced in `api/_lib/voices.js`: `listVoices` filters `lang !== 'en'`
  unless `allLangs`; `voiceSelectable` allows non-en only for
  `langTester(role)` (admin / language_tester). `api/onboarding/voices.js`
  passes `allLangs: langTester(auth.user.role)` — this one endpoint feeds
  BOTH the onboarding picker and the parent-dashboard voice picker.
- Verify: confirm the filter and both call sites; then confirm `/api/tts`
  passes `role` into `voiceSelectable` (visibility filtering alone is not a
  gate — the ID can be replayed).

**B3. The shared TTS cache key recipe is in lockstep everywhere.**
`sha256("${modelId}|${voiceId}|${emotion}|${text}")` — three sites must agree
or clips cache-miss forever / point at wrong audio. Find them with
`grep -rn "createHash('sha256')" api/tts.js api/_lib/onboarding-render.js api/admin/_lab-publish.js`
(tts `cacheKeyFor` — note its hash chain spans multiple lines; `synthesizeVoice`
cache key; publish `pushSounds` stamp), then READ each and compare the
template string piece by piece. Seeded/pushed clips use emotion literal
`default`.

**B4. What a tile SAYS follows the language.** Seed: `spokenTextFor` in
`api/_lib/seed-board.js` = translation.pronunciation → translation.label →
taxonomy.pronunciation → taxonomy.label (translation map loaded only when
`childLanguage != 'en'`). Publish→sounds mirrors this in `_lab-publish.js`.
Clips are copied per child under `onboarding/<childId>/voice/` — parent
RECORDINGS (any other key shape) are never overwritten by pushes.

**B5. Device matrix.** Tap-to-speak plays the item's `sound_key` clip on all
three clients (web `playSound`, iOS TilePlayer, Android TilePlayer) — no
label-TTS fallback in the tap path, so a translated board speaks its clips.
Runtime TTS surfaces (message bar, listening mode, games, celebrations) must
pass `childId` to `/api/tts` so the child's saved voice is used — grep each
client for `/api/tts` calls and confirm childId rides along.

## C. Image generation sanity

**C1. One prompt source per subject type.** Portraits: `buildPortraitPrompt`
in `api/_lib/onboarding-render.js` is the ONLY portrait prompt (used by
onboarding, add-person, tile-jobs people branch, Portrait Lab). Taxonomy
tiles: `renderTaxonomyTile`. A second hand-rolled portrait prompt anywhere =
FAIL (drift caused the "adult drawn with child proportions" bug).

**C2. Age handling.** `persons.age_group` ('adult'|'child'|null) derives from
relationship (`api/_lib/relationships.js` age/ageDefault); the prompt's adult
wording defers to the STYLE's own adult convention (style-relative, not
prescriptive proportions). Verify the AGE paragraphs still read that way.

**C3. Reference-image legend order.** In `renderTaxonomyTile`: style
reference first ("copy its art style only, not its content"), subject/person
anchor second (likeness), `worldRefKeys` labeled as same-world style
references. Swapped order = whole-board identity bleed.

**C4. Style person/stuff references are OPERATIONALLY stand-ins.** The
style_guides `person_ref_key` drives how NOUNS/body-parts render for every
family on that style — it must never be a real family member the operator
didn't intend to share (this happened: a tester's board rendered the
operator's family). Code can't enforce this; the audit reports which styles
have person refs (`admin/lab` style cards) and flags it for human review.
Since the style-reference gallery, `renderTaxonomyTile` auto-attaches the
subject-matched ref (person tiles → `person_ref_key`, everything else →
`stuff_ref_key`) on FAMILY renders too — so a bad public person ref now
reaches every family on that style, raising the stakes on this review.

**C5. Non-English boards bake NO text into art.** `renderTaxonomyTile`
appends a hard no-text override when `suppressBakedText` (seed passes
`!!c.trMap`). Image models mangle CJK; the app's own label carries the word.
Verify flag exists at the seed call site and the override is appended AFTER
the master prompt.

**C6. Read-through defaults never clobber personalization.** In
`api/sync.js`: a tile is replaceable only when its key is empty or starts
with `taxonomy-defaults/` / `style-defaults/`; styled art resolves by
`taxonomy_slug` (id, not label — survives translation); chips replaceable via
`isSharedIcon` (empty / category-defaults/ / style-defaults/). A child's own
image (any other key) must never be swapped. The generic
`taxonomy.default_image_key` overlays EVERY replaceable tile (the old
`isDefaultableTile` person-tile carve-out is gone — hand-picked
group-of-children defaults serve person-y tiles until a family
personalizes). The admin upload path (`_lab-default-upload.js`) writes ONLY
the shared default layers (`taxonomy.default_image_key` /
`taxonomy_style_defaults`) — it must never UPDATE items rows.

**C6b. Image-history revert is key-contained.** `api/items.js`
`op=revert-image` (canEditContent-gated) accepts ONLY a key already present
in that tile's own `item_image_history` rows — an arbitrary key in the POST
must 4xx, or a parent could point their tile at another family's blob. The
current image is archived (source `revert`) before the swap, so a revert is
itself revertible. `GET ?history=` is gated by the same ownership check.

**C7. Decode bounds.** Clients decode images at display size, never full-res
grids (jetsam/OOM): iOS `MediaCache.image(for:maxPixel:)` call sites pass
explicit sizes; Android `MediaCache.bitmap(key, maxDim)` likewise; web store/
album imgs are `loading="lazy"` and folder lists render collapsed. New image
grids must follow suit.

**C8. Every image add asks keep-vs-restyle; per-image style picking is
banned.** Every family surface that takes a photo (tile adds, tile editors,
bulk category add, category icons, person/family portraits — web, iOS,
Android) presents exactly two choices: "keep my exact photo" (free, the
`raw` path) or "restyle to the child's SAVED board style" (the default on
styled tiers; free tier locks to exact + upsell). There is NO per-image art
style or model picker anywhere — mixed styles broke the board's visual
consistency; changing the style is a deliberate act in the parent
dashboard's Art style panel only. Server side, `?styleGuideId=` and
`?model=` on `/api/generate-image` and `/api/tile-jobs` are honored for
ADMIN callers only (Lab tooling); the `style` text param is a weak prompt
nudge and family callers send a fixed neutral phrase. VERIFY:
`invariants.sh` C8 greps (no `bulk-style` select in app.html, no
`ForEach(ArtStyle/ImageModel.allCases)` in the iOS tile editor, no
`localStorage aacStyle` reads in parent.html) plus code review of any new
capture surface.

## D. Admin containment

**D1. Every Lab/taxonomy handler self-gates.** The dispatcher
(`api/admin/lab.js`) forwards blindly — the HANDLER must gate:
`grep -rLn "requireAdmin\|role !== 'admin'\|role === 'admin'" api/admin/_lab-*.js api/admin/_taxonomy-*.js`
MUST return empty. Any new `_lab-*.js` in the diff missing `requireAdmin` = FAIL.

**D2. Nuclear + financial endpoints are admin-only.** `api/wipe.js`,
`api/init.js`, `api/usage.js`, `api/invite-codes.js`, `waitlist` GET, and in
`api/store.js` the grant/grant-all/coupons/coupon-create/coupon-update/
sub-override actions — each checks `role !== 'admin'` → 403. Verify each.

**D3. The admin role is never grantable.** `_lab-role.js` GRANTABLE set
excludes 'admin'; `api/_lib/role-grants.js` APPLYABLE set excludes 'admin'
AND the UPDATE carries `AND role <> 'admin'` (a poisoned role_grants row must
not mint or demote an admin). Both layers must hold.

**D4. Client-side admin UI is convenience, not security.** parent.html /
apps hide admin controls by role — fine — but every action they call must be
server-gated. When a diff adds admin UI to a shared page, find its endpoint
and confirm the server gate.

**D5. Cron endpoints.** `api/cron/*` accept `CRON_SECRET`; they fail open
when the env var is UNSET (deploy footgun, accepted). They must do global,
idempotent work only — a cron handler that takes a request-controlled childId
or returns data = FAIL.

## E. Role & language gating (dark-launched features)

**E1. Board language is tester-gated server-side.**
- `api/child-settings.js` POST: non-(admin|language_tester) saves silently
  keep the CURRENT language (the save itself must not fail — older clients
  send full settings objects).
- `api/onboarding/child.js`: `langAllowed` roles only; guard prevents a
  non-tester rerun from clobbering a tester-set language.
- UI reveals (`.lang-tester-only` in parent.html, `#lang-row` in
  onboard.html) are cosmetic; the server checks above are the gate.

**E2. English is the identity, translation is a view.** `label_translations`
feeds `displayLabel` at sync read time ONLY. Nothing may ever write a
translation into `items.label`, `categories.label`, or `taxonomy.label`
(style lookups, shop matching, publish tools, and analytics all key on
English). `grep -rn "UPDATE items SET label\|UPDATE categories SET label" api`
— the four known-good hits are `_lib/tile-jobs.js` (parent's add-a-tile
naming), `_lib/seed-board.js` (canonical English tax.label at placement),
`admin/_lab-publish-tile.js` (admin lab), `api/persons.js` (parent renames a
person). Any NEW hit must be a parent/admin edit path, never a translation.

**E3. Pre-authorized signups.** `role_grants` applies at BOTH signup paths
(`api/auth/register.js` self-signup, `api/auth/apple.js` first sign-in) via
the shared `applyRoleGrant`, then consumes the row. If a diff adds another
account-creation path, it must call `applyRoleGrant` too.

**E4. Milestones are observational and unsinkable.** Detection
(`api/_lib/milestones.js`) runs fire-and-forget on `/api/events` ingestion —
it may never block or fail a tap insert (verify the events.js hook is wrapped
and `.catch(() => {})`ed). Dedup is the UNIQUE (child, kind, detail_key)
constraint, so re-ingestion can't duplicate a "first". Push respects
`settings.milestonesPush === false` opt-out. `/api/milestones` GET is
roster-gated like any child endpoint (A1).

**E5. Game & teaching surfaces render the board's language, not English.**
Every child-facing surface that SHOWS or SPEAKS a tile word — the passive
slideshow, "Teach me", matching / clue quiz / auditory comprehension,
expressive naming reinforcement — must use `displayLabel` (iOS/Android
`.display`, web `it.displayLabel || it.label`), and must gate off the three
kinds of English-only prose when `displayLabel` is set: sentence frames
("I can see a …", "Who or what is the …?"), `descriptive_clues`, and
`description`. This includes double-tap teach (web `tapSpeak`, native
`TilePlayer.play`) — its clue playback is gated on `displayLabel` being
unset, same rule as the games. On translated boards the prompt degrades to the word itself
in the board's language. VERIFY: grep the game views for raw `.label` /
`${t.label}` / `tile.label` in any string that is spoken or rendered —
`kid-ios/MyWorld/Views/{Slideshow,Matching,ExpressiveNaming}View.swift`,
`android-native/.../ui/game/*.kt`, and app.html's SLIDE / TEACH / playPrompt
blocks. Raw `.label` is CORRECT only in game-log/analytics payloads
(`GameLogPayload`, `LivePayload`, `recordAttempt`) — logged identity stays
English forever. Two accepted display quirks: English boards show no separate
word element (the art's baked caption band carries it), while translated
boards MUST show a word element because their art renders with no baked text
(C-section `suppressBakedText`); and `TilePlayer.play(tile)` is always safe —
it prefers the tile's seeded clip, which is synthesized from the translation.

**E6. Access experiments are admin-only while dark-launched.** The
`navMode` / `sentenceBuilder` / `sentenceIdleMin` / `sentenceLift` /
`listenRepeatNav` keys in
child settings are writable ONLY by admins — `api/child-settings.js` restores
the current values on any non-admin save (same silent-keep pattern as
language, E1). The board (app.html `applyAccessSettings`) honors whatever is
stored without a role check — that is correct, because only an admin can have
set it. The parent-dashboard panel (`.admin-access-only`) is cosmetic; the
server gate is the enforcement. When these features graduate, the gate widens
here and in the panel reveal — nothing else should need touching. VERIFY:
grep child-settings.js for ACCESS_KEYS; confirm a parent-role POST cannot
change them (stub harness: save with role=parent, read back). Runtime: run
`python3 tools/surface-audit/stub_server.py &` then
`node tools/surface-audit/access_smoke.cjs` — the full suite (button-nav
paging/alignment, sentence-bar drag lifecycle, repeat-navigate highlight)
must ALL PASS.

**E6b. Touch, safety & tool keys are DELIBERATELY parent-writable.**
`tapInterrupt`, `doubleTapTeach`, `easyClose`, `easyUnlock`, and the header
tool visibility keys `toolListen` / `toolTeach` / `toolPlay` /
`toolSentence` (default true; the ✏️ pencil additionally requires the
admin-gated `sentenceBuilder`), and `sentenceDrag` (default false; NATIVE
APPS ONLY — drag a tile up to the header to stage it, additive to the
pencil, also requires `sentenceBuilder`; the web deliberately has no drag
because it needed `touch-action: none` — nothing may ever disable touch
scrolling on the web board), and the listening display filter
`listenCensor` (default TRUE) / `listenTilesOnly` (default false — see E8)
are ordinary
child-settings root keys — do NOT "fix" them into the ACCESS_KEYS gate;
parents own these decisions. ALL of these are parent-editable on every
surface, organized in one canonical themed order (most common first): Board
look → Art style → Board tools → Touch & play → Listening → Safety &
unlock → This device. The editors: app.html Display modal, parent.html
accordions, iOS `DisplaySettingsView.swift` + ParentSettings Art style,
Android `DisplaySettingsView.kt` + ParentSettings Art style. The one
guarded flow is `easyUnlock` ENABLE: every UI (app.html `disp-unlock-yes`,
parent.html `safety-unlock-yes`, and the native screens' `confirmEasyUnlock`
flows) must show the strong warning and re-verify the account password via
`/api/auth/login` before saving `easyUnlock: true`; disabling never needs
friction (invariants.sh greps all four). The board's unlock skip
additionally requires a signed-in editor session (`sessionUser &&
canEdit()`) — easyUnlock skips the password re-prompt, never the login.
Native honoring reads TouchConfig (AccessFeatures, both platforms):
quick-tap on the shared LongPressExitButton and lock-long-press straight to
edit mode. The public practice board offers the Board-look controls too,
but SESSION-ONLY (`sessionStorage 'practiceDisplay'` — never localStorage,
never the server; A-PUBLIC's two-GET surface is unchanged).

**E7. Recorded ≠ scored.** Game sessions with fewer than 3 answers are
RECORDED (they appear in recent sessions, annotated "too short to score")
but excluded from the weekly accuracy aggregate (`api/analytics.js`
`denom >= 3`) and from spike baselines (`api/_lib/spike.js`
`slides_attempted/item_count >= 3`). An ended-early game must never read as
a string of misses, and a one-tap game must never read as 100%.

**E8. Listening never renders a bad word — masking defaults ON.**
Listening mode captions everything said near the device onto a child's
screen. Words on the server-owned blocklist (`api/_lib/bad-words.js`,
shipped to all three clients as `/api/sync` → `listenBlocklist`, cached
for offline; ALSO shipped on the public `/api/demo` for practice.html's
timeboxed listening demo, where the censor is permanently ON with no
toggle) render as the pill **"Bad Word"** instead; the parent-writable
`listenCensor` key defaults TRUE on every client (`!== false` on web,
`?? true` iOS, `?: true` Android) and `listenTilesOnly` (default false)
hides every non-tile word outright. The filter lives at each client's
tokenizer (web `tokenizeForListen`, iOS/Android `ListenTokenizer.tokenize`)
so chips, text pills, and repeat-navigate all see the filtered stream.
Rules: the blocklist is edited ONLY server-side (match-terms doctrine —
never port word lists or matching rules into a client); entries are
single normalized lowercase tokens (exact match, no substrings — so no
Scunthorpe false positives, but variants need their own entries); the
default must never flip to off. Verify: `invariants.sh` E8 greps the
default-ON pattern on all three clients + the sync ship line;
`access_smoke.cjs` drives masking / tiles-only / censor-off through the
real web tokenizer via the `listenTokens` + `setListenPrefs` hooks.
Parents edit both toggles in FOUR places: parent.html Touch & safety,
app.html Display modal, and the native parent Settings screens (the first
parent-editable settings on native — iOS `updateChildSettings`, Android
`saveChildSettingsKey`).

**E9. No draft style ever reaches a parent.**
New offered styles (global `style_guides` rows) are created INACTIVE
(`DRAFT_ACTIVE = false` in api/admin/style-guides.js) and go live only via
the style wizard's Publish, which refuses until the generated default set is
100% complete (`_lab-style-wizard.js` op publish → `styleBuildStatus`).
Two read gates filter `active = TRUE`: the onboarding picker
(api/onboarding/styles.js) and the public demo's style switcher list
(api/demo.js). An explicit `/api/demo?style=<id>` also resolves DRAFT ids —
deliberate (the wizard's preview), safe because per-style default art is
shared-library-only (`style-defaults/` — already one of A-PUBLIC's four
public prefixes) and a draft is not discoverable without its id. The build
pipeline is `style_build_jobs` drained by the run-tile-jobs cron with
family work always first. Verify: `invariants.sh` E9 greps both active
filters + the draft default.

**E9b. Demo kids never reach a family board.** A style can carry extra
"demo kids" (`style_demo_children` + `demo_child_id` on
`taxonomy_style_defaults` / `style_build_jobs`; kid 0 = the style's own
`person_ref_key`) so the PUBLIC practice board offers a "Meet:" switcher.
Only person-scope rows (`isPersonScopeRow` — mirrors renderTaxonomyTile's
`usePerson`) re-render per kid; chips + object tiles stay the shared kid-0
set. The pins that keep kids demo-only: `api/sync.js` styled reads filter
`AND demo_child_id = 0` (with a pre-migration fallback), and every
lab writer targeting the family-visible set (`_lab-style-defaults.js`,
`_lab-default-upload.js`) pins 0 explicitly. `api/demo.js` offers a kid on
the switcher only when its person-scope set is COMPLETE, and honors
`?kid=` only for listed kids. Verify: `invariants.sh` E9 greps the sync
pin; `practice_smoke.cjs` asserts the switcher + per-kid re-render.

**E10. Self-signup requires a valid invite code.** The public funnel
(`/`, `/practice`, `/signup` — middleware.js `isPublicPage`) has no page
wall; the private preview is enforced INSIDE account creation:
register.js's open self-signup path 403s (`invite_required`) unless
`validateInviteCode` (invite-perks.js — fails CLOSED) accepts a typed
`inviteCode` or the signed `mw_invite` cookie an invite link set. The
validated code also drives perks attribution (`applyInvitePerks`). Every
other page keeps the /welcome cookie gate. KNOWN GAP, deliberate: a fresh
Sign-in-with-Apple account (api/auth/apple.js) is not yet gated — the
native apps have no invite-code field; mirror the gate there once a native
build ships the field. Verify: `invariants.sh` E10 greps the validation +
rejection in register.js.

## F. Store & credits integrity

**F1. Ledger is append-only truth.** `credit_ledger` SUM = balance;
`spendCredits` is a single conditional INSERT (concurrent spends can't
double-spend). No code may UPDATE/DELETE ledger rows.

**F1b. Spends are announced, and adds are free-by-default.** Every button
that will spend credits states "uses ⭐N — you have ⭐M" and waits for OK
BEFORE the call (web `confirmSpend`/`pdConfirmSpend`, native pending-spend
alerts; the server 402 stays the backstop, never the first notice). Cost
facts come from the server (`catalog.costs`, `personalize-status`,
quotes) — clients must not invent prices. The add-on-board "credits"
pricing tier is RETIRED: every board free-adds with shared default art
(store.js free-board has no premium gate; init.js migrates old rows) and
credits only ever buy styling. Do not reintroduce a pay-to-add path.

**F2. Catalog lives in code.** `PACKS`/`SUBSCRIPTIONS` in
`api/_lib/credits.js` are the only price source (Stripe checkout uses inline
price_data; Apple/Google product ids ride the same rows). A price in any
other file = FAIL.

**F3. Stripe webhook** verifies the signature before acting; handles
`checkout.session.completed` + `invoice.paid`; grants are idempotent by
`external_id` unique constraint.

**F4. Board catalog pricing is enforced, not displayed.** Credits-priced
store boards: seeding skips `store_only` rows (`placementRows` filter),
free-add returns 402 `premium_board` server-side, and browse annotates
`freeBoard:false` (client hiding is cosmetic).

## G. Client parity spot-checks (runtime, via the stub harness)

Run when client files changed. Start
`python3 tools/surface-audit/stub_server.py` (background, PID file), then with
Playwright against `http://127.0.0.1:8765`:
- `/u/testkid` (app.html): board renders; translated stub entries (披萨/食物)
  display while untranslated fall back to English; tile labels don't wrap.
- `/parent.html`: five tabs render, `#lang-panel` hidden with no role,
  visible when `/api/auth/me` is routed to role `language_tester` or `admin`
  (remember: switch to the Board tab before asserting visibility).
- `/onboard.html`: `#lang-row` gated the same way; Boy/Girl picker
  single-select; support mailto populated.
- `/store.html?child=testkid`: zero tiles on first paint (folders closed),
  search opens matches, cart badge on closed folders.
- Console must be free of pageerrors on all of the above.

iOS/Android can't compile in the remote runner: structural checks only
(brace balance, decode-tolerant optional fields — new sync fields must be
optional with defaults so cached payloads still decode), then tell the
operator what to verify in a local build.

---

## Report format (required)

```
# Surface audit — <date> — scope: <diff summary or "full">
| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| A1 | roster gate on child endpoints | PASS | grep gap list = known exceptions only |
| A2 | media union covers blob tables | FAIL | new table `foo_bar` stores image_key, absent from media.js |
...
```
- One row per invariant actually checked; sections skipped for scope get one
  N/A row with the reason.
- FAILs first in the summary sentence, each with the file to fix.
- End with: skill deltas (did this change add a surface this file must now
  cover?), and any human-judgment items (C4 style refs, D5 env vars).

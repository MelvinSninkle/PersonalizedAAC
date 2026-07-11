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

**A3. Blob keys are unguessable.** Any new blob write must embed
`randomUUID()` (or a content hash) in the key — grep the diff for `blobPut`/
`put(` calls and check key construction. Sequential or childId-only keys = FAIL.

**A4. Content edit rights.** `items`/`categories` PUT/DELETE load the row
then apply `canEditContent` (owner-or-parent-override model). Verify both
files still gate writes through it.

**Runtime spot-check (when api/media.js or access.js changed):** with two real
test accounts on a deployed preview, fetch a media key belonging to family B
while authenticated as family A → expect 403. An anonymous fetch → 401.

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
image (any other key) must never be swapped.

**C7. Decode bounds.** Clients decode images at display size, never full-res
grids (jetsam/OOM): iOS `MediaCache.image(for:maxPixel:)` call sites pass
explicit sizes; Android `MediaCache.bitmap(key, maxDim)` likewise; web store/
album imgs are `loading="lazy"` and folder lists render collapsed. New image
grids must follow suit.

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

## F. Store & credits integrity

**F1. Ledger is append-only truth.** `credit_ledger` SUM = balance;
`spendCredits` is a single conditional INSERT (concurrent spends can't
double-spend). No code may UPDATE/DELETE ledger rows.

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

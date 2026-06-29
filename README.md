# Personalized AAC — "My World"

A communication and learning app built for non-verbal children who may be gestalt language processors. The product is a **web app** (the `app.html` kid board + `parent.html` dashboard + therapist and admin surfaces) backed by one Vercel API, deployed at `aac.andrewpeterson.io`. A native **SwiftUI** build of the child board + parent app also lives in `kid-ios/`, and a Capacitor shell wraps the web views; all three clients share the same API.

> The app started as a single-file HTML AAC board for one specific child. It has since grown into a full system covering personalized AI tile art, structured games, spaced-repetition auto-teaching, scheduling, remote facilitation, holiday celebrations, and image memorabilia. This README documents the current shape — see git history for the journey.

## Capabilities at a glance

The recent feature waves, in the rough order they shipped:

- **Personalization throughout** — the child's name, the family's faces, the relationships drive both the board art (Nano Banana from a reference photo) and the teaching descriptions (deterministic from the structured `persons` row).
- **Image album / memorabilia** — every previous tile picture is archived to `item_image_history` on regeneration, organized in the parent app as `People · Words · Verbs · Celebrations` folders so it reads as a scrapbook.
- **Special-day events** — full-screen celebration scenes on holidays + the child's birthday, lazy-generated per child per year with Nano Banana and dropped into the album as memorabilia.
- **Developmental age bands** — every taxonomy row carries an `acquisition_age` (12-18m / 18-30m / 2-3y / 3-4y / 4y+) so an early-intervention board hides clutter; parent can unlock the next band manually, or the system advances automatically on a clinical 80/90 mastery rule.
- **Auto-teach subsystem** — hands-off slideshow + daily game runner with parent-tunable cadence (conservative / standard / intensive), tier (under-3 / 3-5 / 5+), schedule blackouts (sleep / school / meals), recently-active guard, and 30-min cooldown. Tile picker prioritizes unmet age-band words → longest-gap active → acquired-not-mastered → one stretch tile → one maintenance recheck.
- **Two-tier TTS caching** — every phrase is hashed (`model|voice|emotion|text`) and stored in Vercel Blob server-side AND in a per-device `SpeechCache` so ElevenLabs is hit at most once per unique phrase, ever.
- **One app, two display modes** — the SwiftUI binary asks "Who uses this device?" on first run and stores the role; same install can be the child board or the parent app, switchable from either side's settings.
- **Parent app, native** — phone-first SwiftUI home screen with Add a Tile · Family & People · Quick Board · Start a Game · Message the Board · Stats · Schedules · Album · Auto-teach.
- **Stats hub** — five focused pages: Top Words, Word History (searchable), Game Accuracy (by category AND by mode), How They Answer (tap / verbal / object / physical / gesture), Mastery & Sessions.
- **Facilitator UI auto-pops** — when a game session starts on the iPad (from anywhere — phone, iPad, web console, scheduler), `ParentLive` flips and the FacilitatorView appears over whatever the parent was doing. Match the same color cues as the web therapist console (tap blue / verbal green / object purple).
- **Security baseline** — `canAccessChild` and `isParentOf` now gate every child-scoped endpoint; admin gates on every `api/admin/*`; XSS escaped in dashboards; per-account daily image-generation spend cap.

### Latest wave (web onboarding, keystones, backups)

- **Self-service web onboarding** — a public `/signup` (free, no card) creates the account + child slug + welcome email, then a redesigned `/onboard` runs a durable **state machine** (`account → child → child_photo → parent_photo → scene_keystone → seed_core → complete`, resumable via `/api/onboarding/state`): pick a board **art style** (or upload your own) and a **voice** (with ▶ previews) → approve the child + family **keystone portraits** → approve a no-people **scene keystone** → the curated Core board renders in the background.
- **Two-model image split** — keystones (people portraits + the scene anchor, and any family added later) now generate on **OpenAI gpt-image** (best art-style transfer); the bulk board stays on **Gemini Flash / Nano Banana** (cheapest, best likeness-holding). The live keystone model is chosen in the **Portrait Lab** and stored in `lab_settings.model_defaults.keystone`. Added-family generation (`/api/onboard-subject`) was realigned to the same keystone pipeline + the child's chosen voice, so every person on a board matches.
- **Parent ZIP backup** — alongside the import-compatible `.json`, parents can download a `.zip` of the actual `.png`/`.mp3` files in browseable `images/`/`sounds/` folders + a `manifest.json` (built client-side, no server function).
- **Function-count consolidation** — to stay under Vercel's 100-route limit, the Lab's 11 endpoints and the taxonomy workbench's 8 endpoints were each folded behind one dispatcher (`/api/admin/lab?action=` and `/api/admin/taxonomy?fn=`); the underlying handlers were renamed with a leading `_` so Vercel stops counting them as routes. Four dead endpoints were removed.

### Latest wave (2026-06)

- **Durable, server-side tile generation** — making a tile from a photo no longer runs on the device. The photo is uploaded once to `/api/tile-jobs` (and is *safe the instant that returns*), the server runs the whole chain (name → style-consistent art → voice → place on the board), and a one-minute cron (`/api/cron/run-tile-jobs`) drains the queue + retries stragglers — so a tile lands even if the device drops, backgrounds, or is killed. Final-attempt **save-first** keeps the raw photo as the tile so a capture can never be lost. The iOS tray just polls; `tile_jobs` rows survive an app restart.
- **Style consistency, everywhere** — every generation now attaches the child's **house style-guide image** ("copy its art style only") instead of the old `reference_images` pull (which fed the child's own photos as a "style" and wasn't even populated by the SwiftUI onboarding). The chosen style persists to `child_settings.styleGuideId`; `/api/generate-image` (board-editor regenerate + web) and the durable path share the same composition. All tile art now targets a **square 1:1** output (Gemini `imageConfig.aspectRatio` with a safe fallback) so the subject + baked caption survive the square crop.
- **Onboarding redesign** — the Child step now picks a **board art style** (a style-guide image) and a **board voice** (an ElevenLabs voice, with ▶ previews); the grown-up step is **repeatable** (add the whole circle — other parent, siblings, grandparents, nanny). The seed step **actually renders** the Core 12-18m taxonomy tiles now (it was a queue stub) using the chosen style + the child's portrait, and voices them in the chosen voice. Phonetic-pronunciation generation was removed (selection over generation — TTS speaks the title).
- **Per-child voice** — the onboarding voice persists to `child_settings.voiceId`; `/api/tts` resolves it from `childId` (explicit `voiceId` still wins), and every tile created or edited in the app speaks in it.
- **Family & People manager** (parent app) — a parent-accessible screen to add / replace / rename the reference faces (child, family, caregivers, the doctor) anytime — not just onboarding. Adding a People-section photo runs the durable pipeline, which also **registers a `persons` row** (so a new doctor becomes a referenceable anchor) and upserts their one tile (replace-photo doesn't duplicate).
- **In-app board edit powers** — tap any tile while the board is unlocked (or in the parent Quick Board) to open the full editor: rename, swap the picture (new photo → AI art or use as-is), keep-aspect, re-voice with an emotion preset, pin (People), move section/folder, set the listening-game description, or delete — matching the web organizer.
- **Square-except-TV tiles** — every tile renders square (crop-to-fill); the one exception is a folder named **TV / Movies / Shows / Posters**, whose tiles keep their natural rectangular shape for movie posters. Driven by the folder, not a per-tile flag. Settings → "Make all tiles square" normalizes the stored `keep_aspect` (fixes the web/data) to the same rule.
- **Pre-generation review** — a single capture now pauses on a "hold on — here's more info" sheet before the (slow, costly) generation: override the name and add an optional detail hint ("the red cup, not the blue one") that steers the art.

---

## The views

| Path | Audience | What it is |
|---|---|---|
| `/signup` + `/onboard` | New parents | Free self-service signup → guided onboarding (art style, voice, keystone portraits + scene, then the starter board) |
| `/u/<slug>` | The child (tablet) | The AAC board itself — People · Nouns · Verbs grid + a Needs strip + the game/slideshow/celebration runtime |
| `/parent/<slug>` | Parents | Dashboard: analytics, mode launcher, organizer, schedule editor, reward cheers, scheduled prompts, family & people, JSON + ZIP backup, account |
| `/therapist` | SLP / facilitator (multi-child) | Roster home — a grid of child profile portraits for every child the therapist has access to; click one to enter that child's `/therapist/<slug>` |
| `/therapist/<slug>` | SLP / facilitator (one child) | Live facilitator console (drives a game on the iPad), plus the shared schedule editor and progress view |
| `/admin/taxonomy.html` | Admin | The canonical word/tile library workbench (curated word list shared across all children) |
| `/admin/lab.html` | Admin | The tile-art studio — style guides, model routes, generate / review / push tile candidates live, and a multi-subject scene composer |
| `/admin/portrait-lab.html` | Admin | Bench for the onboarding portrait/keystone generation (runs the exact production pipeline) + the live keystone-model picker |
| `/admin/index.html` | Admin | Hub: content tree, usage/cost, invite codes, DB migrations, and links to every admin tool |

All views sit behind a session cookie; an invite-gate (`/welcome`) sits in front of anonymous traffic. After login, **no automatic redirect by role** — you land on a launchpad with the surfaces relevant to your role, so you can deliberately go to (e.g.) onboarding or the admin taxonomy instead of being yanked into a specific child's view. The kid iPad still opens its `/u/<slug>` URL directly.

### Per-device default view (the child's iPad)

On the kid iPad, first launch asks **"Who uses this device?"** (Child / Parent / Therapist). When the answer is **child**, the device stores `aacDeviceRole = 'child'` in `localStorage` and `/` auto-bounces to `/u/<slug>` on every visit — that's the locked-in tablet behavior. Parent / therapist / admin devices land on the launchpad and choose where to go.

Override paths:
- `/?home` always shows the marketing landing page.
- Add `#board` to any URL to stay on the board for that visit.
- ⚙ Display → "Default view for this device" changes the saved role on the spot.
- Parent and Therapist views have a **"Change device default"** link in the header that clears the role and re-opens the chooser.

---

## The child's board (`app.html`)

The visible surface for Fletcher:

- **People · Nouns · Verbs** sections in a 3-column grid; each section has a category tab strip and a tile grid (1 / 4 / 3 columns by default, configurable).
- **Needs strip** along the bottom — flat tiles, always-visible communication essentials (Hello, yes, no, hungry, etc.).
- **Tap-to-speak**: each tile plays its recorded or AI-generated phrase.
- **Edit mode** (parent unlocks via 🔒): per-tile ✎ badge, drag-to-reorder, plus a row of edit-only buttons (Play, Parent view, Therapist view, ⚙ Display).
- **🙋 Play with me** button on the board: Fletcher taps it → calls `/api/play-request` → APNs push to the parent ("Fletcher wants to play!") + the parent dashboard polls and shows a dismissible banner.
- **⚙ Display** (per-device, in `localStorage`):
  - Hide labels
  - Show/hide each section (People / Nouns / Verbs / Needs)
  - Tiles across (per main section)
  - Section colors (per main section + Needs)
  - **Header bar background + text colors**
  - **Default view for this device**
- Header layout: 🔒 lock (left) — MyWorld globe icon + "Fletcher's World" — 🙋 Play with me (right). All flank the title in one centered group. In **edit mode** the edit-only buttons appear on a second row below the title for a clean two-row header.

### Game / slideshow runtime

All five modes are driven on the tablet, launchable locally (board → ⚙ Play) or remotely (parent or therapist phone via `/api/live`):

| Mode | Behavior |
|---|---|
| **Self-Paced Matching** | Fletcher hears a word, taps the matching picture. Per-category, single or queued chain. |
| **Facilitated Matching** | The therapist/parent drives it from their phone — marks verbal/physical responses as Fletcher participates. Live state syncs over `/api/live`. |
| **Learn Slideshow** | Pictures cycle every N seconds with the recorded label spoken. Watch-only. Time-limited. |
| **Exposure Slideshow** | Same engine, gentle first-person labels ("I can see a …") for sensory exposure. |
| **Celebration** | Yellow-flower burst + recorded cheer, standalone. |

The tablet **baselines its live-command sequence on first poll** so a launch only ever runs when the tablet is actually on the board — no stale commands fire when Fletcher's app reopens later.

### Routines

The Routine Builder (in the parent dashboard) composes a multi-step routine (slideshow → game → celebration, any mix). The tablet runs the steps in order, advancing on each step's natural end:
- Slideshow: time limit triggers next step
- Matching game: end-celebration finishes → next step
- Celebration: ~4.4 s animation → next step
- Manual stop or remote `end` aborts the whole routine

Step with a too-thin category is skipped instead of stalling.

---

## Parent dashboard (`parent.html`)

The control surface for Andrew:

- **Analytics** — recent sessions, mastery by category, weekly summary.
- **Start a mode** — six launcher cards (Self-Paced / Facilitated Matching, Learn / Exposure Slideshow, Celebration, Routine Builder) that build a live command and POST it to `/api/live`. The scope picker is a **single hierarchical dropdown** (`Everything` / `All <section>` / `— Category` / `— — Subcategory`) — same shape as the kid-board's "What to practice". To chain games in order, use the Routine Builder. After sending, the launcher **waits for the tablet to confirm**: "Started on tablet ✓", or a clear reason it didn't (too few picture tiles in the chosen category, or tablet not on the board).
- **Saved games** — name a launcher setup and re-launch it in one tap (chip).
- **Saved routines** — name and re-launch composed multi-mode routines.
- **Routine Builder** — modal with ordered steps; add a step (mode + category + duration), reorder, save or "Run now".
- **Reward cheers + game music** — parent records the phrases; tablet plays a random one on a successful game end.
- **Scheduled prompts** — timed reminders and game invitations that fire on the tablet.
- **Daily schedule editor** (shared with therapist) — wake / breakfast / lunch / dinner, up to 6 snack times, and location blocks (home / school / therapy / daycare / friend / relative / other) with day-of-week toggles and a time range. Stored at `settings.schedule`; future triggers will key off this.
- **Organize the board** — full-screen workspace:
  - Collapsible top-level categories *and* subcategories (with tile-count badges); whole board opens **fully collapsed**.
  - Drag categories or tiles to reorder / reparent — including **across sections** (the dragged subtree's `section` updates).
  - **Multi-select tiles** via checkbox; drag any one of them to move the whole selection together.
  - **✎ on any tile / category / subcategory** opens the **full Add/Edit modal** in edit mode: change label, swap the image (regenerate from a new photo, or upload), regenerate the voice with a tweaked phrase, toggle Pin-to-top, flip keep-aspect, or delete. **+ tile / + Category / + subcategory** open the same modal in add mode. The voice section hides for categories. Add and Edit are the same surface on both the kid board and the parent organizer.
- **Review new tiles** — when a bulk photo import (from the iOS app or web) finishes, a panel at the top of the dashboard surfaces the AI-named tiles (art + a play-the-voice button + editable name / pronunciation) to confirm, rename, or remove. See *Making tiles from photos*.
- **Reference images for AI tile generation** — uploaded photos used as style/subject references for `/api/generate-image`.
- **Backup** — download a JSON of the entire board with images/audio base64-embedded.
- **Admin-only**: a `🧬 Taxonomy` link in the top-right opens the workbench at `/admin/taxonomy.html`. Surfaced only when `/api/auth/me` returns role `admin`; other parents never see it.

---

## Therapist views

The therapist surface has two pages:

### `/therapist` — roster home (`therapist-home.html`)

A grid of **child profile portraits** — one card per child the therapist has access to (the starred / pinned "me" tile from each child's People column, or the first People tile). Click a card to open that child's facilitator console at `/therapist/<slug>`. Children come from `GET /api/my-children`, which uses the `child_access` table (see *Multi-tenant access*). An empty roster prompts the therapist to ask a parent for an invite (planned).

### `/therapist/<slug>` — one child's console (`therapist.html`)

- **Live session control** — drives a facilitated matching game on the tablet (start/skip/next/end, mark correct verbal/physical responses) over `/api/live`.
- **Shared progress** — mastery by category, recent sessions.
- **Daily schedule editor** — same editor as the parent view; the SLP can fill in the child's routine and locations.
- **Change device default** link in the header.

---

## Multi-tenant access + therapist boards

The system is designed for one therapist to work with multiple children, and one child to have a parent + one or more therapists, while keeping each child's data scoped to the right people.

### Roster: who can see which child

The `child_access` table is a many-to-many link between `users` and `child_id`, with a `relation` ('parent' | 'therapist' | 'school_team') and `status` ('active' | 'pending'). Admins see every child. A user's roster comes from `GET /api/my-children` (returns each accessible child + a portrait).

Therapists and school team members join via the `access_requests` handshake (parent invites by email, choosing a role; the invitee accepts in-app or via the signed link in the email). The `invite_relation` column on `access_requests` carries the chosen role so accept-time creates the right `child_access` row. `school_team` is a peer of `therapist` for content authoring and `canEditContent` — the distinction surfaces as a separate audience bucket in the taxonomy (school-context skeleton tiles) and a different label in the parent's care-team roster.

### Content ownership: shared parent board vs. therapist custom boards

Every category and item carries `owner_user_id`:

- **NULL** = shared "parent board" content. Edit/delete: the child's parent(s) or admin.
- **`<uid>`** = a therapist's "custom board" content. The therapist who created it owns it; the child sees and uses it the moment it's created (no parent approval gate — **trust the therapist by default; if you wouldn't, that therapist shouldn't be seeing your child**).

### Parent override

A parent of the child can **remove a therapist's content from their child's view** — same access check as the therapist's own delete, just a softer UI verb. The reasoning: trust the therapist by default, but if a parent doesn't want something on their child's board, they have the authority.

Encoded in `api/_lib/access.js`:

- `canAccessChild(user, childId)` — read access to anything for that child.
- `isParentOf(user, childId)` — does this user have a `relation='parent'` row?
- `canEditContent(user, ownerUserId, childId)` — true if admin, or owner of the content, or parent of the child.

> **Status:** the helpers + roster + schema ship now. **Enforcement is being rolled out endpoint-by-endpoint** (sync → items/categories → live/child-settings → analytics/events). The custom-board editor for therapists ("Build a Custom Board") lands once enforcement is across.

---

## Native iOS app (SwiftUI) — `kid-ios/` (one binary, two modes)

A single SwiftUI binary in `kid-ios/` runs **both** the child board AND the native parent app, deciding at first launch via a "Who uses this device?" picker stored in `UserDefaults.deviceRole`. Switching later is two taps from either side's settings, so picking wrong is harmless. Therapist + admin + the Lab stay web by design.

The Swift project has its own [README](kid-ios/README.md). It calls the same `/api/*` endpoints as the web; auth is cookie-based via `URLSession` + `HTTPCookieStorage`. The Xcode project is generated from `kid-ios/project.yml` via [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen && cd kid-ios && xcodegen generate`).

### Child board mode

- The original kid-facing reason for the native rewrite — WKWebView's 300ms click delay, double-tap-to-zoom, and gesture fights make a child's taps feel sluggish; UIKit/SwiftUI gestures fire on touch-down with no delay.
- Edit mode (long-press the lock) carries **+ New tile**, **Add several from Photos** (background queue, up to 3 renders concurrent), **🧑 Parent app** (switch this device to the parent surface), and a Display sheet.
- Native game runtime: `GameController` dispatches all the modes (matching · learn / exposure slideshow · auditory comprehension · expressive naming · celebration). `SlideshowView` speaks the formed caption through `GameAudio.speak` → `SpeechCache`.
- `LiveSession` polls `/api/live` and routes commands to `GameController`. The `message` action (PRD §4.7) routes to a separate `MessageOverlayView` that renders the parent's text as a sentence strip — every token visible at once, the active tile scales up and the strip auto-scrolls to keep the speaking word centered, audio plays through tile sound when available else TTS.
- `AutoTeachRunner` polls `/api/auto-teach/next` every 5 minutes when the board is up; on a positive response it builds a `start` cmd with `scope: "slugs:<csv>"` and dispatches through the same live channel.
- Special-day celebrations check `/api/celebrate` on boot + visibility change; lazy-generate the personalized scene on the first open of the day; full-screen modal with parent-voice greeting; dismissal is keyed by `(year, event_key)` so re-opening the same day doesn't replay.

### Parent app mode

The home grid (`ParentHomeView`) lays out these cards, each one tap away:

| Card | What it does |
|---|---|
| **Add a tile** | `AddTileQueue` now uploads to the **durable `/api/tile-jobs`** queue (server renders + a cron guarantees completion — the photo can't be lost) and polls status. A single capture pauses on a pre-gen review (name + steering detail). Model picker includes Nano Banana (`gemini-2.5-flash-image`) default + Pro; background swatch picker; the child's house style guide drives the look. |
| **Family & people** | Add / replace / rename the reference faces (child, family, the doctor) anytime via `/api/persons` + the durable People-section pipeline. The post-onboarding home for reference photos. |
| **Quick board** | Presents the actual `BoardView` full-screen so the child can talk on the parent's phone if the iPad's not available. 1.2s long-press on the labeled "Hold to exit to Parent app" pill returns. |
| **Start a game** | Setup phase mirrors the web therapist console field-for-field: every mode + scope + range + sample + choices + time limit + slideshow seconds-per-image + label style (plain / first-person) + music override. When a game starts (from here or anywhere), `FacilitatorView` auto-pops as a fullScreenCover. |
| **Facilitator (auto-pop)** | Live target card, "Item N of M · X correct" progress, the three mark buttons (👆 Tapped · 🗣 Said · 🧸 Showed object — colors match the web), Skip · Next · End. Dismiss with "Hide"; reappears next time a session starts. |
| **Message the board** | Text → `/api/message-to-board` → tokenized server-side against every tile on the child's board (greedy-longest, so "I love you" resolves to one tile when one exists) → published through `/api/live` as `action: 'message'` → sentence-strip on the iPad. Preview shows the resolved token strip + matched/total. |
| **Stats** | Hub of five sub-pages — Top Words (ranked + share bars + day-range picker), Word History (search + range + paged event list), Game Accuracy (Swift Charts — per-category line AND per-mode line), How They Answer (stacked share bar + trend per method + accuracy per method), Mastery & Sessions. |
| **Schedules** | `child_settings.schedules` round-trip on raw dictionaries so question/game prompts authored on the web survive untouched. Toggle / delete / add a simple reminder. |
| **Album** | `/api/album?mode=by-tile` → folder hub: **People · Words · Verbs · Celebrations**. Open a folder → tile rows with version counts → open a tile → every version newest-first, "Current" badge on the live one. Holiday celebrations from every year land here automatically. |
| **Auto-teach** | Enable toggle + cadence picker + attention tier + daily game time + cooldown stepper. Live gate status: "Currently a teachable window · Cooldown clear · Today's exposure budget 6/18 min." 5-color stacked bar per category showing maintenance / mastered / acquired / active / unmet. |
| **Settings** | Current vocabulary band display + the parent unlock button, **"Make all tiles square"** (normalizes `keep_aspect` to the square-except-TV rule), device-mode switch back to child board, link to web dashboard, sign out, clear local cache (drops both image and speech caches). |

### Colors + branding

`Models/Brand.swift` mirrors the exact CSS custom properties from `therapist.html` / `parent.html` (`--pink #ff1493`, `--pink-deep #ad1457`, `--good #16a34a`, plus the tap/verbal/object mark inks `#1d4ed8 / #047857 / #6d28d9` the web console uses) so a facilitator toggling between web and phone never has to relearn a color cue.

App-wide `.preferredColorScheme(.light)` at the root pins the whole app to the light pink palette — necessary because the design uses fixed hex colors throughout and Dark Mode would flip `.primary`/`.secondary` text to white-on-white on the brand cards.

### Capacitor fallback

The Capacitor shell below stays in the repo as the parent/therapist surface and as a fallback for the kid surface until the native app is fully migrated.

---

## Personalization + the `persons` data model

The system distinguishes between **tiles** (board buttons) and **persons** (structured identities — relationship, side, given name, pronoun, birth_date, likeness anchor, voice key). A People-section tile is one rendering of a person; the person row is the canonical identity that backs it.

- **`persons.is_self = true`** — the child whose board this is. Carries `birth_date` (drives the age-band filter) and `advanced_to_band` (parent or mastery unlock).
- **Relationship + side** — `mother | father | grandmother | grandfather | brother | sister | aunt | uncle | guardian | …`, with `side: maternal | paternal` for the ones that need it. Drives the deterministic family phrasing in `_lib/relationships.js` (`familyPhrase()`): `"Grandma Jane is your grandma on your mom's side."`
- **`reference_key`** — the stylized portrait Blob key that anchors every subsequent generation involving this person. Set the first time the family captures a photo during onboarding (or the Lab's seed-persons), then reused as the `{reference}` token + likeness reference for every later tile gen.
- **`{family_adult}` token** — body parts and caregiving phrases generate better with the parent's face than the child's. The token resolves through `mother → father → step-parent → guardian → grandparent` with fallbacks to the child's own anchor and a generic adult, so every tile still renders.

The `generate-descriptions` endpoint consumes this structure directly: a People tile description doesn't ask the model "describe Grandma Jane" — it pulls the relationship + side + given_name and writes a deterministic line in the right family-facing wording. The model only handles non-people teaching descriptions.

**Managing the faces.** The child + a first grown-up are captured at signup; the grown-up step is **repeatable** (add the whole circle). After signup, the parent app's **Family & people** screen (`GET/POST/DELETE /api/persons`) lists everyone with a reference photo and lets a parent add / replace / rename them anytime — no re-onboarding. Adding a photo runs the durable People-section pipeline, which renders a style-consistent portrait, sets it as the person's `reference_key`, and upserts their one tile (so "replace photo" never duplicates). A photo dropped into the People section of add-a-tile registers a person the same way — so a new doctor becomes a referenceable anchor.

**House style + voice.** `child_settings.styleGuideId` pins the child's art style (a `style_guides` image) and `child_settings.voiceId` pins their TTS voice — both chosen in onboarding and used by every later generation/TTS, so a child's tiles stay visually and audibly consistent. (A parent-app picker to change these on an existing child is a follow-up; today they ride the onboarding choice or the first active Lab style guide.)

### Special-day events

`taxonomy.is_event = TRUE` rows are full-screen celebration scenes, not board tiles. Personalized with `{reference}` + `{family_adult}` + `{family_all}` and cached per `(child_id, event_key, year)` in `event_images`. Fourteen US holidays + a per-child birthday seeded by `taxonomy/fill-events.mjs`; the calendar resolver in `api/_lib/event-dates.js` handles fixed-date (Christmas), floating (Easter via Meeus, Mother's Day, Thanksgiving), and per-child birthday matching against `is_self.birth_date`.

The runtime in the SwiftUI iPad checks `/api/celebrate` on boot + visibility change; on a positive hit it lazy-generates and shows a full-screen modal with the parent-voice greeting. Every year's celebration is also archived into `item_image_history` with `source='event'` so the album folders include holidays alongside tile history.

### Developmental age bands

Every taxonomy row carries `acquisition_age` — one of `12-18m`, `18-30m`, `2-3y`, `3-4y`, `4y+` — backfilled by `taxonomy/fill-acquisition-age.mjs` from MacArthur-Bates CDI norms, Banajee core-vocabulary research, and Brown's grammatical stages. The `/api/sync` endpoint reads the `is_self` person's `birth_date` (and `advanced_to_band`) to resolve the child's current effective band and drops items whose linked taxonomy row sits above it. Personal tiles (no `taxonomy_slug`) are never filtered.

Two paths out of the floor band:
- **Manual unlock** — parent taps "Unlock next" in the parent app's vocabulary panel. POST `/api/advance-band` `{ reason: 'parent' }`.
- **Mastery auto-advance** — in the last 30 days, ≥ 10 `game_attempts` on tiles in the current band, all correct. POST `/api/advance-band` `{ reason: 'mastery' }` re-verifies server-side so a misbehaving caller can't bypass the data.

### Auto-teach

`api/_lib/auto-teach.js` is a deterministic, read-only picker that says "what should this child learn now?". Two channels — micro-exposure slideshows every N minutes (conservative default 60), one daily game at a parent-chosen time — each with their own gates:

- **Blackout** — outside `[wake, bedtime]`, during `breakfast/lunch/dinner ± 20 min`, or within a school location's day-of-week + time window
- **Recently active** — child has tapped something in the last 5 minutes
- **Cooldown** — 30 minutes since the last auto-trigger (configurable)
- **Budget** — daily exposure-minutes cap per attention tier (8 / 12 / 18 min for under-3 / 3-5 / 5+ on conservative; higher tiers on standard/intensive)
- **Game window** — game lane fires once per day at `dailyGameAt ± 15 min`

Tile picker priority: unmet age-band tiles → longest-gap active rotation → acquired-not-mastered → one stretch tile from the next band → one biweekly maintenance recheck. Mastery follows the clinical 80/90 rule (80% across 3 sessions = acquired; 90% across 3 + ≥ 5 days retention = mastered; mastered words drop into biweekly maintenance instead of being removed).

The iPad's `AutoTeachRunner` polls `/api/auto-teach/next` every 5 minutes when the board is up and dispatches via the same `/api/live` channel everything else uses, so the activity runs through the existing `GameController` path and the parent's `ParentLive` observable sees it as a normal session.

## Image generation — two-model split + the regeneration archive

The pipeline uses a deliberate **two-model split**. **Keystone images** — the onboarding people portraits and the no-people scene anchor, plus any family member added later — go through **OpenAI gpt-image** (`_lib/openai-image.js` → `openaiEditImage` on `/v1/images/edits`), because OpenAI is markedly better at copying an arbitrary **art style** from a reference, and the keystones set the look every other tile imitates. The production keystone model is whatever the **Portrait Lab** saved to `lab_settings.model_defaults.keystone` (resolved by `openaiKeystoneModel()`, default `gpt-image-1`); with no OpenAI key it falls back to Gemini Pro (`geminiProModel()`, `gemini-3-pro-image-preview`). **The bulk board** — the ~150 curated starter tiles and ongoing add-a-tile renders — runs on **Gemini Flash / "Nano Banana"** (`geminiDefaultModel()`, `gemini-2.5-flash-image`) via `_lib/gemini.js`, which is cheapest (~$0.04/image) and strongest at holding a person's likeness across many tiles, with the keystones attached as references. Lab/board-editor model selection also routes through `api/admin/model-routes` (per-scope rules) with per-request overrides. The `?bg=` param accepts presets (`pink | mint | yellow | blue | peach | white`) or any 6-digit hex.

**Reference intelligence.** What gets attached to a generation is chosen per tile, by role: the **style guide** image (the house style) is attached to *every* tile with "copy its art style only, not its content"; a **subject anchor** (the child's `reference_key` for child-subject tiles, a specific person for People tiles, the source photo for objects) carries likeness; the child photo is *never* used as a blanket "style." This is what makes a board consistent — the shared exemplar, not the text style word. All tile art targets **square 1:1** (`gemini.js` passes `imageConfig.aspectRatio` with a fallback that retries without it if the model rejects the field), and the inanimate-object "no cartoon faces" rule is applied to everything except People.

Every code path that overwrites `items.image_key` (parent edit, AI regenerate, Lab publish, onboarding re-photograph) calls `_lib/image-history.archivePriorImage` *first*, which snapshots the OLD key + label + section + source + who-archived-it into `item_image_history`. The Blob is never deleted — it's just invisible to the live board — so the parent's album view can scroll back through every face every tile has ever had. `ON DELETE SET NULL` on `item_id` so history outlives the tile it once belonged to.

## TTS caching (two-tier)

`/api/tts` now hashes `(model | voice | emotion | text)` → sha256[:40] and stores the MP3 bytes in private Vercel Blob at `tts/<hash>.mp3`. Cache hits return with `X-TTS-Cache: HIT` and a one-year immutable `Cache-Control`. The same hash recipe drives a per-device `SpeechCache` actor on the iPad under `Documents/speech/<hash>.mp3`, so the first slideshow caption pays the network round-trip and every subsequent playback is a local disk read. ElevenLabs is hit AT MOST ONCE per unique phrase across all users for the cache lifetime. Force-refresh via `?nocache=1` for the Lab.

## Making tiles from photos

Turning a real photo into a board tile is a first-class flow on every surface. The iOS path is now a **durable, server-side pipeline** (`_lib/tile-jobs.js`); the web still uses the synchronous chain.

**Durable pipeline (iOS add-a-tile):**

1. **`POST /api/tile-jobs`** (raw photo bytes) — persists the photo to Blob + inserts a `tile_jobs` row, returns the id immediately. **The photo is safe the instant this returns**, regardless of what happens to the device. Fires a best-effort render right away.
2. The server runs the chain from the durable source: vision **name** (only when the parent didn't type one) → **style-consistent art** (the child's house style-guide image + the source photo) → **voice** (the child's chosen voice) → **create the board item** (linked by `taxonomy_slug` where relevant).
3. **`/api/cron/run-tile-jobs`** (every minute) drains `queued` jobs, re-runs ones whose in-request render died, and retries `failed` jobs up to 3× — the completion guarantee. On the final attempt it **save-firsts** the raw photo as the tile (flagged `needs_review`) so a tile always lands.
4. The iOS tray **polls** `GET /api/tile-jobs?childId=` and reconciles on open, so in-flight jobs survive an app restart.

Phonetic-pronunciation generation was **removed** — TTS speaks the title; a parent's typed name **always supersedes** the AI's, and a wrong-sounding name is just respelled. A single capture pauses on a **pre-generation review** sheet (override the name, add an optional steering detail) before generation starts.

### Where it shows up

- **Web, single tile** (`parent.html` organizer + `app.html` edit mode): *photo first* — tap the magic button and the label auto-fills; you review and Save. `/api/generate-image` now attaches the child's **style-guide image** for board-consistent art.
- **Web, bulk folder** (`app.html`): pick a folder of images; each is named + illustrated into an editable list you review before saving as a category.
- **Native, single tile** (iOS → **Add a tile**): system camera or Photos → the pre-gen review sheet → the durable pipeline. A People-section photo also registers/refreshes a `persons` row.
- **Native, bulk import** (iOS → **Choose photo(s)**): multi-select up to 50; each photo becomes a durable job (the server gates concurrency, so a 20-photo batch doesn't fire 20 generations at once) and auto-adds to the board as it finishes — keep snapping without waiting on a render.

### The review queue (`items.needs_review`)

Bulk-imported tiles land on the board immediately (the child sees them right away) but are flagged **`needs_review = true`** — one server-side flag that powers a review pass on *both* surfaces:

- **Native**: when a whole batch finishes rendering, a **"✨ N new tiles ready — Review"** banner pops on the board (even if the Add-Tiles sheet was closed). It opens a review sheet — each tile's art, a ▶ to hear its voice, and editable name + pronunciation.
- **Web**: a matching **"New tiles to review"** panel at the top of the parent dashboard.

On either, **Save & confirm** clears the flag (`PUT /api/items` with `needsReview:false`) and re-records the voice for anything renamed; per-tile Remove deletes it. Single-tile adds (web or native) are never flagged. The column is additive — run `POST /api/init` once after deploy to apply it.

---

## Capacitor iOS shell (parent / therapist / fallback)

`capacitor.config.json` points the WKWebView at the live URL:

```json
{
  "appId": "io.andrewpeterson.myworld",
  "appName": "My World",
  "server": { "url": "https://aac.andrewpeterson.io/u/fletcherpeterson" },
  "ios": { "contentInset": "never" }
}
```

That means **web/CSS changes ship the moment they hit Vercel** — no iPad rebuild needed. The native shell only needs a rebuild when:

- `capacitor.config.json` changes (run `npx cap sync ios` first, *then* Xcode Run)
- Native plugins are added (e.g. `@capacitor/status-bar`)
- `Info.plist` keys change

### Recommended `Info.plist` keys

These are not in the repo (the iOS project lives outside it) but should be set on the Xcode side:

```xml
<key>UIStatusBarHidden</key><true/>
<key>UIViewControllerBasedStatusBarAppearance</key><false/>
<key>UIApplicationSupportsShakeToEdit</key><false/>   <!-- kills "Undo Typing" popup -->
<!-- REQUIRED for the "make a tile from a photo" camera/library pickers to work in
     the native app — without these the WKWebView file input silently does nothing: -->
<key>NSCameraUsageDescription</key><string>Take a photo to make a picture tile.</string>
<key>NSPhotoLibraryUsageDescription</key><string>Choose a photo to make a picture tile.</string>
```

### `@capacitor/status-bar` plugin

iOS sometimes re-shows the status bar after a system view dismisses (color picker, file picker). The web app calls `Capacitor.Plugins.StatusBar.hide()` on focus / page show / after any color/file input change — but the call is a no-op unless the plugin is installed. To enable:

```bash
npm install @capacitor/status-bar
npx cap sync ios
# then Clean Build Folder + Run in Xcode
```

---

## Architecture

### Storage layers

| Layer | What's there |
|---|---|
| **Neon Postgres** | `categories`, `items`, `live_sessions`, `child_settings`, `push_tokens`, `play_requests`, `interactions`, `game_attempts`, `persons`, `item_image_history`, `event_images`, `exposure_protocols`, `exposure_events`, etc. — source of truth |
| **Vercel Blob** | Image and audio bytes (tile images, recorded sounds, reference photos) |
| **`child_settings.settings` JSONB** | Free-form per-child: `rewards`, `schedule`, `gamePresets`, `routines`, `gameResultsPush`, scheduled prompts |
| **IndexedDB (tablet)** | Local cache of tiles + media so the board works offline once seeded |
| **`localStorage`** | Per-device prefs: `aacDisplay`, `aacDeviceRole`, `aacGameSettings`, `aacOrgCollapsed`, `aacStyle`, `aacToken`, `aacSeenPlayReq` |

### Auth

- Anonymous traffic must first redeem an invite code (`/welcome`) — `lib/session.js` signs a short cookie. After login, a `mw_session` cookie controls access.
- `middleware.js` gates everything except `api/*`, `login`, `reset`, `welcome`, and static asset directories.
- Roles: `admin` / `parent` / `therapist` / `child` — verified server-side in `_lib/auth.js`.
- `_lib/access.js` adds per-child gating: `canAccessChild` / `isParentOf` / `canEditContent` drive multi-tenant scoping for the data endpoints. Roster lives in `child_access`; invite/request handshake in `access_requests`.
- Login does **not** auto-redirect by role. It honors `?next=` (used by middleware when it bounces an unauthenticated request), otherwise shows a launchpad of role-appropriate links — parent dashboard, child board, **Set up a new child (onboard)**, admin taxonomy, therapist roster.

### Live facilitator protocol (`/api/live`)

A single row per child holds the latest `cmd` (sequence-numbered) + the tablet's `payload` (current target / status / age). Both the phone view and the tablet poll it.

Commands carry: `action` (start / mark / skip / next / end), `mode`, `scope` or `scopes[]`, `choices`, `limitMin`, `secondsPerImage`, `labelStyle`, `music`, `steps[]` (for routines).

### Push (APNs)

`api/_lib/apns.js` builds an ES256 JWT from the `.p8` key and posts to Apple's HTTP/2 endpoint directly — no SDK. Triggered by:
- `api/play-request` — "Fletcher wants to play!"
- `api/game-log` (when `auto && gameResultsPush`) — scheduled-game scores
- `api/interactions` — question prompts

### Pages and routes

`vercel.json`:

```
/u/:slug         → app.html             (the child's board)
/parent/:slug    → parent.html
/therapist       → therapist-home.html  (roster of children the therapist sees)
/therapist/:slug → therapist.html
/login           → login.html
/reset           → reset.html
/welcome         → welcome.html
/onboard/:slug   → onboard.html
/onboard         → onboard.html
```

---

## Taxonomy — the canonical word/tile library

The taxonomy sits one layer above any one child's board: a **global, admin-curated template** that says "these are the words a brand-new child can start with, how each should be drawn, and which ones are part of the starter set." Per-child boards (`categories` + `items`) are *instances* of this template — same slugs across every child, only the media is personalized.

Edited at **`/admin/taxonomy.html`** (admin role enforced on every `api/admin/taxonomy*` endpoint). Stored in the `taxonomy` table; every import / bulk op auto-snapshots, with a full audit log.

### Row fields

| Field | Meaning |
|---|---|
| `id` | Stable slug, dot-separated lowercase: `nouns.food.drinks.milk`. The invariant cross-child anchor. |
| `column` | `People` / `Nouns` / `Verbs` / `Needs` (maps to the board sections). |
| `category`, `subcategory` | Hierarchy (free text). |
| `label` | The word shown on the tile. |
| `pronunciation` | TTS override (e.g. `Cheery-ohs`). |
| `subject_mode` | `child_as_subject` / `person` / `object` / `concept`. |
| `parent_photo_behavior` | `override` (the subject IS an uploaded photo, e.g. Mom) / `supplement` / `none`. |
| `prompt_template` | Image-generation prompt with `{style}`, `{reference}` (the child), `{parent_photo}` tokens. |
| `phase` | Rollout grouping: `v1_core` / `v1_extended` / `v2` / `later`. |
| **`core`** | `true` = part of the baseline standard vocabulary; `false` = grows in later. A whole category/subcategory is "non-core" when its tiles are — flip a group at once via the toolbar filter + **Bulk action → Mark (non-)core**. |
| `status` | `draft` (invisible to generation) / `published`. |
| `notes` | Admin/SLP guidance; current home for scene hints like `Scene: pantry` (graduates to a real `scene_tags` column later). |
| **`audience`** | Who the tile is for: `universal` (every child) / `parent` / `therapist` / `school_team` / `family`. Filters what each role sees in their authoring tools so a teacher gets school-context skeletons, an SLP gets clinical skeletons, etc. |
| **`authoring_kind`** | `canonical` = a real tile that ships as-is. `personal_skeleton` = a template that prompts a parent/therapist/teacher to author their own version from a photo ("train the trainers"). Skeletons are filtered out of standard tile generation but surface in the relevant authoring UI. |

### Drafted seed

`taxonomy/seed-core-v1.csv` is an importable starter (~1,100 rows). Sized for TD Snap Core First parity at launch (grammar layer + topic categories), informed by walking through a typical day from waking to bed, and spot-checked against TD Snap's symbol library for the high-frequency long tail a 3-7yo would actually reach for. Covers:

- **People**: Family, Community, Therapy Team, Pronouns (full set incl. him/her/his/hers/these/those)
- **Needs**: Core requesting strip; Feelings; Social (incl. ~38 conversational gestalts split into universal-daily, family-only, and a base set); Describing (incl. weather + core descriptors good/bad/same/different/full/empty/heavy/light); Asking (question words); Linking (helping verbs incl. am/are/was/have/has/had/could/would; conjunctions; negation incl. not/don't); Prepositions; Quantifiers (all/some/many/few/much/any/none/every); Time (incl. hours 1-12, clock concepts, months, seasons); **Numbers 1-100**; Alphabet A-Z; Holidays; Classroom social (raise hand, may I, quiet please, …)
- **Verbs**: Core actions + extras (kiss, climb, hop, skip, swim, blow, paint, dig, splash, color, cut, glue, pour, stir, ride, fly, fall, fix)
- **Nouns**: Food (Drinks/Fruit/Veg/Snacks/Meals + Treats/Condiments/Breakfast); Toys (+ Extended for building bricks, dollhouse, kite, jump rope, play dough, …); Home (+ Kitchen appliances: refrigerator/oven/stove/microwave/sink/dishwasher/blender/toaster + Bathroom: toothbrush/toothpaste/comb/brush/mirror/shampoo/shower/faucet); Body (+ Face: eyebrow/eyelash/freckle/dimple/beard/wrist); Clothes (+ T-shirt/jeans/sweater/jacket/scarf/mittens/beanie/baseball cap/sneakers/rain boots); Animals (Pets/Farm/Jungle/Sea/Forest/Polar/Bugs/Dinosaurs); **Vehicles** (Emergency/Work/Personal/Air & Sea, ~25 total); Nature (+ Plants + Sky/space: cloud/planet/comet/astronaut/galaxy); Places (+ Outdoor: sandbox/swing/slide/sprinkler/hose/sidewalk/driveway/mailbox); Colors (10 + 8 extended); Shapes (14); **Sports** (~12); **Musical instruments** (~10); **Tools** (~7); School (basics + extended)
- **~45 personal_skeleton rows** — authoring prompts surfaced only in the matching role's "build a board" flow (school team sees Fire Drill / Field Trip / Picture Day; therapists see Therapy Room / Reinforcer / Visual Schedule; parents see Bedtime / Grandma's House / Comfort Object; everyone sees the media placeholders for "my show" / "my song")

Audience-scoping: the canonical library is mostly `universal`, but a small set of family-context tiles ("I love you", "I miss you", goodnight kiss, snuggle, cuddle, tickle, piggyback, carry me, hold me, one more book, tuck me in) are `audience='parent'` — the tiles exist for the child to use anywhere, but only the parent role sees them as suggested tiles when building a board. A similar small school-context set (raise hand, may I, circle time, …) is `audience='school_team'`.

Generated by `taxonomy/build-seed.mjs` from structured vocabulary + one shared prompt formula, so every tile shares the same composition / quality / safety rules and only the per-item subject varies. Regenerate with `node taxonomy/build-seed.mjs`.

### Importing the current board

**Import live board…** in the workbench calls `POST /api/admin/taxonomy-import-board?childId=<slug>` — pulls a child's existing categories/items into the taxonomy as `draft` rows with derived slugs + default prompts. Snapshot-first; inserts new ids only.

---

## Lab — the tile-art QC studio (`/admin/lab.html`)

The Lab is where admin turns taxonomy rows into the actual artwork that lands on a child's board. It sits one step downstream of the Workbench: Workbench edits *what tiles exist and how they should be prompted*; Lab generates **candidates**, lets you compare them, and **pushes the winner live** to a chosen child's board. Admin role enforced on every `api/admin/lab-*` endpoint.

### The four header panels

| Panel | Purpose |
|---|---|
| **Style guides** | Upload reference images that define the house art style (line, palette, finish). Each card has Active/Inactive + sort order. `POST /api/admin/style-guides` registers an upload; `PATCH` toggles active / renames / reorders. |
| **Master prompt** | One editable template that wraps every generation. Supports tokens `{content} {label} {size} {no_face_rule} {style_image} {reference}`. Saved via `PUT /api/admin/lab?action=settings`. |
| **Model routes** | Scope-based defaults (e.g. `category=Food → gpt-image-1.5`). The generator falls back to these when no per-call override is given. CRUD via `/api/admin/model-routes`. |
| **Board categories** *(see below)* | Per-child chip status + Upload/Generate. |

### How generation actually works

A generation **is not** plain text-to-image — when an active style guide exists, the request goes to OpenAI's **`/v1/images/edits`** endpoint with the style image as the visual reference (`input_fidelity: high` on gpt-image-1/1.5). With no active guide, it falls back to plain `/v1/images/generations`, which is why an empty Style Guides panel produces visually inconsistent tiles. Every candidate is written to Vercel Blob, logged in `tile_generations` (the QC strip), and in `image_generations` (cost log).

### Board categories panel

A list of every category/subcategory chip the library implies (distinct `(section, category[, subcategory])` from `taxonomy`), joined against the **target child's** existing `categories` rows. Each row shows status — ✓ chip+image / ⚠ chip, no image / — not on board yet / ⚠ need parent first — plus per-row **⬆ Upload** and **✨ Generate**. Direct-to-board (no candidate strip — a chip is one image, not a styles comparison). Endpoints: `GET /api/admin/lab-categories`, `POST /api/admin/lab-category-upload`, `POST /api/admin/lab-category-generate`.

**Order matters: create category chips here BEFORE generating tiles in that category — publish blocks otherwise.**

### Tile walker (per-row composer)

The body of the page is one card per taxonomy row, paginated. Each card carries:

- **Content prompt / Teaching clues / Model override** — edit and Save.
- **Generate (current style)** / **Generate ALL active** — fan out one candidate per active style guide so you can ★ the winner.
- **⬆ Upload image** — attach an image you made elsewhere as a candidate (no OpenAI cost).
- **🚀 Push live** — copies the ★ best candidate to the chosen child's board (`POST /api/admin/lab-publish-tile`). Blocks with a clear error if the category chip doesn't exist yet.
- **⬇ Port from board** — pull the child's existing board image back into the strip as a candidate.
- **🎭 Scene / people** — the variable subject composer (see below).

The 🚀 **Board:** field in the header is the publish target for the whole page; switching it refreshes board state and the categories panel.

### Scene composer — variable subjects + style

A generation is **one style + an ordered list of subjects**. Each subject resolves its own image source independently, so one composer handles the full matrix of *"new vs. matching prior art"* × *"one vs. many people"*:

| Source type | Means | Comes from |
|---|---|---|
| `person` | Match this person's likeness | `persons.reference_key` (set by onboarding / `seed-persons`) |
| `photo` | Stylize a freshly uploaded photo | `POST /api/upload` → `blobKey` |
| `tile` | Match a prior generated tile's art | `tile_generations.blob_key` *(UI picker still TODO)* |
| `fresh` | No reference, text only | — |

Wire-level, the endpoint builds an ordered `image[]` (style first, then each subject) and slots them into the prompt by position (*"image 2 is Person A; image 3 is Person B…"*), so the model keeps each likeness attached. Faces are allowed here — the object-tile `no_face_rule` deliberately does not apply. Endpoint: `POST /api/admin/lab?action=generate-scene`.

**Known limit:** multi-face likeness in a single edits call can blend identities on current gpt-image models, even with `input_fidelity: high`. If two-person scenes blur identities in practice, per-subject passes / compositing will slot into the same contract — no UI change needed.

### Recommended flow for a fresh child

1. Pick the **🚀 Board:** target in the header.
2. Upload at least one reference image to **Style Guides** and mark it Active.
3. Walk the **Board categories** panel (toggle *"only missing or no image"*) and create every chip you need.
4. Open the tile walker, generate candidates, ★ the best, **🚀 Push live**.
5. For tiles that need real people, use the **🎭 Scene / people** composer instead of plain Generate.

---

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/sync` | Pull all categories + items for a child |
| `POST/PUT/DELETE /api/items` | Tile CRUD (cross-section moves via `section`; `needsReview` flag drives the bulk-import review queue) |
| `POST/PUT/DELETE /api/categories` | Category CRUD (PUT with `section + cascade:true` rewrites whole subtree's section) |
| `POST /api/upload?kind=&ext=` | Upload an image/audio blob to Vercel Blob, returns `{ key }` |
| `GET /api/media?key=` | Stream a stored blob |
| `POST /api/generate-image?label=&style=&childId=&styleGuideId=` | Re-illustrate a photo (Gemini/OpenAI); attaches the child's house **style-guide image** for board-consistent, square output |
| `POST/GET/DELETE /api/tile-jobs?childId=` | Durable add-a-tile queue: POST raw photo (safe immediately) → server renders + places the tile; GET polls status; DELETE cancels |
| `GET /api/cron/run-tile-jobs` | Vercel cron (every minute): drains `tile_jobs`, retries stuck/failed jobs — the completion guarantee |
| `GET /api/cron/refresh-insights` | Vercel cron (daily 08:00): recomputes the per-child skill-insight narratives |
| `POST /api/tts?voiceId=\|childId=` | ElevenLabs TTS, returns `audio/mpeg`; resolves the child's saved voice from `childId` (explicit `voiceId` wins) |
| `GET/POST/DELETE /api/persons?childId=` | Reference-people CRUD (the Family & people screen): list, upsert name/relationship, delete |
| `GET /api/onboarding/styles` | Active style guides for the onboarding art-style picker (`?image=<id>` streams a preview) |
| `GET /api/onboarding/voices` | Account's ElevenLabs voices for the onboarding voice picker (with preview samples) |
| `GET/POST /api/onboarding/{state,child,family,scene,seed-core,complete}` + `style-upload` | Onboarding state machine: progress cursor → child (name/voice/style) → repeatable family **keystone portraits** (OpenAI, draft/retry/commit) → no-people **scene keystone** → chunked Core-tile render (Gemini Flash) → finish. `style-upload` stores a parent's custom style as an ephemeral guide |
| `POST /api/square-tiles?childId=` | Normalize tile `keep_aspect` to the board rule (square everywhere except a TV/Movies/Shows/Posters folder) |
| `POST /api/describe-image` | Vision-based image labeling helper |
| `GET/POST /api/child-settings?childId=` | Per-child settings JSON (rewards, schedule, presets, routines, prompts) |
| `GET/POST /api/live?childId=` | Live facilitator command + tablet payload room |
| `POST /api/game-log` | Record a session + attempts; optional push to opted-in parents |
| `POST /api/interactions` | Question-prompt answers; triggers push |
| `POST /api/play-request` | "Fletcher wants to play" — stamps + pushes parents |
| `POST /api/push-token` | Register an iOS device token for this user + role |
| `GET /api/events`, `/api/analytics`, `/api/usage` | Read-side dashboards |
| `GET /api/word-history?q=&since=&until=&limit=&offset=` | Searchable tap log (drives the Stats hub) |
| `GET /api/top-words?days=&limit=` | Most-tapped words, grouped by lowercase label, with count + first/last timestamps |
| `GET /api/input-methods?days=` | Tap / verbal / object / physical / gesture breakdown + bucketed trend |
| `GET /api/album?mode=timeline\|by-tile` | Memorabilia view: current image of each tile + every previously-archived version |
| `GET/POST /api/celebrate?childId=` | Today's special-day events for a child (GET); lazy-generate this year's image (POST `{eventKey}`) |
| `GET /api/manifest?child=` | Per-child PWA manifest so an installed app launches into the right slug |
| `GET/POST /api/advance-band` | Vocabulary-level state + parent-or-mastery unlock to the next acquisition band |
| `POST /api/onboard-subject?childId=&role=&name=` | Add one person from a photo (parent dashboard / onboarding "add family"): keystone-stylizes the portrait, registers a `persons` row + People tile, voices it in the child's voice |
| `POST /api/message-to-board` | Tokenize the parent's text against every tile on the child's board and publish a `message` cmd through the live channel |
| `GET /api/auto-teach/state?childId=` | Settings + gates ("blackout / cooldown / budget") + per-category mastery roll-up |
| `POST /api/auto-teach/next` | Picks the next batch of taxonomy ids to expose now, OR returns a refusal `{ok:false, reason}` |
| `GET /api/my-children` | Roster + portrait for every child the signed-in user has access to (drives `/therapist`) |
| `POST /api/access/invite` | Parent invites a therapist by email (Resend) |
| `GET /api/access/pending` | Pending invites the signed-in user can act on |
| `POST /api/access/respond` | Accept / decline an invite |
| `GET/DELETE /api/access/team?childId=` | Parent's team view; remove members or cancel pending |
| `GET /api/access/invite-probe?t=` | Token-gated email + hasAccount lookup for accept-invite page |
| `GET/POST /api/therapist/boards` | List my custom-board templates + create new ones |
| `GET /api/therapist/board?id=` | Fetch one board's categories + items (for the editor) |
| `GET/POST/DELETE /api/therapist/board-share?categoryId=&childId=` | Share / unshare a template; parent "remove from view" goes through DELETE too |
| `POST /api/auth/{login,logout,register,reset,reset-request,change-password,delete-account,apple}` + `GET /api/auth/me` | Account flow: `register` accepts `selfSignup` (web signup) or an `inviteToken` (team self-signup); `apple` = Sign in with Apple (RS256 JWT vs Apple JWKS); `delete-account` wipes the child's board + all media |
| `POST /api/init` | One-time schema bootstrap (idempotent) |
| **Admin-only** | |
| `GET/POST/PUT/DELETE /api/admin/taxonomy` | Canonical taxonomy **row CRUD** (the dispatcher's default; bare URL or `?fn=crud`) |
| `/api/admin/taxonomy?fn=<name>` | Taxonomy workbench **dispatcher** (one function, to stay under Vercel's 100-route limit). `fn=` one of: `bulk` (snapshot-first import), `bulkop` (bulk set status/phase/core/archived/delete), `import-board&childId=` (seed drafts from a child's board), `snapshots` (+`?action=restore\|diff`), `audit` (filterable log), `export-csv` (stream the seed-core-v1.csv shape), `prompt-versions` (per-tile prompt history + restore) |
| `/api/admin/lab?action=<name>` | Lab **dispatcher** (one function). `action=` one of: `generate` (one styled candidate for a row), `generate-scene` (multi-image: one style + ordered subjects), `batch-generate`, `category-generate` / `category-upload` (chip icons via `_lib/category-icons.js`), `categories` / `board-state` (walker context for a child), `upload-image` / `port-image` (attach/pull a candidate), `publish-tile` (copy the ★ best to a child's board), `settings` (GET/PUT master prompt + size + model defaults) |
| `POST /api/admin/portrait-lab` | Bench for the onboarding people-portrait generation — runs the exact production `buildPortraitPrompt()` + keystone pipeline, so what you see is what a parent gets |
| `GET/PUT /api/admin/keystone-model` | List this account's live `gpt-image-*` models; save the production keystone model into `lab_settings.model_defaults.keystone` |
| `GET/POST/PATCH/DELETE /api/admin/style-guides` | Register / toggle / reorder / remove style-reference images |
| `GET/POST/PATCH/DELETE /api/admin/model-routes` | Scope-based model defaults (category=…, subcategory=…, label=…) |
| `GET/PATCH/DELETE /api/admin/tile-generations` | The QC strip: list candidates, star the winner, set rating/notes, delete |
| `POST /api/admin/{seed-persons,seed-style-guides,normalize-tiles,backfill-taxonomy-slug}` | One-time / idempotent migration + seed utilities (run manually) |
| `GET /api/admin/board-tree?childId=` | Read-only board-vs-taxonomy diff (rename/merge planning) |

---

## Env vars (Vercel → Settings → Environment Variables)

| Var | What |
|---|---|
| `DATABASE_URL` | Neon Postgres pooled connection string (falls back to `POSTGRES_URL` / `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING` / `DATABASE_URL_UNPOOLED`) |
| `BLOB_READ_WRITE_TOKEN` | Auto-set when you create a Vercel Blob store |
| `SESSION_SECRET` | Random long string; signs `mw_session` + `mw_invite` cookies |
| `ADMIN_TOKEN` | Bearer token for admin-only endpoints (init, wipe) |
| `Fletchers_AAC_Device` | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | Optional, defaults to Rachel |
| `ELEVENLABS_MODEL_ID` | Optional, defaults to `eleven_turbo_v2_5` |
| `OPENAI_API_KEY` | **Keystone** image generation (onboarding portraits + scene, added family) + `/api/generate-image`, `/api/describe-image`, category icons |
| `OPENAI_KEYSTONE_MODEL` | Optional keystone-model override (default `gpt-image-1`; normally set live from the Portrait Lab) |
| `APNS_KEY_ID` | 10-char Key ID for the APNs `.p8` key |
| `APNS_TEAM_ID` | Apple Team ID |
| `APNS_BUNDLE_ID` | `io.andrewpeterson.myworld` |
| `APNS_PRIVATE_KEY` | Full `.p8` contents (BEGIN/END PRIVATE KEY) |
| `APNS_HOST` | Optional override (`https://api.sandbox.push.apple.com` for dev) |
| `RESEND_API_KEY` | Resend API key (used for therapist-invite emails) |
| `INVITE_FROM_EMAIL` | Verified Resend `From`, e.g. `My World <hello@aac.andrewpeterson.io>` |
| `APP_URL` | Public base URL for invite links (defaults to `https://aac.andrewpeterson.io`) |
| `PUBLIC_URL` | Alternate base-URL source for some links (falls back to `APP_URL`) |
| `APPLE_AUDIENCES` | Allowed audiences for Sign in with Apple JWT verification (falls back to `APNS_BUNDLE_ID`) |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Google AI key for Nano Banana image generation; created at <https://aistudio.google.com> |
| `GEMINI_IMAGE_MODEL` | Optional override for the default (Flash/bulk) Gemini model id (default `gemini-2.5-flash-image`) |
| `GEMINI_PRO_IMAGE_MODEL` | Optional override for the Gemini Pro model (keystone fallback when no OpenAI key; default `gemini-3-pro-image-preview`) |
| `IMAGE_GEN_DAILY_LIMIT` | Optional per-account daily image-generation cap (default 150; admins exempt) |
| `CRON_SECRET` | Optional bearer token Vercel sends to the cron handlers (`/api/cron/*`); when unset the idempotent handlers accept any call |

After deploying with the env vars set, hit `POST /api/init` once with the `ADMIN_TOKEN` to create the tables. The `tile_jobs` table (durable add-a-tile queue) self-creates on first use via `ensureTileJobs`; two crons are registered in `vercel.json` — **`run-tile-jobs`** (every minute) and **`refresh-insights`** (daily 08:00) — confirm they appear under Project → Settings → Cron Jobs after deploy.

---

## Development workflow

### Web (the common case)

- Push to the branch → Vercel deploys → the iPad shell picks up the change on next launch. No reinstall.
- Force-quit + reopen the app on the iPad to refresh the cached HTML if needed.

### Native iOS (rare — config / plugin / Info.plist changes)

From the iOS project folder on the Mac:

```bash
npx cap sync ios     # copies capacitor.config.json + plugins into the native project
npx cap open ios     # opens Xcode
```

In Xcode: select the iPad → Signing & Capabilities → set Team → ▶ Run.

To replace a build without going through iPad deletion (helpful with restricted child accounts): **Window → Devices and Simulators → select iPad → "Installed Apps" → remove via `−`** before re-running.

### TestFlight notes for child accounts

Child Apple IDs require **Ask to Buy** approval to install TestFlight itself. After the first approval, future TestFlight updates install automatically. Set the build's age rating to 4+ in App Store Connect so Screen Time restrictions don't block it.

---

## File structure

```
app.html              Kid board — the AAC grid + game/slideshow runtime
parent.html           Parent dashboard
therapist.html        Therapist (facilitator) console for one child
therapist-home.html   Therapist roster — grid of child portraits
login.html            Sign-in + post-login launchpad
index.html            Marketing landing + child-device auto-bounce
schedule-editor.js    Shared "Daily schedule" editor used by both dashboards
middleware.js         Invite gate + session gate (Edge middleware)
capacitor.config.json Capacitor iOS shell config
vercel.json           URL rewrites for /u/, /parent/, /therapist/, /welcome, etc.
sw.js                 Service worker
api/                  Vercel Serverless Functions (see table above)
  _lib/auth.js        checkAuth — verifies session cookie / Bearer token
  _lib/access.js      canAccessChild / isParentOf / canEditContent (multi-tenant)
  _lib/db.js          Neon SQL client + row mappers
  _lib/apns.js        Self-hosted APNs sender (HTTP/2 + ES256 JWT)
  _lib/gemini.js      Google Nano Banana provider (image generation)
  _lib/age-band.js    Birth date → developmental band; higherBand resolver
  _lib/event-dates.js Calendar resolver for holiday + birthday events
  _lib/relationships.js  Relationship taxonomy + familyPhrase deterministic phrasing
  _lib/image-history.js  archivePriorImage helper — every regeneration call goes through this
  _lib/auto-teach.js  Shared core: settings, gates, tile picker, mastery roll-up
  my-children.js      Roster endpoint for the therapist home
  auto-teach/state.js, next.js   Auto-teach orchestrator endpoints
  admin/taxonomy*.js  Taxonomy workbench backend (CRUD, bulk, snapshots, audit, board-import)
admin/taxonomy.html   Taxonomy workbench (Tabulator-based editor)
taxonomy/             Canonical word list — README, build-seed.mjs, seed-core-v1.csv
  fill-acquisition-age.mjs      Developmental band per row from CDI/Banajee/Brown's
  fill-events.mjs               14 holiday + per-child birthday Event rows
  fill-persona-symbols.mjs      Persona personalization + conventional symbol layer
  fill-descriptions.mjs         Hand-authored teaching descriptions (function words sheet)
  content/                      Hand-authored content sheets (.md) read by fill-descriptions
kid-ios/              Native SwiftUI app — one binary, child board AND parent app
  MyWorld/MyWorldApp.swift      App root, environment wiring
  MyWorld/ContentView.swift     Role gate → BoardView | ParentHomeView | RolePicker
  MyWorld/Models/               DeviceMode, Brand, TileBackground, Tile, Category, Schedule, …
  MyWorld/Views/                BoardView, MessageOverlayView, AddTileView, …
  MyWorld/Parent/               Parent home + every parent sub-page (Stats hub, Album, Auto-teach, …)
  MyWorld/Live/                 LiveSession, GameController, Scheduler, AutoTeachRunner
  MyWorld/Audio/                GameAudio + SpeechCache (TTS disk cache)
  MyWorld/Storage/              BoardStore, MediaCache, AddTileQueue, ImageDownscale
  MyWorld/Assets.xcassets/      AppIcon + MyWorldLogo imageset (note: *.xcassets/**/Contents.json
                                must NOT be gitignored — see .gitignore exceptions)
icons/                App icon + MyWorld globe used in the header
audio/                Background music tracks for games
cap-shell/            Capacitor webDir stub (the real content is served from the URL)
lib/                  Shared session signing helpers (session.js)
styles/               Shared CSS
```

---

## Privacy

`.gitignore` keeps personal media out of the repo:
- `Images/`, `Sounds/` — local source pile
- `*.json` backups (contain base64 media)
- `.claude/`

All photos / audio of real people live in Vercel Blob behind authenticated `/api/media`.

---

## Known limitations & follow-ups

### Security baseline (shipped)
- **Cross-child IDOR closed.** `canAccessChild` and `isParentOf` now gate every child-scoped endpoint (`sync`, `analytics`, `events`, `interactions`, `live`, `play-request`, `game-log`, `persons`, `child-settings`, `skill-insights`, `onboard-subject`, `generate-image`, `generate-descriptions`, `push-token`, `exposure-*`).
- **Media gated by ownership.** `/api/media` does a one-UNION lookup over `items`/`categories`/`persons`/`reference_images`/`pending_tiles`, requires access to at least one owning child, fails open on DB error so the board never goes dark from a guard bug.
- **All `api/admin/*` admin-gated.** `taxonomy-snapshots` and `taxonomy-audit` were the two gaps; closed with `requireAdmin`.
- **Image-gen spend cap.** Per-account rolling-24h limit (env `IMAGE_GEN_DAILY_LIMIT`, default 150; admins exempt).
- **XSS escaped in parent/therapist dashboards.** Category names and person display_names were rendered via `innerHTML` and could fire cross-user; wrapped in `schEsc`.

### In-flight
- **App onboarding flow** — the next focus area; the existing `onboard.html` captures the child's photo + birth date + family, but the flow needs a polish pass and a per-app entry-point for the SwiftUI parent app's first run.
- **Parent ↔ therapist invite/request UI.** Schema and helpers exist; therapist-facing accept/decline UI is next.
- **Therapist "Build a Custom Board" editor.** Ownership column shipped; the editor lands after onboarding polish.

### Open / deferred
- **Pre-naming a bulk import.** A parent's name / pronunciation supersedes the AI in the *review* step, not before the AI runs; a per-photo "name these first" grid is a possible add. Pronunciation is consumed by TTS at save time, not stored as its own column, so re-recording a voice means re-typing the pronunciation.
- **Status bar / contentInset** behavior on iOS depends on the Info.plist + the `@capacitor/status-bar` plugin being installed; see the iOS section.
- **Scheduled-prompt triggers off `settings.schedule`** (board chooses what to show based on time + location) is intentionally not wired yet — the editor captures the data; the runtime is next.
- **Per-concept mastery & progressive growth.** `game_attempts.category` currently stores the section, not the canonical taxonomy slug — once tiles carry `taxonomy_slug`, mastery rolls up per concept and drives "grow the board as the child masters levels."
- **Scene tags for "snap your pantry."** Taxonomy rows park scene hints in `notes` for now (`Scene: pantry`); will graduate to a real `scene_tags` column + a scenes table.
- **Multi-device race on `child_settings`**: it's a full-blob replace, so simultaneous edits from two devices can lose updates. In practice this is rare; the parent and the therapist rarely edit settings at the same moment.

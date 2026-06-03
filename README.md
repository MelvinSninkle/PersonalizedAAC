# Personalized AAC — "Fletcher's World"

A communication and learning app built for one specific non-verbal toddler who is a gestalt language processor. It's a multi-view web app (kid board + parent dashboard + therapist view) deployed on Vercel, with a thin Capacitor iOS shell that loads the live site so the iPad picks up web changes instantly.

> The app started as a single-file HTML AAC board. It has since grown into a full system covering communication, structured games, scheduling, and remote facilitation. This README documents the current shape — see git history for the journey.

---

## The views

| Path | Audience | What it is |
|---|---|---|
| `/u/<slug>` | The child (tablet) | The AAC board itself — People · Nouns · Verbs grid + a Needs strip + the game/slideshow/celebration runtime |
| `/parent/<slug>` | Parents | Dashboard: analytics, mode launcher, organizer, schedule editor, reward cheers, scheduled prompts, reference images, backup |
| `/therapist` | SLP / facilitator (multi-child) | Roster home — a grid of child profile portraits for every child the therapist has access to; click one to enter that child's `/therapist/<slug>` |
| `/therapist/<slug>` | SLP / facilitator (one child) | Live facilitator console (drives a game on the iPad), plus the shared schedule editor and progress view |
| `/admin/taxonomy.html` | Admin | The canonical word/tile library workbench (curated word list shared across all children) |

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

## Native iOS shell (Capacitor)

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
| **Neon Postgres** | `categories`, `items`, `live_sessions`, `child_settings`, `push_tokens`, `play_requests`, `interactions`, `game_attempts`, etc. — source of truth |
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

`taxonomy/seed-core-v1.csv` is an importable starter (~600 rows): People, Needs (incl. Feelings/Social/Describing/Asking/Linking/Time/Numbers/Alphabet/Holidays + 22 conversational gestalts), Verbs, and Nouns across Food/Toys/Home/Body/Clothes/Animals (Pets/Farm/Jungle/Sea/Forest/Polar/Bugs/Dinosaurs)/Vehicles/Nature/Plants/Places/Colors/Shapes/School. Generated by `taxonomy/build-seed.mjs` from structured vocabulary + one shared prompt formula, so every tile shares the same composition / quality / safety rules and only the per-item subject varies. Regenerate with `node taxonomy/build-seed.mjs`.

### Importing the current board

**Import live board…** in the workbench calls `POST /api/admin/taxonomy-import-board?childId=<slug>` — pulls a child's existing categories/items into the taxonomy as `draft` rows with derived slugs + default prompts. Snapshot-first; inserts new ids only.

---

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/sync` | Pull all categories + items for a child |
| `POST/PUT/DELETE /api/items` | Tile CRUD (supports cross-section moves via `section`) |
| `POST/PUT/DELETE /api/categories` | Category CRUD (PUT with `section + cascade:true` rewrites whole subtree's section) |
| `POST /api/upload?kind=&ext=` | Upload an image/audio blob to Vercel Blob, returns `{ key }` |
| `GET /api/media?key=` | Stream a stored blob |
| `POST /api/generate-image?label=&style=&childId=` | OpenAI re-illustration of a photo (uses reference images for steering) |
| `POST /api/tts` | ElevenLabs TTS, returns `audio/mpeg` |
| `POST /api/describe-image` | Vision-based image labeling helper |
| `GET/POST /api/child-settings?childId=` | Per-child settings JSON (rewards, schedule, presets, routines, prompts) |
| `GET/POST /api/live?childId=` | Live facilitator command + tablet payload room |
| `POST /api/game-log` | Record a session + attempts; optional push to opted-in parents |
| `POST /api/interactions` | Question-prompt answers; triggers push |
| `POST /api/play-request` | "Fletcher wants to play" — stamps + pushes parents |
| `POST /api/push-token` | Register an iOS device token for this user + role |
| `GET/POST /api/reference-images` | Manage style/subject reference photos |
| `GET /api/events`, `/api/analytics`, `/api/usage` | Read-side dashboards |
| `GET /api/my-children` | Roster + portrait for every child the signed-in user has access to (drives `/therapist`) |
| `POST /api/access/invite` | Parent invites a therapist by email (Resend) |
| `GET /api/access/pending` | Pending invites the signed-in user can act on |
| `POST /api/access/respond` | Accept / decline an invite |
| `GET/DELETE /api/access/team?childId=` | Parent's team view; remove members or cancel pending |
| `GET /api/access/invite-probe?t=` | Token-gated email + hasAccount lookup for accept-invite page |
| `GET/POST /api/therapist/boards` | List my custom-board templates + create new ones |
| `GET /api/therapist/board?id=` | Fetch one board's categories + items (for the editor) |
| `GET/POST/DELETE /api/therapist/board-share?categoryId=&childId=` | Share / unshare a template; parent "remove from view" goes through DELETE too |
| `GET/POST /api/auth/{login,logout,me,register,reset,reset-request}` | Account flow (register accepts an `inviteToken` for self-signup) |
| `POST /api/init` | One-time schema bootstrap (idempotent) |
| **Admin-only** | |
| `GET/POST/PUT/DELETE /api/admin/taxonomy` | Canonical taxonomy CRUD |
| `POST /api/admin/taxonomy-bulk` | Bulk import (CSV/JSON parsed client-side, snapshot-first) |
| `POST /api/admin/taxonomy-bulkop` | Bulk set status / phase / core / archived / delete |
| `POST /api/admin/taxonomy-import-board?childId=` | Seed the taxonomy from a child's live board as drafts |
| `GET/POST/DELETE /api/admin/taxonomy-snapshots` | Manual snapshots + restore + diff |
| `GET /api/admin/taxonomy-audit` | Filterable audit log |

---

## Env vars (Vercel → Settings → Environment Variables)

| Var | What |
|---|---|
| `DATABASE_URL` | Neon Postgres pooled connection string |
| `BLOB_READ_WRITE_TOKEN` | Auto-set when you create a Vercel Blob store |
| `SESSION_SECRET` | Random long string; signs `mw_session` + `mw_invite` cookies |
| `ADMIN_TOKEN` | Bearer token for admin-only endpoints (init, wipe) |
| `Fletchers_AAC_Device` | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | Optional, defaults to Rachel |
| `ELEVENLABS_MODEL_ID` | Optional, defaults to `eleven_turbo_v2_5` |
| `OPENAI_API_KEY` | For `/api/generate-image` + `/api/describe-image` |
| `APNS_KEY_ID` | 10-char Key ID for the APNs `.p8` key |
| `APNS_TEAM_ID` | Apple Team ID |
| `APNS_BUNDLE_ID` | `io.andrewpeterson.myworld` |
| `APNS_PRIVATE_KEY` | Full `.p8` contents (BEGIN/END PRIVATE KEY) |
| `APNS_HOST` | Optional override (`https://api.sandbox.push.apple.com` for dev) |
| `RESEND_API_KEY` | Resend API key (used for therapist-invite emails) |
| `INVITE_FROM_EMAIL` | Verified Resend `From`, e.g. `My World <hello@aac.andrewpeterson.io>` |
| `APP_URL` | Public base URL for invite links (defaults to `https://aac.andrewpeterson.io`) |

After deploying with the env vars set, hit `POST /api/init` once with the `ADMIN_TOKEN` to create the tables.

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
  my-children.js      Roster endpoint for the therapist home
  admin/taxonomy*.js  Taxonomy workbench backend (CRUD, bulk, snapshots, audit, board-import)
admin/taxonomy.html   Taxonomy workbench (Tabulator-based editor)
taxonomy/             Canonical word list — README, build-seed.mjs, seed-core-v1.csv
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

### In-flight (foundation shipped, finishing work in flight)
- **Multi-tenant data enforcement.** `canAccessChild` / `canEditContent` and the `child_access` / `access_requests` tables are in place; the data endpoints (`sync`, `items`, `categories`, `live`, `child-settings`, `analytics`, etc.) are being gated by them endpoint-by-endpoint. Until that's across, only admin really exercises the cross-child path.
- **Parent ↔ therapist invite/request flow.** Schema and helpers exist; the UI (parent invites by email; therapist requests; accept/decline) is the next phase.
- **Therapist "Build a Custom Board" editor.** Ownership column shipped; the editor that uses it (and surfaces a per-tile "Remove from <child>'s board" parent-override action) lands after enforcement.

### Open / deferred
- **Status bar / contentInset** behavior on iOS depends on the Info.plist + the `@capacitor/status-bar` plugin being installed; see the iOS section.
- **Scheduled-prompt triggers off `settings.schedule`** (board chooses what to show based on time + location) is intentionally not wired yet — the editor captures the data; the runtime is next.
- **Per-concept mastery & progressive growth.** `game_attempts.category` currently stores the section, not the canonical taxonomy slug — once tiles carry `taxonomy_slug`, mastery rolls up per concept and drives "grow the board as the child masters levels."
- **Scene tags for "snap your pantry."** Taxonomy rows park scene hints in `notes` for now (`Scene: pantry`); will graduate to a real `scene_tags` column + a scenes table.
- **Multi-device race on `child_settings`**: it's a full-blob replace, so simultaneous edits from two devices can lose updates. In practice this is rare; the parent and the therapist rarely edit settings at the same moment.

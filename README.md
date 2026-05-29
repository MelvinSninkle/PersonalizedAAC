# Personalized AAC — "Fletcher's World"

A communication and learning app built for one specific non-verbal toddler who is a gestalt language processor. It's a multi-view web app (kid board + parent dashboard + therapist view) deployed on Vercel, with a thin Capacitor iOS shell that loads the live site so the iPad picks up web changes instantly.

> The app started as a single-file HTML AAC board. It has since grown into a full system covering communication, structured games, scheduling, and remote facilitation. This README documents the current shape — see git history for the journey.

---

## The three views

| Path | Audience | What it is |
|---|---|---|
| `/u/<slug>` | The child (tablet) | The AAC board itself — People · Nouns · Verbs grid + a Needs strip + the game/slideshow/celebration runtime |
| `/parent/<slug>` | Parents | Dashboard: analytics, mode launcher, organizer, schedule editor, reward cheers, scheduled prompts, reference images, backup |
| `/therapist/<slug>` | SLP / facilitator | Live facilitator console (drives a game on the iPad), plus the shared schedule editor and progress view |

All three are protected by a session cookie; an invite-gate (`/welcome`) sits in front of public traffic.

### Per-device default view

On first launch, each device asks **"Who uses this device?"** (Child / Parent / Therapist). The choice is stored in `localStorage` (`aacDeviceRole`); a parent/therapist device then **redirects in `<head>`** to its dashboard so there's no flash of the board. Override paths:
- Add `#board` to any URL to stay on the board for that visit (sets `sessionStorage.aacStayBoard`).
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
- **Start a mode** — six launcher cards (Self-Paced / Facilitated Matching, Learn / Exposure Slideshow, Celebration, Routine Builder) that build a live command and POST it to `/api/live`. Forms use the child's real categories pulled from `/api/sync`. Sends a tablet-online check before launching and tells you to open the tablet if it isn't on the board.
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
  - **+ tile / + Category / + subcategory** open the **full creator modal**: label, ✨ AI-from-photo (style picker + photo capture → `/api/generate-image` + `/api/tts` for voice), or upload, plus keep-aspect. Voice section hides for categories.
- **Reference images for AI tile generation** — uploaded photos used as style/subject references for `/api/generate-image`.
- **Backup** — download a JSON of the entire board with images/audio base64-embedded.

---

## Therapist view (`therapist.html`)

Focused facilitator console for the SLP:

- **Live session control** — drives a facilitated matching game on the tablet (start/skip/next/end, mark correct verbal/physical responses) over `/api/live`.
- **Shared progress** — mastery by category, recent sessions.
- **Daily schedule editor** — same editor as the parent view; the SLP can fill in the child's routine and locations.
- **Change device default** link in the header.

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
- Roles: `admin` / `parent` / `therapist` / `child` — checked in API handlers via `_lib/auth.js`.

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
/u/:slug         → app.html        (the child's board)
/parent/:slug    → parent.html
/therapist/:slug → therapist.html
/login           → login.html
/reset           → reset.html
/welcome         → welcome.html
/onboard/:slug   → onboard.html
/onboard         → onboard.html
```

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
| `POST /api/init` | One-time schema bootstrap (idempotent) |

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
therapist.html        Therapist (facilitator) view
schedule-editor.js    Shared "Daily schedule" editor used by both dashboards
middleware.js         Invite gate + session gate (Edge middleware)
capacitor.config.json Capacitor iOS shell config
vercel.json           URL rewrites for /u/, /parent/, /therapist/, /welcome, etc.
sw.js                 Service worker
api/                  Vercel Serverless Functions (see table above)
  _lib/auth.js        checkAuth — verifies session cookie / Bearer token
  _lib/db.js          Neon SQL client + row mappers
  _lib/apns.js        Self-hosted APNs sender (HTTP/2 + ES256 JWT)
icons/                App icon + MyWorld globe used in the header
audio/                Background music tracks for games
admin/                Admin-only utility pages (invite codes, taxonomy)
cap-shell/            Capacitor webDir stub (the real content is served from the URL)
lib/                  Shared session signing helpers
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

- **Status bar / contentInset** behavior on iOS depends on the Info.plist + the `@capacitor/status-bar` plugin being installed; see the iOS section.
- **Editing a tile's image/sound from the organizer** isn't wired up yet — the ✎ pencil only renames. The full creator is reachable from the **+ tile** flow.
- **Scheduled-prompt triggers off `settings.schedule`** (board chooses what to show based on time + location) is intentionally not wired yet — the editor captures the data; the runtime is next.
- **Multi-device race on `child_settings`**: it's a full-blob replace, so simultaneous edits from two devices can lose updates. In practice this is rare; the parent and the therapist rarely edit settings at the same moment.

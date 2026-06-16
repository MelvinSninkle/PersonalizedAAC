# My World — native iOS app (one app, two display modes)

Native SwiftUI app with **two faces of the same binary** (PRD §1.2):

- **Child board** — the communication board, used on a dedicated iPad in
  Guided Access. The original surface of this app.
- **Parent app** — a phone-first home screen (also fine on iPad) for a parent
  on the go: add a tile, quick board, start a game, stats, schedules,
  message the board, the picture album.

On first launch after login the app asks "Who uses this device?" and stores
the answer (`UserDefaults.deviceRole`). Switching later:
parent → child: gear → "Use as the child's board".
child → parent: triple-tap the header → Settings → "Switch this device to the
Parent app". Existing installs see the picker once after updating.

Therapist / admin / Lab stay on the web app by design.

## Parent app surface (`MyWorld/Parent/`)

| Screen | Endpoint(s) |
| --- | --- |
| Add a tile | `AddTileQueue` uploads to the durable `POST /api/tile-jobs` queue (server renders + a cron lands the tile; the photo can't be lost) and polls status |
| Family & people | `GET/POST/DELETE /api/persons` + the durable People-section pipeline — add/replace/rename reference faces anytime |
| Quick board (PRD §4.3) | the same `BoardView`, full screen; long-press the lock pill 1.2s to exit |
| Start a game (PRD §4.4) | `POST /api/live` kind=cmd (`start` / `end`); tablet presence via status age |
| Message the board (PRD §4.7) | `POST /api/message-to-board` → token preview strip |
| Stats (PRD §4.5) | `GET /api/analytics` (server pre-formats; the phone renders verbatim) |
| Schedules (PRD §4.6) | `child_settings.schedules` round-trip (raw dicts so web-authored fields survive) |
| Album | `GET /api/album?mode=timeline` |
| Vocabulary level | `GET/POST /api/advance-band` (current band + parent unlock) |

**Why native:** WKWebView taps lag on iPad (300ms click delay, double-tap-to-
zoom, gesture fights with the kid's actual taps). Native UIKit/SwiftUI gesture
handlers fire on the touch-down event with no delay — that's the whole point.

Backend: this app calls the same `/api/auth/login`, `/api/sync`, `/api/media`,
`/api/events`, `/api/live`, `/api/tts` endpoints as the web app, plus — for tile
authoring + people — the durable `/api/tile-jobs` queue, `/api/items` and
`/api/generate-image` (board-editor regenerate), `/api/persons` (Family & people),
and `/api/onboarding/{styles,voices,child,family,seed-core}`. New schema: the
`tile_jobs` table (self-creates via `ensureTileJobs`) and `child_settings.styleGuideId`
/ `voiceId`; the `run-tile-jobs` cron is in `vercel.json`. Auth is cookie-based via
`URLSession` + `HTTPCookieStorage` (same flow as Safari, just from a native client).

## Setup on a fresh Mac

You need Xcode 15+ and Homebrew.

```sh
# One-time: install xcodegen so the .xcodeproj can be generated from project.yml
brew install xcodegen

# In this folder:
cd kid-ios
xcodegen generate
open MyWorld.xcodeproj
```

In Xcode the first time:

1. Click the **MyWorld** target in the left sidebar → **Signing & Capabilities**.
2. Pick your **Team** (your Apple Developer account). Xcode generates a
   provisioning profile.
3. Plug in your iPad → select it in the target dropdown at the top → ▶ Run.

The bundle ID is `io.andrewpeterson.myworld`, which is the same as the
Capacitor app — installing this build will REPLACE the Capacitor app on the
iPad. (Server is canonical, so no data is lost; the new app re-pulls on first
launch.) During dev you can change the bundle ID temporarily to install
side-by-side.

## Editing the project structure

`MyWorld.xcodeproj/` is gitignored. **Don't add files via Xcode's File → New**
— add them on the filesystem under `MyWorld/`, then rerun:

```sh
xcodegen generate
```

Xcode will pick up the change automatically (no need to close it).

## Architecture

```
MyWorld/
├── MyWorldApp.swift          @main, sets up audio session + observable env
├── ContentView.swift          Root: switches between LoginView and BoardView
├── Models/
│   ├── BoardSection.swift     People / Nouns / Verbs / Needs enum
│   ├── Category.swift         A category on the board (Codable, Identifiable)
│   └── Tile.swift             An individual item/button (Codable, Identifiable)
├── Network/
│   ├── APIClient.swift        URLSession wrapper: login, sync, media, events
│   └── APIError.swift         Typed errors
├── Auth/
│   ├── AuthManager.swift      Login + signed-in user state (Observable)
│   └── SessionStore.swift     HTTPCookieStorage glue + persistent user info
├── Storage/
│   ├── MediaCache.swift       Filesystem image+audio cache keyed by blob key
│   └── BoardStore.swift       Observable in-memory board state, with disk hydrate
├── Audio/
│   └── TilePlayer.swift       AVAudioPlayer + AVSpeechSynthesizer fallback
└── Views/
    ├── LoginView.swift
    ├── BoardView.swift        The main grid view
    ├── TileView.swift         One tile button
    ├── SectionTabBar.swift    People / Nouns / Verbs / Needs tabs
    └── PersistentStripView.swift   Pinned tiles bar
```

## Not yet in v0

The first commit ships login + sync + tile rendering + tap-to-speak only.
These come next (when the v0 is stable on Fletcher's iPad):

- Live session receiver (poll `/api/live`, accept facilitator commands)
- Game modes (matching, slideshow, celebration)
- Routines / scheduled prompts ("do you need the potty?")
- Reward animations

Now shipped (see *Tile authoring* below): a native **parent edit mode** —
long-press the lock, then **+ New tile** or **Add several from Photos** — so a
parent can add tiles without bouncing out to Safari. The full dashboard
(analytics, schedules, organizer) still opens on the web.

## Tile authoring (parent edit mode)

Long-press the lock → edit mode → **Add a tile** (single) or **Choose photo(s)**
(bulk). The work runs **server-side and durably**: the photo uploads to
`POST /api/tile-jobs` (safe the instant it returns), and the server names →
generates style-consistent art → voices → places the tile, with a one-minute
cron (`/api/cron/run-tile-jobs`) guaranteeing completion. No phonetic
pronunciation — TTS speaks the title.

- **Pre-generation review.** A single capture pauses on a "hold on — here's more
  info" sheet: override the name (blank → AI names it) and add an optional detail
  hint that steers the art, before generation starts.
- **Durable + restart-proof.** Each photo becomes a `tile_jobs` row server-side;
  the in-app tray just polls and reappears in-flight after an app restart. The
  photo can't be lost — final-attempt save-first keeps the raw photo as the tile.
- **Edit any tile on unlock.** Tapping a tile in edit mode opens `BoardTileEditSheet`
  — rename, swap picture (new photo → art or use as-is), keep-aspect, re-voice,
  pin (People), move section/folder, set the listening-game description, delete.
- **Bulk = reviewable.** Bulk-imported tiles auto-add flagged `needs_review`; when
  the batch finishes, a banner opens a review sheet (art + ▶ voice + editable
  name). A typed name supersedes the AI's.
- **Square-except-TV.** Tiles render square; a folder named TV/Movies/Shows/Posters
  shows its tiles as posters (rectangular). Settings → "Make all tiles square"
  normalizes stored `keep_aspect`.

Relevant files:

```
Storage/AddTileQueue.swift   TileJob view-model + upload-to-/api/tile-jobs + poll loop
Storage/ImageDownscale.swift Shared photo → ≤1024px JPEG helper
Views/AddTileView.swift      Add-Tiles sheet: destination, capture, pre-gen review, tray
Views/TileEditSheet.swift    TileEditSheet (tray) + BoardTileEditSheet (full board editor)
Views/BatchReviewView.swift  Review queue sheet for needs_review tiles
Views/CameraPicker.swift     UIImagePickerController bridge (system camera)
Parent/PeopleManager (in ParentHomeView.swift)  Family & people: persons + reference photos
Parent/OnboardingFlow.swift  Onboarding incl. style + voice pickers, repeatable grown-ups
```

Camera/Photos usage strings live in `project.yml` (baked into `Info.plist` on
`xcodegen generate`) — without them iOS silently denies the picker.

## Testing on Fletcher's iPad

For dev cycle without a full TestFlight push, plug the iPad into the Mac, hit
▶ Run in Xcode with the iPad as target. The app installs over USB. Each save +
Run is ~5-10 seconds — fast enough to iterate on the actual device.

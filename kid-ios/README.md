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
| Add a tile | reuses the iPad's `AddTileQueue` chain (describe → generate → tts → items) |
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
`/api/events`, `/api/live`, `/api/tts` endpoints as the web app, plus — for the
in-app tile editor — `/api/describe-image`, `/api/generate-image`, `/api/upload`,
and `/api/items` (create / update / delete). The only schema change it relies on
is the additive `items.needs_review` flag for the bulk-import review queue (run
`POST /api/init` once to apply it). Auth is cookie-based via `URLSession` +
`HTTPCookieStorage` (same flow as Safari, just from a native client).

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

Long-press the lock → edit mode → **+ New tile** (single) or **Add several from
Photos** (bulk). Both run the same chain: photo → `/api/describe-image`
(auto name + phonetic) → `/api/generate-image` (styled art) → `/api/tts` (voice)
→ review → `/api/items`.

- **Background render with progress rings.** Captures return instantly; each
  photo becomes a `TileJob` in an app-level `AddTileQueue` (max 3 rendering at
  once) so a parent can keep snapping/picking while tiles render. The header
  pill shows a live "⏳ N rendering" count.
- **Bulk = reviewable.** Bulk-imported tiles auto-add to the board flagged
  `needs_review`; when the batch finishes, a banner on the board opens a review
  sheet (art + hear-the-voice + editable name / pronunciation). The same queue
  surfaces on the web parent dashboard. A typed name/pronunciation supersedes
  the AI's.

Relevant files:

```
Storage/AddTileQueue.swift   TileJob + queue: AI chain, concurrency gate, batch + review notice
Storage/ImageDownscale.swift Shared photo → ≤1024px JPEG helper
Views/AddTileView.swift      Add-Tiles sheet: destination, capture buttons, render tray
Views/TileEditSheet.swift    Fix/name a single tile (create-or-update)
Views/BatchReviewView.swift  Review queue sheet for needs_review tiles
Views/CameraPicker.swift     UIImagePickerController bridge (system camera)
Views/HeaderBar.swift        Edit-mode pills incl. + New tile + the rendering badge
```

Camera/Photos usage strings live in `project.yml` (baked into `Info.plist` on
`xcodegen generate`) — without them iOS silently denies the picker.

## Testing on Fletcher's iPad

For dev cycle without a full TestFlight push, plug the iPad into the Mac, hit
▶ Run in Xcode with the iPad as target. The app installs over USB. Each save +
Run is ~5-10 seconds — fast enough to iterate on the actual device.

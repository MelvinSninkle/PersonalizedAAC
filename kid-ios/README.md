# My World — native iOS kid app

Native SwiftUI rewrite of the kid surface only. Parent / therapist / admin
stay on the web app — this app is just the board Fletcher actually taps on.

**Why native:** WKWebView taps lag on iPad (300ms click delay, double-tap-to-
zoom, gesture fights with the kid's actual taps). Native UIKit/SwiftUI gesture
handlers fire on the touch-down event with no delay — that's the whole point.

Backend untouched: this app calls the same `/api/auth/login`, `/api/sync`,
`/api/media`, `/api/events`, `/api/live`, `/api/tts` endpoints as the web app.
Auth is cookie-based via `URLSession` + `HTTPCookieStorage` (same flow as
Safari, just from a native client).

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
- Parent edit mode (long-press → opens `/parent/<slug>` in Safari for v1; native editor later)

## Testing on Fletcher's iPad

For dev cycle without a full TestFlight push, plug the iPad into the Mac, hit
▶ Run in Xcode with the iPad as target. The app installs over USB. Each save +
Run is ~5-10 seconds — fast enough to iterate on the actual device.

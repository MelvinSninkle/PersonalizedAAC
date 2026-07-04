# My World on Android & Kindle Fire

## Architecture — why this is a true 1:1, not a second codebase

To be precise about what exists on iOS: the iPad/iPhone app is a **native
SwiftUI app** (`kid-ios/`); the **web board** (`app.html` + `parent.html` +
`store.html`) is the functionally-equivalent cross-platform surface that shares
the same server brain (there's also `cap-shell/`, the earlier Capacitor wrapper
around the web board). Both UIs implement the same features against the same
APIs.

The Android build wraps the WEB surface in a hand-written native shell
(`android/`, ~2 files of Kotlin) rather than rewriting SwiftUI in Compose —
one codebase to maintain, and Android gains every future feature the moment
the web deploys:

- **WebView on the live site** (`https://aac.andrewpeterson.io/`) — every board
  feature ships to Android the moment it deploys to the web. No drift, ever.
- **`SpeechBridge`** exposes Android's on-device `SpeechRecognizer` through a JS
  shim that mimics `Capacitor.Plugins.SpeechRecognition` — the exact surface
  the board already calls, so listening mode works unchanged.
- **Kid-proofing** (the lessons from the iPad-WebView era, both layers):
  - Web CSS already ships `user-select:none`, `-webkit-touch-callout:none`,
    `overscroll-behavior:none`, and `touch-action` rules — so a finger dragged
    across the board pans, it does NOT smear a text-selection highlight over
    the tiles, and taps only fire on press+release without movement.
  - The shell kills what CSS can't reach: long-press is swallowed before
    Android's selection ActionMode can start, long-press haptics are off,
    pinch/double-tap zoom is disabled at the WebView level, overscroll
    glow/stretch is off, and the system BACK gesture never exits the board
    (web history only; parents leave via Home/Recents). Android's **Screen
    Pinning** (Settings → Security) is the Guided-Access equivalent for
    full lock-in.
  - Fullscreen sticky-immersive, keep-screen-on, session cookies flushed to
    disk, offline retry page.
- **Add-a-photo flows**: the WebView file chooser offers camera + photo library
  (FileProvider handles the capture handoff).
- **Capability flags**: the shell sets `window.MyWorldShell = { platform:
  'android'|'fire', speech: true|false }`; the board shows a one-time,
  parent-friendly "what works on this device" card and explains a missing mic
  instead of showing a dead button.

The web board also gained two things that complete Android parity:

- **Web Speech fallback**: in plain Chrome (no app installed) listening mode
  now works through the browser's built-in recognition, wrapped in the same
  plugin surface.
- **Auto-teach runner**: the board itself now polls `/api/auto-teach/next`,
  stages the "Learning time! 📚" countdown, ticks exposures with the `auto_*`
  source, and launches the slideshow/game — previously iPad-native-only.

## What works where (the honest matrix)

| Capability | Android phone/tablet (app) | Kindle Fire (app) | Chrome browser | Other browsers |
|---|---|---|---|---|
| Talking board, all personalized tiles/voices | ✅ | ✅ | ✅ | ✅ |
| Games, Teach Me, Play With Me | ✅ | ✅ | ✅ | ✅ |
| Automatic teaching (countdown + sessions) | ✅ | ✅ | ✅ (tab open) | ✅ (tab open) |
| Speech-to-text listening mode | ✅ on-device | ❌ no speech service on Fire OS | ✅ (Chrome only) | ❌ |
| Camera / photo-library tile adds | ✅ | ✅ (camera if present) | ✅ | ✅ |
| Fullscreen kid mode, screen stays on | ✅ | ✅ | partial (Add to Home Screen) | ❌ |
| Push notifications | ❌ v1 | ❌ | ❌ | ❌ |
| Memberships & credit purchases | web store (Stripe) in-app | web store (Stripe) in-app | ✅ | ✅ |

The board tells users all of this itself: a one-time device card on first
launch, and a specific hint if they tap the mic on a device that can't listen.

## Building the APK

1. Open `android/` in Android Studio (Hedgehog or newer). It supplies the
   Gradle wrapper and SDK; no other setup.
2. `Build → Generate Signed App Bundle / APK…` → APK → create a keystore once,
   keep it safe (losing it means a new app identity for updates).
3. The same APK runs on Android phones, Android tablets, and Kindle Fire
   (Fire OS is Android; `minSdk 24` covers Fire OS 6+ devices).

Before shipping, replace the placeholder launcher icon: Android Studio →
`File → New → Image Asset` → use `fletcher_app_icon_transparent_1024.png` from
the repo root.

## Distributing

- **Right now (the three waiting families):** send the signed APK directly
  (email/Drive). Android: Settings allows "install unknown apps" for the
  browser. Fire: same flow via Silk downloads. Zero store review, ships today.
- **Google Play (later):** upload the app bundle. ⚠️ Policy note: Play requires
  Google Play Billing for in-app *digital goods*. This shell sells nothing
  natively — purchases happen on the web store it renders — but Google may
  still flag web-payment flows inside a Play-distributed app. The clean paths
  are (a) closed testing tracks (fine as-is), or (b) for a public listing,
  either add a Play Billing port of the credits/memberships or hide the
  store pages when `MyWorldShell` is present and route parents to the website.
  Decide when public Play distribution actually matters.
- **Amazon Appstore (later):** same shape; Amazon requires its own IAP for
  digital goods in listed apps, with the same two escape paths.

## Files

```
android/
  settings.gradle.kts / build.gradle.kts / gradle.properties
  app/build.gradle.kts                — minSdk 24, no external deps beyond androidx
  app/src/main/AndroidManifest.xml    — nothing required=true (installs on any Fire)
  app/src/main/java/io/andrewpeterson/myworld/
    MainActivity.kt                   — WebView shell, immersive, file chooser, offline page
    SpeechBridge.kt                   — SpeechRecognizer ↔ Capacitor-compatible JS shim
  app/src/main/res/…                  — theme, colors, placeholder adaptive icon
```

## Known v1 gaps (deliberate)

- No push notifications (the iOS shell's `@capacitor/push-notifications`
  equivalent needs Firebase on Android and ADM on Fire — separate work, and the
  board is a foreground device by nature).
- No native IAP (see distribution notes above; web Stripe covers purchases).
- The Android **parent** experience is the web dashboard (which is already the
  primary parent surface); the SwiftUI parent app remains iOS-only.

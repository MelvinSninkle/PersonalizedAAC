# My World on Android & Kindle Fire

Android now ships as a **true native app** — `android-native/`, Kotlin +
Jetpack Compose — a functional 1:1 of the iOS SwiftUI app (`kid-ios/`): the
child board AND the full parent app, against the same server brain the web
uses. The earlier WebView shell (`android/`) remains in-repo as a dev tool
under the package id `io.andrewpeterson.myworld.shell`; the native app owns
the canonical id `io.andrewpeterson.myworld` and installs as an in-place
upgrade over any shell APK a family already has (versionCode 2 > 1).

## What's inside (milestone map)

| Area | Where |
|---|---|
| Auth (email/password, 30-day `mw_session` cookie), role switch | `auth/`, `net/PersistentCookieJar.kt`, `ui/LoginView.kt`, `ui/RolePickerView.kt` |
| Board: uniform tile sizing, guillotine crop + `trimmingFlatBorders`, poster folders, rooms, needs strip, word-tile placeholders | `ui/board/`, `model/Board.kt` |
| Display settings (merge-safe `child_settings.kidDisplay`), unlock, header actions | `ui/board/DisplaySettingsView.kt`, `net/ApiSettings.kt` |
| Games: matching (errorless scaffolding + mercy v2), clue quiz, auditory, expressive naming, slideshows, Teach Me (event-paced `speakAwait`), celebration + confetti, auto-teach runner + countdown | `game/`, `ui/game/`, `live/AutoTeachRunner.kt` |
| Listening mode: `SpeechRecognizer`, rolling caption, greedy tokenizer, tile chips | `audio/SpeechListener.kt`, `game/ListenTokenizer.kt`, `ui/board/ListenStripView.kt` |
| Live channel: 1s seq-dedup poll + baseline-on-boot, 3s heartbeat, facilitator console, message-to-board overlay | `live/`, `ui/parent/FacilitatorView.kt`, `ui/board/MessageOverlayView.kt` |
| Edit mode: tap-to-edit sheet (rename→re-voice, pin, move, guided redraw, delete), add-tile flow (photo→durable server job, free-tier raw-only), long-press drag reorder + drag-to-chip folder moves, rendering placeholders | `ui/board/AddTileView.kt`, `BoardTileEditSheet.kt`, `SectionColumn.kt`, `storage/AddTileQueue.kt` |
| Parent app: home grid, stats hub (usage/top words/word history/accuracy/input methods/mastery — hand-rolled Canvas charts), settings (band advance, typed-DELETE account deletion), store, word shop (4 ribbons + disk-cached catalog + bundles + free boards), auto-teach controls + quiet hours, album, schedules, family & people, message board, quick board | `ui/parent/` |
| Onboarding: demo → account (consent) → child (style + voice pickers) → photos (free retries, repeatable grown-ups) → seed core → done; resumes from `/api/onboarding/state` | `ui/onboarding/`, `model/OnboardingCoordinator.kt` |
| Billing: Google Play (Billing 7) with **verify-before-consume/acknowledge** against `/api/store?action=play-verify`; unfinished purchases re-post on launch; Fire → web-store handoff | `billing/BillingClientManager.kt` |
| Kid-proofing: back gesture swallowed on the board, immersive system bars, keep-screen-on, screen-pinning guidance in parent settings | `ui/board/BoardView.kt`, `MainActivity.kt` |

## What works where (the honest matrix)

| Capability | Android phone/tablet | Kindle Fire | Web browser |
|---|---|---|---|
| Talking board, all personalized tiles/voices | ✅ | ✅ | ✅ |
| Full native parent app (stats, shop, auto-teach, people…) | ✅ | ✅ | ✅ (web dashboard) |
| Games, Teach Me, facilitator live channel | ✅ | ✅ | ✅ |
| Speech-to-text listening mode | ✅ on-device | ❌ no speech service on Fire OS | ✅ (Chrome) |
| Camera / photo-library tile adds | ✅ | ✅ (camera if present) | ✅ |
| Memberships & credit purchases | ✅ Google Play (native) | web store (Stripe) handoff | ✅ Stripe |
| Push notifications | ❌ v1 (board is a foreground device) | ❌ | ❌ |

The app tells families this itself: the Fire speech dialog explains the missing
recognizer, the store explains the web-purchase path, and Parent Settings has a
"This device can…" summary (`model/DeviceCapabilities.kt`).

## Building

1. Open `android-native/` in Android Studio (Ladybug+). Gradle wrapper + SDK
   come from the IDE; no other setup.
2. Debug run: any device/emulator API 26+.
3. Release: `Build → Generate Signed App Bundle / APK…` — create the keystore
   once and keep it safe (losing it means a new app identity forever).
4. The launcher icon is generated from `fletcher_app_icon_transparent_1024.png`
   (adaptive foreground PNGs in `res/mipmap-*`).

Server env needed for native Play purchases:
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` — the Play Console service-account key
  (JSON, with the Android Publisher scope granted to the app).
- `PLAY_PACKAGE_NAME` — defaults to `io.andrewpeterson.myworld`.
Play Console product ids reuse the iOS ids verbatim: `starter.monthly`,
`plus.monthly`, `pro.monthly`, `credits50…credits1000`.

## Distributing

- **Now (the waiting families):** send the signed APK directly. Android:
  "install unknown apps". Fire: same flow via Silk downloads. Ships today.
- **Google Play:** internal testing track first — walk the billing matrix
  below — then production. Native Play Billing satisfies the digital-goods
  policy.
- **Amazon Appstore (later):** requires Amazon IAP for listed apps; v1 Fire
  distribution is sideload + web purchases, which is compliant because the
  app isn't store-listed there.

## QA / regression matrix (run before each release)

1. Fresh install → onboarding → seeded board → 10 tiles speak.
2. Web console drives the Android board (start/end/mark/skip, listen, message);
   game log verified in admin.
3. Android parent drives an iPad board (cross-platform live channel).
4. `child_settings` three-way merge: Android + web + iPad edits within a
   minute — nothing clobbers (display prefs, schedules, auto-teach).
5. Tier walk via the admin sub-override simulator: every gate (listen, styled
   add, auto-teach, seed renders) matches iOS per tier; credits drain.
6. Billing internal-test matrix: pack purchase, subscription, upgrade within
   the group, duplicate re-post → `duplicate:true`, PENDING purchase, kill the
   app between purchase and verify → relaunch grants exactly once.
7. Fire HD pass: board + games + parent app work; speech + Play gates show
   their explanations; web-store handoff completes a purchase.
8. Kid escape attempts under screen pinning (stock Android + Fire).
9. Airplane-mode cold start paints from cache; recovery on reconnect.
10. JSON parity diffs vs iOS for LiveCommand / heartbeat / GameLogPayload on
    identical scenarios.

## The WebView shell (`android/`) — dev tool only

The original wrapper around the live web board. Package id moved to
`io.andrewpeterson.myworld.shell`; it is no longer distributed but stays
useful for quickly testing web-board changes on a device. Its kid-proofing
lessons (selection suppression, back-gesture swallowing, immersive mode) are
carried forward in the native app. The web board keeps its own Android wins
from that era: the Web Speech fallback in plain Chrome and the in-browser
auto-teach runner.

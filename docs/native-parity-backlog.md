# Native parity backlog (kid-ios + android-native)

**Re-verified against source on 2026-07-24.** Every claim below was checked by
grepping the actual client code, not by reading the chat or trusting the
previous version of this file.

> **Read this before building anything from this doc.** The 2026-07-02 version
> of this file went three weeks stale and became actively wrong — it claimed
> kid-ios had "no drag code at all" long after iOS shipped `DragGesture`
> reorder. A stale parity doc is worse than none: it sends someone to rebuild
> finished work. **Re-run the probe at the bottom before starting an item**, and
> update this file in the same commit that closes one.

Scope note: this used to be an iOS-only backlog. iOS has since caught up and
**android-native is now the laggard** — it missed most of the 2026-07 wave.

---

## 1. CLOSED — the original backlog is fully shipped

The A1–A4 / B1–B6 list that made up this document is **done**. Recorded here
with evidence anchors so nobody reopens it:

| Item | Was | Now |
|---|---|---|
| A1 drag reorder + move across categories | "no drag code at all" | `Views/SectionColumn.swift` `DragGesture(minimumDistance: 24)`; `APIClient.reorderItems` / `reorderCategories`; categoryId set/clear |
| A2 word-tile placeholder | blank square when imageKey nil | `Views/TileView.swift` — explicit `imageKey == nil \|\| isEmpty` branch |
| A3 board-build progress pill | nothing | `Views/BoardView.swift` — `seedStatus`, `seedPollTask`, `seedProgressPill`, `startSeedWatch()` |
| A4 real child name in title | slug-prettified only | `Models/DisplayPrefs.swift` — `ChildNames` fetches the is_self person's `given_name`, caches per slug in UserDefaults; `prettyChildName` prefers it |
| B1 listening remote button | no sender in native parent | `Parent/MessageBoardView.swift:169` publishes `listen-start` / `listen-stop` |
| B2 parent build banner | none | `Parent/ParentHomeView.swift` — `buildStatus` + `seedStatus(childId:)` poll |
| B3 native Word Shop | credits/IAP only | `Parent/WordShopView.swift` — browse by section, cart, checkout in credits |
| B4 coupon redeem | none | `APIClient.swift:836` — `POST /api/store?action=redeem` |
| B5 402 out-of-credits (was "ships broken TODAY") | generic failure | handled in `AddTileQueue`, `AddTileView`, `TileEditSheet` (×2), `ParentHomeView`, `WordShopView` |
| B6 free-retry regenerate | no UI anywhere | `APIClient` `action=retry` + `TileEditSheet` redraw sheet ("Match my child's style") |

---

## 2. OPEN — the real gaps

### 2A. Android missed the 2026-07 wave  ⭐ the bulk of the work

Each of these shipped on web AND iOS and has **zero** Android files matching:

| Feature | Web | iOS | Android |
|---|---|---|---|
| #17 quick unlock PIN | ✅ | ✅ `Auth/QuickPin.swift`, `UnlockSheet` pad | ❌ |
| #15 low-vision enlargement (listen strip + top buttons) | ✅ | ✅ `DisplayPrefs.listenTileSize` / `topButtonSize` | ❌ |
| #12 listening repeat-count picker | ✅ | ✅ `AccessFeatures.listenRepeatCount` | ❌ |
| #11 movie / show poster linking | ✅ | ✅ `MovieAddSheet` + wikidata/imdb plumbing | ❌ |
| #10 suggestion consent toggle | ✅ | ✅ `DisplaySettingsView` | ❌ |

Port target for each is the matching Android file under
`android-native/app/src/main/java/io/andrewpeterson/myworld/` — the settings
items land in `ui/board/DisplaySettingsView.kt`, which is already described in
its own header as the port of the Swift view, so the structure is there.

**#14 iPad demo board** is iOS-only *by design* (it was an explicit iPad ask:
"admin" + ADMIN_TOKEN → `DemoBoardView` on the public `/api/demo` projection).
The web equivalent is `/practice`. An Android port is optional — decide, don't
default to building it.

### 2B. Both natives: clue AUTHORING (#16)

Careful distinction — the natives **read** clues correctly today
(`Models/Tile.swift`, `SlideshowView`, `MatchingView`, `Audio/TilePlayer` on
iOS; the same five on Android), so tap-to-learn and the games work. What's
missing is the **edit fields**: `descriptiveClues` appears nowhere in
`Views/TileEditSheet.swift` or the Android tile editor. Web has them in the
app.html edit modal. So a parent can hear clues on a tablet but can only
write them from the web.

### 2C. Both natives: suggestion capture + review (#10)

Verified by call site, not by keyword:
- `op: 'suggest-record'` (capture during listening) — **`app.html` only**.
- `op: 'suggest-list'` / `'suggest-act'` (parent review queue) — `app.html`
  and `parent.html` only.
- iOS has the **consent toggle and nothing else**, so a family on iPad can
  turn on a feature that never captures anything. That mismatch is the part
  worth fixing first — either port capture, or hide the toggle natively.
- Server ops are shared and already roster-gated + consent-checked
  (`api/items.js` → `_lib/word-suggestions.js`), so this is client work only.

### 2D. Cosmetic: the settings button reads three different ways

- web (`app.html`): "⚙ Display"
- iOS (`Views/HeaderBar.swift:225`): "⚙ Settings"
- Android (`ui/board/HeaderBar.kt:154`): bare "⚙", no label

iOS is the intended name (Settings, with sign-out inside). Mirror it on web and
Android when convenient.

### 2E. Needs a device, not a diff

Native drag-pickup thresholds still want on-device tuning with Andrew. The
failure mode to avoid is every tile-touch reading as a grab; the target is
"short natural press picks up, light touch still scrolls." Cannot be settled
from a code read.

---

## 3. Deliberately web-only (confirmed, closed)

- ZIP backup download — browser is the right surface for a big file.
- Admin tooling: taxonomy workbench, Default board, Lab, translations,
  coupons/grants.
- Progress charts (`charts.js`) — natives have their own Stats screen.

---

## 4. Suggested order

1. **2C** — resolve the #10 toggle-without-capture mismatch on iOS (port
   capture, or hide the toggle). A setting that does nothing is a bug.
2. **2A** — the Android wave ports, heaviest first: #17 PIN, #15 low-vision,
   #12 repeat count, then #11 movie linking.
3. **2B** — clue authoring in both native tile editors.
4. **2D** — label alignment.
5. **2E** — drag thresholds, with Andrew on-device.

---

## 5. How to re-verify (run this before trusting any row above)

```bash
probe() {                       # feature label, then a grep pattern
  local label="$1" pat="$2"
  printf "%-32s web:%-3s ios:%-3s android:%-3s\n" "$label" \
    "$(grep -l  "$pat" app.html parent.html 2>/dev/null | wc -l)" \
    "$(grep -rl "$pat" kid-ios/MyWorld/ --include=*.swift 2>/dev/null | wc -l)" \
    "$(grep -rl "$pat" android-native/ --include=*.kt 2>/dev/null | wc -l)"
}
probe "quick PIN (#17)"           "QuickPin\|quickPin"
probe "low-vision sizes (#15)"    "listenTileSize\|topButtonSize"
probe "listen repeat count (#12)" "listenRepeatCount"
probe "movie/show link (#11)"     "wikidata\|imdb\|Imdb\|IMDb"
probe "tile clue fields (#16)"    "descriptiveClues\|descriptive_clues"
probe "suggestions (#10)"         "suggest-record\|suggestListening"
```

A zero in a column is a lead, not a verdict — confirm what the matching files
actually do before opening an item. #16 is the cautionary example: it matches
five files on both natives and still has no editor.

Remember there is **no Swift or Kotlin compiler in the remote environment**
(no `swiftc`/`xcodebuild`, no committed `gradlew`, and CI never touches either
tree). Anything built from this list is read-verified only until Andrew builds
it in Xcode or Android Studio — say so plainly when you ship it.

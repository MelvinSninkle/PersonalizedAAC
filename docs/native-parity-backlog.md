# Native (kid-ios) parity backlog

Features from the last two days of work that shipped **web-only** and still
need a native SwiftUI build. Verified against the kid-ios source (not just the
chat) — each item lists where the web version lives and what native is missing.

## A. Kid board

### A1. Drag-and-drop reorder + move across categories  ⭐ (explicit ask)
- **Web**: `app.html` — `attachDrag` / `reorderEntities` (reorder within a
  section) and `isItemIntoCatDrop` / `moveItemToCategory` (drop a tile onto a
  category/subcategory chip to move it; never across People/Nouns/Verbs).
- **Native**: no drag code at all (`onDrag`/`onDrop` appear nowhere).
- Build: unlock (edit mode) → long-press-drag tiles in `SectionColumn`; drop on
  another tile = reorder, drop on a chip in `CategoryStrips` = move. Same
  server calls the web uses (`/api/items` order + categoryId updates).

### A2. Word-tile placeholder for image-less tiles
- **Web**: `makeTile` renders a dashed pink "word tile" (the label big in the
  square) when `imageKey` is null — the new-board look while renders stream in.
- **Native**: `TileView.loadImage()` guards out when `imageKey` is nil → blank
  square.
- Build: same friendly word-tile styling in `TileView` when `tile.imageKey == nil`.

### A3. Board-build progress pill + live refresh
- **Web**: `app.html` `#seed-banner` — polls `GET /api/onboarding/seed-core?childId=`
  every 12s while `active`, shows "Making {name}'s words… N of M", re-syncs so
  finished tiles pop in.
- **Native**: nothing; tiles only appear on the 2-minute resync or manual
  pull-to-refresh.
- Build: small overlay pill in `BoardView` + a `SeedStatus` poll (APIClient GET
  already exists server-side); call `board.refresh` when counts move.

### A4. Real child name in the title (not slug-derived)
- **Web**: board fetches `/api/persons` and uses the child's `given_name`
  (`loadChildName`), cached per child.
- **Native**: `worldTitle()`/`prettyChildName()` only prettify the slug — a
  numbered slug like `simon-5ba4` renders as "Simon-5ba4's World".
- Build: fetch the is_self person's given name once (AuthManager or BoardStore),
  cache it, and have `worldTitle`/`childPossessive` prefer it.

## B. Native parent app

### B1. Listening-mode remote button  ⭐ (part of the original listening ask)
- **Web**: parent dashboard toggle sends `listen-start` / `listen-stop` live
  commands.
- **Native**: `BoardView` *receives* those commands, but the native parent app
  has no sender — a parent on the native app can't put the board into
  listening mode remotely.
- Build: a card/toggle in `ParentHomeView` that posts the live command (same
  `/api/live` publish the web uses).

### B2. Board-build progress banner
- **Web**: `parent.html` `#build-banner` with progress bar ("keeps going if you
  close this page").
- **Native**: none.
- Build: same seed-status poll surfaced on `ParentHomeView`.

### B3. Word Store shopping (browse + cart + checkout in credits)
- **Web**: `store.html` — full shoppable library with previews, cart, checkout,
  whole-board rebuild card.
- **Native**: `StoreView` only buys credits/subscription (IAP). Spending
  credits on words in-app is Apple-compliant (credits were bought via IAP),
  so a native shop is allowed — it's just not built.
- Build: native browse (reuse `/api/store?action=browse`) + cart + checkout,
  or a deliberate decision to keep shopping web-only.

### B4. Coupon redeem
- **Web**: "Have a code?" box in the store.
- **Native**: none. Small: one text field + `POST /api/store?action=redeem`.

### B5. Out-of-credits (HTTP 402) handling  ⚠️ ships broken TODAY without this
- Adding a tile (`/api/generate-image`), photo tiles (`/api/tile-jobs`), and
  family adds (`/api/onboard-subject`) now return **402 not_enough_credits**
  for non-admin parents once the credits commit deploys.
- **Native**: `AddTileView` / `AddTileQueue` / people manager treat it as a
  generic failure — confusing dead end.
- Build: catch 402 → friendly "You're out of image credits" alert with a
  button into `StoreView`. This is the highest-priority item.

### B6. Free-retry regenerate button
- Server: `POST /api/store?action=retry` (one free per tile, then 1 credit) —
  **no client UI anywhere yet, web or native**.
- Build: a "Redraw this picture (free once)" button in the native tile edit
  sheet — and the web tile editor too.

## C. Deliberately web-only (confirm, then close)
- ZIP backup download (browser is the right surface for a big file).
- Admin tooling: taxonomy, Default board, Lab, Build-board rescue, coupons/grants.
- Progress charts (`charts.js`) — native has its own Stats screen.
- Onboarding webview flow fixes (404 link, numbered slugs) — server-side,
  already benefit both.

## Suggested order
1. **B5** 402 handling (regression guard for the credits launch)
2. **A1** drag-and-drop (the standing explicit ask)
3. **A2 + A3** word-tiles + build progress (new-family first impression)
4. **A4** real-name title
5. **B1** remote listening button
6. **B2** parent build banner
7. **B6** free-retry button (native + web)
8. **B3 + B4** native shop + coupon redeem (or decide web-only)

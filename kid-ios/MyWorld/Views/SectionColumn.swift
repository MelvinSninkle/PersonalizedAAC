import SwiftUI
import UIKit

/// One of the three main columns (People / Nouns / Verbs). Holds its own
/// selection state — no navigation drill-in. Layout: title → category tab
/// strip → subcategory strip → tile grid.
///
/// Locations special-case: if the selected category is `kind="location"`,
/// the grid renders that location's children as ROOM TILES (short-press
/// speaks, long-press opens the room's interior in an overlay). This lets a
/// parent build Places → Home → Kitchen → toaster without nesting four chip
/// strips deep.
struct SectionColumn: View {
    let section: BoardSection
    let tileSize: CGFloat
    /// When unlocked, the grid grows a dashed "+ Add tile" cell at the end that
    /// opens the add flow pre-set to this section + whatever folder is showing.
    var editMode: Bool = false
    var onAdd: (BoardSection, Int?) -> Void = { _, _ in }
    /// Tapping a tile while unlocked opens its editor (matching the web
    /// organizer). Bubbled up to BoardView, which presents the edit sheet.
    var onEditTile: (Tile) -> Void = { _ in }

    @Environment(BoardStore.self) private var board
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(AuthManager.self) private var auth
    @Environment(AddTileQueue.self) private var addQueue
    @Environment(AccessPrefs.self) private var access
    @Environment(BoardNav.self) private var nav
    @Environment(SentenceBar.self) private var sentence
    @State private var openRoom: Category?
    /// Button-navigation page for the tile grid (strips page themselves).
    @State private var gridPage = 0
    @State private var tilesPerPage = 20
    /// Live-shuffle drag preview: while a system drag session is in flight the
    /// OTHER tiles part to show the landing slot. `dragSourceId` is stamped by
    /// the draggable payload's @autoclosure the moment the lift happens;
    /// `previewIds` is the previewed order (nil = the stored order).
    @State private var dragSourceId: Int? = nil
    @State private var previewIds: [Int]? = nil

    // Selection is HOISTED into BoardNav (it was per-column @State) so
    // listening repeat-navigate can select a category from the header.
    private var selectedCategoryId: Int? { nav.category(section) }
    private var selectedSubcategoryId: Int? { nav.subcategory(section) }
    private var catBinding: Binding<Int?> {
        Binding(get: { nav.category(section) }, set: { nav.setCategory(section, $0) })
    }
    private var subBinding: Binding<Int?> {
        Binding(get: { nav.subcategory(section) }, set: { nav.setSubcategory(section, $0) })
    }

    /// Top-level category label at the moment of tap — landed alongside the
    /// event so the analytics Use chart + Top Words grouping work. We resolve
    /// it from the selected ids rather than effectiveCategory so a tap inside
    /// a subcategory still attributes to the visible top-level chip.
    private var activeCategoryName: String? {
        let roots = board.roots(in: section)
        return roots.first(where: { $0.id == selectedCategoryId })?.label
            ?? roots.first?.label
    }
    private var activeSubcategoryName: String? {
        guard let subId = selectedSubcategoryId else { return nil }
        return board.categories.first(where: { $0.id == subId })?.label
    }
    private func playWithLogging(_ t: Tile, fallbackCategory: String? = nil) {
        // Sentence mode (the pencil): a tap IS the stage — silent; ▶ speaks.
        if sentence.mode && !editMode {
            sentence.stage(t, idleMinutes: access.sentenceIdleMin)
            TilePlayer.shared.logOnly(t, childId: auth.childSlug,
                                      categoryName: fallbackCategory ?? activeCategoryName,
                                      subcategoryName: activeSubcategoryName)
            return
        }
        Task {
            await TilePlayer.shared.play(
                t,
                childId: auth.childSlug,
                categoryName: fallbackCategory ?? activeCategoryName,
                subcategoryName: activeSubcategoryName
            )
        }
    }

    private var bandColor: Color { Color(hex: prefs.color(section)).opacity(0.7) }

    var body: some View {
        VStack(spacing: 0) {
            if !prefs.hideLabels {
                Text(section.label)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            }

            let cats = board.roots(in: section)
            CategoryTabStrip(categories: cats,
                             selectedId: noting(catBinding),
                             hideLabels: prefs.hideLabels,
                             paged: (access.buttonsNav || sentence.mode) && !editMode,
                             onDropTile: chipDropHandler,
                             onReorder: editMode ? { ids in persistCatOrder(ids) } : nil)

            if let cat = activeCategory(in: cats), !board.children(of: cat).isEmpty {
                SubcategoryStrip(subcategories: board.children(of: cat),
                                 selectedId: noting(subBinding),
                                 hideLabels: prefs.hideLabels,
                                 paged: (access.buttonsNav || sentence.mode) && !editMode,
                                 onDropTile: chipDropHandler,
                                 onReorder: editMode ? { ids in persistCatOrder(ids) } : nil)
            }

            tilesGrid
        }
        .background(bandColor)
        .onAppear { ensureSelection(in: cats) }
        .onChange(of: cats.map(\.id)) { _, _ in ensureSelection(in: cats) }
        .onChange(of: selectedCategoryId) { _, _ in
            nav.setSubcategory(section, nil)
            openRoom = nil
            gridPage = 0
        }
        .onChange(of: selectedSubcategoryId) { _, _ in gridPage = 0 }
        // A cancelled system drag has no callback — locking the board, or the
        // next refresh re-keying the tile list, is what clears a stale preview.
        .onChange(of: editMode) { _, _ in previewIds = nil; dragSourceId = nil }
        // Listening repeat-navigate landed on a tile in THIS column: jump the
        // paged grid to its page (scroll mode scrolls inside normalTilesGrid).
        .onChange(of: nav.highlight) { _, h in
            guard let h, h.section == section, access.buttonsNav || sentence.mode, !editMode else { return }
            let tiles = effectiveCategory.map { board.tiles(in: $0) } ?? []
            if let idx = tiles.firstIndex(where: { $0.id == h.tileId }) {
                gridPage = idx / max(1, tilesPerPage)
            }
        }
        // Tap a subcategory chip → speak it (only for location chips, matching
        // the user's "click a location subcategory speaks its name" intent).
        .onChange(of: selectedSubcategoryId) { _, newId in
            openRoom = nil
            guard let id = newId,
                  let chip = board.categories.first(where: { $0.id == id }),
                  chip.isLocation else { return }
            speakCategory(chip)
        }
        // Room interior — the child long-pressed a room; long-press exits.
        .fullScreenCover(item: $openRoom) { room in
            RoomInteriorView(room: room, editMode: editMode, onEditTile: onEditTile) { openRoom = nil }
        }
    }

    private var cats: [Category] { board.roots(in: section) }

    private func activeCategory(in cats: [Category]) -> Category? {
        cats.first(where: { $0.id == selectedCategoryId }) ?? cats.first
    }

    /// The category whose contents the grid should show. Usually the selected
    /// subcategory (or the top-level category if it has no children).
    private var effectiveCategory: Category? {
        let cats = self.cats
        guard let active = activeCategory(in: cats) else { return nil }
        let subs = board.children(of: active)
        if !subs.isEmpty {
            return subs.first(where: { $0.id == selectedSubcategoryId }) ?? subs.first
        }
        return active
    }

    private func ensureSelection(in cats: [Category]) {
        if selectedCategoryId == nil || !cats.contains(where: { $0.id == selectedCategoryId }) {
            nav.setCategory(section, cats.first?.id)
        }
    }

    /// Wraps a chip-selection binding so every REAL press (the strips only
    /// write through the binding on taps — programmatic resets like
    /// ensureSelection write the @State directly) is remembered as the scope
    /// the header Play button quizzes next.
    private func noting(_ base: Binding<Int?>) -> Binding<Int?> {
        Binding(
            get: { base.wrappedValue },
            set: { id in
                base.wrappedValue = id
                if let id { GameController.PlayScope.note("cat:\(id)", slug: auth.childSlug) }
            }
        )
    }

    // MARK: -- Grid

    @ViewBuilder
    private var tilesGrid: some View {
        if let active = effectiveCategory, active.isLocation {
            roomsGrid(for: active)
        } else {
            normalTilesGrid
        }
    }

    /// Cell identity INCLUDES the lock state. The conditional wrappers below
    /// (draggableIf + the sentence-lift gesture branch) change a cell's
    /// structure when the board locks/unlocks, and the lazy grid was reusing
    /// stale cells across that flip — unlocking marked only some tiles
    /// editable and re-locking left pencil badges behind. A fresh identity
    /// per lock state forces every cell to rebuild. scrollTo() must use the
    /// same key.
    private func cellKey(_ tileId: Int) -> String {
        "\(tileId)-\(editMode ? "e" : "p")-\(dragStaging ? "d" : "n")"
    }

    /// Drag-to-bar staging enabled (the original sentence gesture, restored
    /// behind the parent-set `sentenceDrag`; coexists with the ✏️ pencil).
    private var dragStaging: Bool { access.sentenceDrag && access.sentenceBuilder && !editMode }

    /// One grid cell: the tile, the edit-mode drag plumbing, the transient
    /// listen-navigate highlight, and (when the sentence constructor is on)
    /// the lift gesture that carries a copy up to the header bar.
    @ViewBuilder
    private func tileCell(_ tile: Tile) -> some View {
        let base = TileView(tile: tile, onTap: { t in playWithLogging(t) },
                            editMode: editMode, onEdit: onEditTile,
                            posterMode: effectiveCategory?.isPoster ?? false)
            .frame(width: tileSize)
            .overlay {
                if nav.highlight?.tileId == tile.id {
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(Color(hex: "#ffd400"), lineWidth: 5)
                        .shadow(color: Color(hex: "#ffd400").opacity(0.6), radius: 8)
                }
            }
            .id(cellKey(tile.id))
            // Unlocked-board drag: long-press-drag a tile onto another
            // tile to reorder, or onto a category/subcategory chip to
            // move it there. The payload carries the section so a tile
            // can never cross the People/Nouns/Verbs family boundary.
            // Only attached while unlocked — the child's long-presses
            // must never start a drag session.
            .draggableIf(editMode, dragPayload(tile))
            .dropDestination(for: String.self) { items, _ in
                handleTileDrop(items, onto: tile)
            } isTargeted: { over in
                if over { previewShuffle(around: tile) }
            }
        if dragStaging {
            base.simultaneousGesture(quickLift(tile))
        } else {
            base
        }
    }

    /// The ORIGINAL sentence gesture: lift on first movement (24pt), the
    /// ghost follows in the shared "board" space, drop on the header bar to
    /// stage. Runs as a simultaneousGesture so scrolling keeps working — the
    /// scroll pan and the lift coexist, which is why it feels invisible.
    private func quickLift(_ tile: Tile) -> some Gesture {
        DragGesture(minimumDistance: 24, coordinateSpace: .named("board"))
            .onChanged { sentence.dragUpdate(tile, at: $0.location) }
            .onEnded { if sentence.dragEnd(at: $0.location) { stageTile(tile) } }
    }

    private func stageTile(_ tile: Tile) {
        sentence.stage(tile, idleMinutes: access.sentenceIdleMin)
        TilePlayer.shared.logOnly(tile, childId: auth.childSlug,
                                  categoryName: activeCategoryName,
                                  subcategoryName: activeSubcategoryName)
    }

    private var normalTilesGrid: some View {
        let tiles = applyPreview(effectiveCategory.map { board.tiles(in: $0) } ?? [])
        let cols = max(1, prefs.across(section))
        let gridCols = Array(repeating: GridItem(.fixed(tileSize), spacing: BoardMetrics.tileGap),
                             count: cols)
        // Button navigation replaces scrolling with whole-page turns: only
        // full tiles render on a page, so the tile that WOULD have been cut
        // off is exactly the first tile of the next page.
        if (access.buttonsNav || sentence.mode) && !editMode {
            return AnyView(pagedGrid(tiles: tiles, cols: cols, gridCols: gridCols))
        }
        return AnyView(ScrollViewReader { proxy in
            ScrollView {
            LazyVGrid(columns: gridCols, alignment: .leading, spacing: BoardMetrics.tileGap) {
                ForEach(tiles) { tile in
                    tileCell(tile)
                }
                // In-flight adds land WHERE THE + CELL WAS: each rendering job
                // for this folder shows as a "Pending" placeholder in the
                // grid. Shown even when the board is LOCKED — parents were
                // closing the add flow and worrying the photo was lost; the
                // placeholder is the "don't worry, it's coming" signal. When
                // the render finishes, the real tile takes the placeholder's
                // spot (new tiles order to the end of the folder — here).
                ForEach(renderingJobs, id: \.id) { job in
                    RenderingTileCell(size: tileSize, thumbnail: job.thumbnail, label: job.label)
                        .frame(width: tileSize)
                }
                if editMode {
                    AddTileCell(size: tileSize) { onAdd(section, effectiveCategory?.id) }
                        .frame(width: tileSize)
                }
            }
            .padding(.horizontal, BoardMetrics.columnPad)
            .padding(.vertical, 8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // Catch-all: releasing anywhere over the grid (not on a specific
            // cell) commits whatever the live shuffle is showing — the parent
            // drops "what they see". Also our only reliable end-of-drag hook.
            .dropDestination(for: String.self) { items, _ in
                guard let dragId = draggedTileId(items), let cat = effectiveCategory,
                      let ids = previewIds, ids.contains(dragId) else { return false }
                commitPreview(in: cat)
                return true
            }
            .onChange(of: nav.highlight) { _, h in
                guard let h, h.section == section else { return }
                withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo(cellKey(h.tileId), anchor: .center) }
            }
        })
    }

    /// Paged grid for button-navigation mode: a whole fresh screen per press.
    private func pagedGrid(tiles: [Tile], cols: Int, gridCols: [GridItem]) -> some View {
        GeometryReader { geo in
            let cellH = tileSize + (prefs.hideLabels ? 0 : 24) + BoardMetrics.tileGap
            let rows = max(1, Int((geo.size.height - 62) / cellH))
            let per = max(1, rows * cols)
            let pageCount = max(1, Int(ceil(Double(tiles.count) / Double(per))))
            let page = min(gridPage, pageCount - 1)
            let slice = Array(tiles.dropFirst(page * per).prefix(per))
            VStack(spacing: 0) {
                LazyVGrid(columns: gridCols, alignment: .leading, spacing: BoardMetrics.tileGap) {
                    ForEach(slice) { tile in tileCell(tile) }
                }
                .padding(.horizontal, BoardMetrics.columnPad)
                .padding(.vertical, 8)
                Spacer(minLength: 0)
                if pageCount > 1 {
                    PagerBar(vertical: true, page: page, pageCount: pageCount,
                             onPrev: { gridPage = max(0, page - 1) },
                             onNext: { gridPage = min(pageCount - 1, page + 1) })
                }
            }
            .onAppear { tilesPerPage = per }
            .onChange(of: per) { _, v in tilesPerPage = v }
        }
    }

    /// Active add-tile jobs headed for the folder on screen right now.
    private var renderingJobs: [TileJob] {
        addQueue.jobs.filter { j in
            j.phase == .working && j.section == section
                && (j.categoryId == effectiveCategory?.id || (j.categoryId == nil && effectiveCategory?.id == nil))
        }
    }

    // MARK: -- Drag & drop (unlocked board only)

    /// Payload → tile id, enforcing the same-section rule ("no crossing the
    /// major tile families").
    private func draggedTileId(_ items: [String]) -> Int? {
        guard editMode, let s = items.first else { return nil }
        let parts = s.split(separator: "|")
        guard parts.count == 3, parts[0] == "tile",
              parts[1] == section.rawValue,
              let id = Int(parts[2]) else { return nil }
        return id
    }

    /// The draggable payload — an @autoclosure evaluated when the system drag
    /// session actually LIFTS, which is our only start-of-drag signal. The
    /// side effect stamps the source tile so hover events can shuffle.
    private func dragPayload(_ tile: Tile) -> String {
        Task { @MainActor in
            dragSourceId = tile.id
            previewIds = nil
        }
        return "tile|\(section.rawValue)|\(tile.id)"
    }

    /// Live shuffle: hovering a sibling moves the lifted tile to that slot in
    /// a previewed order, so the gap always shows where the drop lands. Only
    /// same-category tiles shuffle; a cross-category drag keeps the old
    /// insert-at-target behavior on drop.
    private func previewShuffle(around target: Tile) {
        guard editMode, let dragId = dragSourceId, dragId != target.id,
              let cat = effectiveCategory else { return }
        var ids = previewIds ?? board.tiles(in: cat).map(\.id)
        guard let di = ids.firstIndex(of: dragId),
              let ti = ids.firstIndex(of: target.id) else { return }
        ids.remove(at: di)
        ids.insert(dragId, at: ti)
        withAnimation(.easeInOut(duration: 0.18)) { previewIds = ids }
    }

    /// Reorder `base` by the previewed ids (unlisted tiles keep their relative
    /// order at the end). Identity — not a copy dance — when no preview is up.
    private func applyPreview(_ base: [Tile]) -> [Tile] {
        guard editMode, let ids = previewIds else { return base }
        let by = Dictionary(uniqueKeysWithValues: base.map { ($0.id, $0) })
        var out = ids.compactMap { by[$0] }
        out += base.filter { !ids.contains($0.id) }
        return out
    }

    /// LOCAL-FIRST commit: the board's own data takes the previewed order the
    /// instant the finger lifts (no waiting on the network), then ONE bulk
    /// call syncs the server in the background — with a per-item fallback so
    /// an app newer than the deploy still lands the order.
    private func commitPreview(in cat: Category) {
        dragSourceId = nil
        let ids = previewIds ?? []
        let base = board.tiles(in: cat)
        var orderedIds = ids.filter { id in base.contains { $0.id == id } }
        orderedIds += base.map(\.id).filter { !orderedIds.contains($0) }
        board.applyLocalTileOrder(orderedIds)
        previewIds = nil
        Task {
            let api = APIClient()
            do { try await api.reorderItems(ids: orderedIds) }
            catch {
                for (i, id) in orderedIds.enumerated() {
                    _ = try? await api.updateItem(id: id, order: i * 1000, childId: auth.childSlug)
                }
            }
            await board.refresh(childId: auth.childSlug)
        }
    }

    /// Drop on a TILE: if the live shuffle previewed an order, that order IS
    /// the answer — persist it. Otherwise (cross-category drag-in) fall back
    /// to insert-at-target.
    private func handleTileDrop(_ items: [String], onto target: Tile) -> Bool {
        guard let dragId = draggedTileId(items), let cat = effectiveCategory else { return false }
        if let ids = previewIds, ids.contains(dragId) {
            commitPreview(in: cat)
            return true
        }
        guard dragId != target.id else { return false }
        Task { await reorderOrMove(draggedId: dragId, targetId: target.id, in: cat) }
        return true
    }

    /// Drop on a CATEGORY / SUBCATEGORY chip: move the tile into that folder,
    /// landing at the end (same semantics as the web's moveItemToCategory).
    private var chipDropHandler: (Category, [String]) -> Bool {
        { chip, items in
            guard let dragId = draggedTileId(items) else { return false }
            previewIds = nil            // folder move beats the reorder preview
            dragSourceId = nil
            Task { await moveTile(dragId, toCategory: chip.id) }
            return true
        }
    }

    private func reorderOrMove(draggedId: Int, targetId: Int, in cat: Category) async {
        var list = board.tiles(in: cat)
        guard let ti = list.firstIndex(where: { $0.id == targetId }) else { return }
        let api = APIClient()
        if let di = list.firstIndex(where: { $0.id == draggedId }) {
            guard di != ti else { return }
            let moved = list.remove(at: di)
            list.insert(moved, at: di < ti ? ti - 1 : ti)
            for (i, t) in list.enumerated() {
                let newOrder = i * 1000
                if t.order != newOrder {
                    _ = try? await api.updateItem(id: t.id, order: newOrder, childId: auth.childSlug)
                }
            }
        } else {
            // Dragged in from another category of this section — insert at the
            // target's position: move first, then resequence around it.
            _ = try? await api.updateItem(id: draggedId, category: .set(cat.id),
                                          order: (list[ti].order) - 500, childId: auth.childSlug)
        }
        await board.refresh(childId: auth.childSlug)
    }

    /// Persist a chip strip's previewed order — LOCAL-FIRST (the strip settles
    /// instantly), then one bulk call in the background with a per-chip
    /// fallback for older deploys.
    private func persistCatOrder(_ ids: [Int]) {
        board.applyLocalCategoryOrder(ids)
        Task {
            let api = APIClient()
            do { try await api.reorderCategories(ids: ids) }
            catch {
                for (i, id) in ids.enumerated() {
                    _ = try? await api.updateCategory(id: id, order: i * 1000, childId: auth.childSlug)
                }
            }
            await board.refresh(childId: auth.childSlug)
        }
    }

    private func moveTile(_ tileId: Int, toCategory catId: Int) async {
        guard let tile = board.tiles.first(where: { $0.id == tileId }),
              tile.categoryId != catId else { return }
        let maxOrder = board.tiles.filter { $0.categoryId == catId }.map(\.order).max() ?? 0
        _ = try? await APIClient().updateItem(id: tileId, category: .set(catId),
                                              order: maxOrder + 1000, childId: auth.childSlug)
        await board.refresh(childId: auth.childSlug)
    }

    /// When the selected chip is a LOCATION, the grid shows that location's
    /// children as room tiles. Each room: tap to speak, long-press to open.
    /// A location without configured rooms falls back to its items (parent
    /// hasn't built out rooms yet — still useful, doesn't 404).
    private func roomsGrid(for location: Category) -> some View {
        let rooms = board.children(of: location)
        let cols = max(1, prefs.across(section))
        let gridCols = Array(repeating: GridItem(.fixed(tileSize), spacing: BoardMetrics.tileGap),
                             count: cols)
        return ScrollView {
            if rooms.isEmpty {
                // No rooms configured — show this location's items like normal.
                LazyVGrid(columns: gridCols, alignment: .leading, spacing: BoardMetrics.tileGap) {
                    ForEach(board.tiles(in: location)) { tile in
                        TileView(tile: tile,
                                 onTap: { t in playWithLogging(t, fallbackCategory: location.label) },
                                 editMode: editMode, onEdit: onEditTile,
                                 posterMode: location.isPoster)
                        .frame(width: tileSize)
                    }
                }
                .padding(.horizontal, BoardMetrics.columnPad)
                .padding(.vertical, 8)
            } else {
                LazyVGrid(columns: gridCols, alignment: .leading, spacing: BoardMetrics.tileGap) {
                    ForEach(rooms) { room in
                        RoomTile(
                            category: room,
                            onTap:        { speakCategory(room) },
                            onLongPress:  { openRoom = room }
                        )
                        .frame(width: tileSize)
                    }
                }
                .padding(.horizontal, BoardMetrics.columnPad)
                .padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Speak a category's label using the app voice (same path the tile audio
    /// uses, falling back to system TTS when no recorded sound exists).
    private func speakCategory(_ cat: Category) {
        GameAudio.shared.speak(cat.label, childId: auth.childSlug)
    }
}

/// Conditionally-attached drag source: only unlocked boards make tiles
/// draggable, so a child's long-press can never start a drag session.
/// The payload is @autoclosure and forwarded lazily — .draggable evaluates it
/// when the drag session LIFTS, which lets call sites piggyback a
/// start-of-drag side effect (there is no other SwiftUI drag-start hook).
extension View {
    @ViewBuilder
    func draggableIf(_ condition: Bool, _ payload: @autoclosure @escaping () -> String) -> some View {
        if condition { self.draggable(payload()) } else { self }
    }
}

/// The dashed "➕ Add tile" cell at the end of a section's grid (and the Needs
/// strip) while the board is unlocked — the discoverable, in-grid way to add a
/// tile, pre-set to the section you're looking at. Hidden when locked, so the
/// child never sees it.
///
/// NOTE: lives in this already-tracked file (rather than its own) so it builds
/// without re-running `xcodegen generate` for a brand-new file.
struct AddTileCell: View {
    let size: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: "plus")
                    .font(.system(size: size * 0.30, weight: .semibold))
                Text("Add tile")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(Color(hex: "#ff1493"))
            .frame(width: size, height: size)
            .background(Color.white.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color(hex: "#ff1493").opacity(0.65),
                                  style: StrokeStyle(lineWidth: 2, dash: [7, 5]))
            )
        }
        .buttonStyle(.plain)
    }
}

/// A tile-sized "Pending" placeholder for an add-tile job still rendering
/// server-side: the captured photo (dimmed) with a spinner — or, when the
/// photo isn't on this device (app restarted / added elsewhere), the
/// My World logo. Sits exactly where the finished tile will land.
struct RenderingTileCell: View {
    let size: CGFloat
    let thumbnail: UIImage
    let label: String

    private var hasPhoto: Bool { thumbnail.size.width > 0 }

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                if hasPhoto {
                    Image(uiImage: thumbnail)
                        .resizable()
                        .scaledToFill()
                        .frame(width: size, height: size)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .opacity(0.45)
                } else {
                    Color.white.opacity(0.6)
                    Image("MyWorldLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: size * 0.55, height: size * 0.55)
                        .opacity(0.5)
                }
                ProgressView()
                    .tint(Color(hex: "#ad1457"))
                    .scaleEffect(1.2)
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color(hex: "#f3c6dd"), lineWidth: 2)
            )
            Text(label.isEmpty ? "Pending" : "\(label), pending")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Color(hex: "#9d2463"))
                .lineLimit(1)
        }
    }
}

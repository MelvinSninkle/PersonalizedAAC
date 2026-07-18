import SwiftUI
import UIKit

/// The "Needs" section in the web app renders as a single horizontal strip
/// across the bottom of the board — the most-used words (yes, no, hi, eat,
/// drink, more, all done, …) one tap away no matter which column has focus.
/// All Needs-section tiles show up here in display_order.
struct NeedsStrip: View {
    /// The uniform board tile size — passed in so Needs tiles match the
    /// People/Nouns/Verbs tiles exactly (the web does the same, sizing each
    /// Needs tile to width ÷ total-tiles-across).
    let tileSize: CGFloat
    /// When unlocked, the strip grows a dashed "+ Add tile" cell that opens the
    /// add flow pre-set to the Needs section.
    var editMode: Bool = false
    var onAdd: () -> Void = {}
    /// Tapping a Needs tile while unlocked opens its editor (bubbled to BoardView).
    var onEditTile: (Tile) -> Void = { _ in }

    @Environment(BoardStore.self) private var board
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(AuthManager.self) private var auth
    @Environment(AccessPrefs.self) private var access
    @Environment(SentenceBar.self) private var sentence
    @State private var page = 0
    /// Live-shuffle drag preview (see SectionColumn) — siblings part to show
    /// the landing slot while a strip tile is lifted.
    @State private var dragSourceId: Int? = nil
    @State private var previewIds: [Int]? = nil

    private var tiles: [Tile] {
        board.tiles
            .filter { $0.section == .needs }
            .sorted { (a, b) in
                if a.pinned != b.pinned { return a.pinned }    // pinned first
                if a.order != b.order   { return a.order < b.order }
                return a.id < b.id
            }
    }

    private var orderedTiles: [Tile] {
        guard editMode, let ids = previewIds else { return tiles }
        let base = tiles
        let by = Dictionary(uniqueKeysWithValues: base.map { ($0.id, $0) })
        var out = ids.compactMap { by[$0] }
        out += base.filter { !ids.contains($0.id) }
        return out
    }

    /// Height hugs the content: the square image, plus the label band only
    /// when labels are shown, plus the vertical padding. No dead space.
    private var stripHeight: CGFloat {
        tileSize + (prefs.hideLabels ? 0 : 24) + 16
    }

    var body: some View {
        // Locked + empty → nothing. Unlocked → always show the strip so the
        // "+ Add tile" cell is reachable even before any Needs tiles exist.
        if tiles.isEmpty && !editMode {
            EmptyView()
        } else if (access.buttonsNav || sentence.mode) && !editMode {
            // Button navigation: whole-page turns instead of a sideways scroll.
            GeometryReader { geo in
                let per = max(1, Int((geo.size.width - 108) / (tileSize + BoardMetrics.tileGap)))
                let pageCount = max(1, Int(ceil(Double(tiles.count) / Double(per))))
                let p = min(page, pageCount - 1)
                let slice = Array(tiles.dropFirst(p * per).prefix(per))
                HStack(spacing: BoardMetrics.tileGap) {
                    stripPaddle("chevron.left", disabled: p <= 0) { page = max(0, p - 1) }
                        .opacity(pageCount > 1 ? 1 : 0)
                    ForEach(slice) { tile in needsCell(tile) }
                    Spacer(minLength: 0)
                    stripPaddle("chevron.right", disabled: p >= pageCount - 1) { page = min(pageCount - 1, p + 1) }
                        .opacity(pageCount > 1 ? 1 : 0)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
            .frame(height: stripHeight)
            .background(Color(hex: prefs.colorNeeds))
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: BoardMetrics.tileGap) {
                    ForEach(orderedTiles) { tile in
                        needsCell(tile)
                        // Unlocked drag-to-reorder within the strip (Needs is
                        // flat — no categories, and never crosses sections).
                        // The @autoclosure payload stamps the drag source at
                        // lift; hover shuffles the preview (see SectionColumn).
                        .draggableIf(editMode, needsPayload(tile))
                        .dropDestination(for: String.self) { items, _ in
                            handleDrop(items, onto: tile)
                        } isTargeted: { over in
                            if over { previewShuffle(around: tile) }
                        }
                    }
                    if editMode {
                        AddTileCell(size: tileSize) { onAdd() }
                            .frame(width: tileSize)
                    }
                }
                .padding(.horizontal, BoardMetrics.columnPad)
                .padding(.vertical, 8)
            }
            .frame(height: stripHeight)
            .background(Color(hex: prefs.colorNeeds))
            .onChange(of: editMode) { _, _ in previewIds = nil; dragSourceId = nil }
            .onChange(of: tiles.map(\.id)) { _, _ in previewIds = nil }
        }
    }

    private func needsPayload(_ tile: Tile) -> String {
        Task { @MainActor in
            dragSourceId = tile.id
            previewIds = nil
        }
        return "tile|needs|\(tile.id)"
    }

    private func previewShuffle(around target: Tile) {
        guard editMode, let dragId = dragSourceId, dragId != target.id else { return }
        var ids = previewIds ?? tiles.map(\.id)
        guard let di = ids.firstIndex(of: dragId),
              let ti = ids.firstIndex(of: target.id) else { return }
        ids.remove(at: di)
        ids.insert(dragId, at: ti)
        withAnimation(.easeInOut(duration: 0.18)) { previewIds = ids }
    }

    /// One Needs tile with the sentence-constructor lift attached when it's on
    /// — the core words (more, eat, all done) belong in built sentences too.
    /// The explicit identity includes the lock state for the same reason as
    /// SectionColumn.cellKey: the conditional wrappers change the cell's
    /// structure on lock/unlock and lazy reuse left stale pencil badges.
    @ViewBuilder
    private func needsCell(_ tile: Tile) -> some View {
        let base = TileView(tile: tile,
                            onTap: { t in
                                // Sentence mode: a tap IS the stage — silent.
                                if sentence.mode && !editMode {
                                    sentence.stage(t, idleMinutes: access.sentenceIdleMin)
                                    TilePlayer.shared.logOnly(t, childId: auth.childSlug, categoryName: "Needs")
                                    return
                                }
                                Task {
                                    await TilePlayer.shared.play(
                                        t,
                                        childId: auth.childSlug,
                                        categoryName: "Needs"
                                    )
                                }
                            },
                            editMode: editMode, onEdit: onEditTile)
            .frame(width: tileSize)
            .id("\(tile.id)-\(editMode ? "e" : "p")-\(dragStaging ? "d" : "n")")
        if dragStaging {
            base.simultaneousGesture(quickLift(tile))
        } else {
            base
        }
    }

    private var dragStaging: Bool { access.sentenceDrag && access.sentenceBuilder && !editMode }

    /// See SectionColumn.quickLift — the original drag-to-bar stage gesture.
    private func quickLift(_ tile: Tile) -> some Gesture {
        DragGesture(minimumDistance: 24, coordinateSpace: .named("board"))
            .onChanged { sentence.dragUpdate(tile, at: $0.location) }
            .onEnded { if sentence.dragEnd(at: $0.location) { stageTile(tile) } }
    }

    private func stageTile(_ tile: Tile) {
        sentence.stage(tile, idleMinutes: access.sentenceIdleMin)
        TilePlayer.shared.logOnly(tile, childId: auth.childSlug, categoryName: "Needs")
    }

    private func stripPaddle(_ icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color(hex: "#2b3a55"))
                .frame(width: 44, height: tileSize)
                .background(RoundedRectangle(cornerRadius: 12).fill(.white))
                .overlay(RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(hex: "#c9d5e8"), lineWidth: 2))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.25 : 1)
    }

    /// Reorder within the strip. When the live shuffle previewed an order,
    /// persist exactly that (the preview stays up until the refresh re-keys
    /// it); otherwise the original splice on the drop target.
    private func handleDrop(_ items: [String], onto target: Tile) -> Bool {
        guard editMode, let s = items.first else { return false }
        let parts = s.split(separator: "|")
        guard parts.count == 3, parts[0] == "tile", parts[1] == "needs",
              let dragId = Int(parts[2]) else { return false }
        if let ids = previewIds, ids.contains(dragId) {
            dragSourceId = nil
            // LOCAL-FIRST: the strip settles now; one bulk sync follows.
            let orderedIds = orderedTiles.map(\.id)
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
            return true
        }
        guard dragId != target.id else { return false }
        Task {
            var list = tiles
            guard let di = list.firstIndex(where: { $0.id == dragId }),
                  let ti = list.firstIndex(where: { $0.id == target.id }), di != ti else { return }
            let moved = list.remove(at: di)
            list.insert(moved, at: di < ti ? ti - 1 : ti)
            let api = APIClient()
            for (i, t) in list.enumerated() {
                let newOrder = i * 1000
                if t.order != newOrder {
                    _ = try? await api.updateItem(id: t.id, order: newOrder, childId: auth.childSlug)
                }
            }
            await board.refresh(childId: auth.childSlug)
        }
        return true
    }
}

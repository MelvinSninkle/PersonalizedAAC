import SwiftUI

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

    private var tiles: [Tile] {
        board.tiles
            .filter { $0.section == .needs }
            .sorted { (a, b) in
                if a.pinned != b.pinned { return a.pinned }    // pinned first
                if a.order != b.order   { return a.order < b.order }
                return a.id < b.id
            }
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
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: BoardMetrics.tileGap) {
                    ForEach(tiles) { tile in
                        TileView(tile: tile,
                                 onTap: { t in
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
                        // Unlocked drag-to-reorder within the strip (Needs is
                        // flat — no categories, and never crosses sections).
                        .draggableIf(editMode, "tile|needs|\(tile.id)")
                        .dropDestination(for: String.self) { items, _ in
                            handleDrop(items, onto: tile)
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
        }
    }

    /// Reorder within the strip — same splice + i*1000 resequence as the web.
    private func handleDrop(_ items: [String], onto target: Tile) -> Bool {
        guard editMode, let s = items.first else { return false }
        let parts = s.split(separator: "|")
        guard parts.count == 3, parts[0] == "tile", parts[1] == "needs",
              let dragId = Int(parts[2]), dragId != target.id else { return false }
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

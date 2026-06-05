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

    @Environment(BoardStore.self) private var board
    @Environment(DisplayPrefs.self) private var prefs

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
                        TileView(tile: tile) { t in
                            Task { await TilePlayer.shared.play(t) }
                        }
                        .frame(width: tileSize)
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
}

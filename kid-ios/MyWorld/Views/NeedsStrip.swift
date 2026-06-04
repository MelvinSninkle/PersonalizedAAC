import SwiftUI

/// The "Needs" section in the web app renders as a single horizontal strip
/// across the bottom of the board — the most-used words (yes, no, hi, eat,
/// drink, more, all done, …) one tap away no matter which column has focus.
/// All Needs-section tiles show up here in display_order.
struct NeedsStrip: View {
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

    /// Width of each Needs tile.
    private let tileWidth: CGFloat = 104

    /// Height hugs the content: the square image, plus the label band only
    /// when labels are shown, plus the vertical padding. No dead space.
    private var stripHeight: CGFloat {
        tileWidth + (prefs.hideLabels ? 0 : 24) + 16
    }

    var body: some View {
        if tiles.isEmpty {
            EmptyView()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tiles) { tile in
                        TileView(tile: tile) { t in
                            Task { await TilePlayer.shared.play(t) }
                        }
                        .frame(width: tileWidth)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
            .frame(height: stripHeight)
            .background(Color(hex: prefs.colorNeeds))
        }
    }
}

import SwiftUI

/// The pinned-tiles strip — always visible across the bottom of the board so
/// the high-frequency requests (more, all done, eat, drink, …) are one tap
/// away from anywhere.
struct PersistentStripView: View {
    let tiles: [Tile]
    let onTap: (Tile) -> Void

    var body: some View {
        if tiles.isEmpty {
            EmptyView()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(tiles) { tile in
                        TileView(tile: tile, onTap: onTap)
                            .frame(width: 110)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .background(Color(hex: "#fff7e6"))
        }
    }
}

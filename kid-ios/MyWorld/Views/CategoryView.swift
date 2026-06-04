import SwiftUI

/// Inside a category: shows the tiles directly inside it plus any sub-folders.
struct CategoryView: View {
    let category: Category
    @Environment(BoardStore.self) private var board

    private var subcategories: [Category] { board.children(of: category) }
    private var tiles: [Tile] { board.tiles(in: category) }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140, maximum: 200), spacing: 14)], spacing: 14) {
                ForEach(subcategories) { sub in
                    NavigationLink(value: sub) {
                        CategoryTile(category: sub)
                    }
                    .buttonStyle(TileButtonStyle())
                }
                ForEach(tiles) { tile in
                    TileView(tile: tile) { t in
                        Task { await TilePlayer.shared.play(t) }
                    }
                }
            }
            .padding(14)
        }
        .navigationTitle(category.label)
        .navigationBarTitleDisplayMode(.inline)
        .background(Color(hex: category.section.bandHex).opacity(0.4))
    }
}

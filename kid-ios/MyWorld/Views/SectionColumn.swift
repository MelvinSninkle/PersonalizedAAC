import SwiftUI

/// One of the three main columns (People / Nouns / Verbs). Holds its own
/// selection state — no navigation drill-in. Mirrors the web app's per-section
/// layout: title → category tab strip → subcategory strip → tile grid.
struct SectionColumn: View {
    let section: BoardSection
    let tileSize: CGFloat

    @Environment(BoardStore.self) private var board
    @Environment(DisplayPrefs.self) private var prefs
    @State private var selectedCategoryId: Int?
    @State private var selectedSubcategoryId: Int?

    /// The section band color the tiles + subcategory strip sit on.
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
                    .background(Color.white.opacity(0.6))
            }

            // Top-level category strip
            let cats = board.roots(in: section)
            CategoryTabStrip(categories: cats,
                             selectedId: $selectedCategoryId,
                             hideLabels: prefs.hideLabels)

            // Subcategory strip — only if the active category has children.
            // It shares the section band color so it blends with the tiles
            // directly underneath it (rather than the old gray tint).
            if let cat = activeCategory(in: cats), !board.children(of: cat).isEmpty {
                SubcategoryStrip(subcategories: board.children(of: cat),
                                 selectedId: $selectedSubcategoryId,
                                 hideLabels: prefs.hideLabels)
            }

            tilesGrid
        }
        .background(bandColor)
        .onAppear { ensureSelection(in: cats) }
        .onChange(of: cats.map(\.id)) { _, _ in ensureSelection(in: cats) }
        .onChange(of: selectedCategoryId) { _, _ in
            selectedSubcategoryId = nil
        }
    }

    private var cats: [Category] { board.roots(in: section) }

    private func activeCategory(in cats: [Category]) -> Category? {
        cats.first(where: { $0.id == selectedCategoryId }) ?? cats.first
    }

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
            selectedCategoryId = cats.first?.id
        }
    }

    @ViewBuilder
    private var tilesGrid: some View {
        let tiles = effectiveCategory.map { board.tiles(in: $0) } ?? []
        let cols = max(1, prefs.across(section))
        // Fixed tile size (shared across every column) so all tiles on the
        // board are identical — the column's frame width is sized to match.
        let gridCols = Array(repeating: GridItem(.fixed(tileSize), spacing: BoardMetrics.tileGap),
                             count: cols)
        ScrollView {
            LazyVGrid(columns: gridCols, alignment: .leading, spacing: BoardMetrics.tileGap) {
                ForEach(tiles) { tile in
                    TileView(tile: tile) { t in
                        Task { await TilePlayer.shared.play(t) }
                    }
                    .frame(width: tileSize)
                }
            }
            .padding(.horizontal, BoardMetrics.columnPad)
            .padding(.vertical, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

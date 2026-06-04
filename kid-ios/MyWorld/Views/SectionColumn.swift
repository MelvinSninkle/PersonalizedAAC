import SwiftUI

/// One of the three main columns (People / Nouns / Verbs). Holds its own
/// selection state — no navigation drill-in. Mirrors the web app's per-section
/// layout: title → category tab strip → subcategory strip → tile grid.
struct SectionColumn: View {
    let section: BoardSection

    @Environment(BoardStore.self) private var board
    @Environment(DisplayPrefs.self) private var prefs
    @State private var selectedCategoryId: Int?
    @State private var selectedSubcategoryId: Int?

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

            // Subcategory strip — only if the active category has children
            if let cat = activeCategory(in: cats), !board.children(of: cat).isEmpty {
                SubcategoryStrip(subcategories: board.children(of: cat),
                                 selectedId: $selectedSubcategoryId,
                                 hideLabels: prefs.hideLabels)
            }

            tilesGrid
        }
        .background(Color(hex: prefs.color(section)).opacity(0.7))
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
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: cols),
                      spacing: 8) {
                ForEach(tiles) { tile in
                    TileView(tile: tile) { t in
                        Task { await TilePlayer.shared.play(t) }
                    }
                }
            }
            .padding(8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

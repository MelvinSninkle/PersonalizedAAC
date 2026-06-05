import SwiftUI

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

    @Environment(BoardStore.self) private var board
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(AuthManager.self) private var auth
    @State private var selectedCategoryId: Int?
    @State private var selectedSubcategoryId: Int?
    @State private var openRoom: Category?

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
                             selectedId: $selectedCategoryId,
                             hideLabels: prefs.hideLabels)

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
            openRoom = nil
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
            RoomInteriorView(room: room) { openRoom = nil }
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
            selectedCategoryId = cats.first?.id
        }
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

    private var normalTilesGrid: some View {
        let tiles = effectiveCategory.map { board.tiles(in: $0) } ?? []
        let cols = max(1, prefs.across(section))
        let gridCols = Array(repeating: GridItem(.fixed(tileSize), spacing: BoardMetrics.tileGap),
                             count: cols)
        return ScrollView {
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
                        TileView(tile: tile) { t in
                            Task { await TilePlayer.shared.play(t) }
                        }
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

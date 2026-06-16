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
    @State private var selectedCategoryId: Int?
    @State private var selectedSubcategoryId: Int?
    @State private var openRoom: Category?

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
                    TileView(tile: tile, onTap: { t in playWithLogging(t) },
                             editMode: editMode, onEdit: onEditTile,
                             posterMode: effectiveCategory?.isPoster ?? false)
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

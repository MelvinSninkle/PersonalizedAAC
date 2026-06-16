import SwiftUI

/// A "room" tile — a special render for categories with kind="room". Built on
/// the same visual chrome as TileView so the board feels uniform, but with
/// dual-gesture behavior the kid learns once and reuses everywhere:
///
///   short tap   → speak the room's name (no nav, no surprises)
///   long press  → open the room's interior (its items in an overlay)
///
/// Inside the interior, the same room tile is shown at the top — long-press
/// THAT to close. The "long-press to open / long-press to exit" pair is the
/// universal navigation we use for places without nesting more chip-strips.
struct RoomTile: View {
    let category: Category
    let onTap: () -> Void
    let onLongPress: () -> Void

    @Environment(AuthManager.self) private var auth
    @State private var image: UIImage?

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 18).fill(Color(.systemBackground))
                if let img = image {
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(contentMode: category.keepAspect ? .fit : .fill)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                } else {
                    Image(systemName: "door.left.hand.closed")
                        .font(.largeTitle)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color(hex: "#ff1493").opacity(0.35), lineWidth: 2)
            )

            Text(category.label)
                .font(.system(size: 17, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(.primary)
                .padding(.horizontal, 4)
        }
        .contentShape(Rectangle())
        // Order matters: register the long-press FIRST so it wins; the tap
        // fires only if the press wasn't long enough.
        .onLongPressGesture(minimumDuration: 0.55) {
            onLongPress()
        }
        .onTapGesture {
            onTap()
        }
        .task(id: category.imageKey) {
            guard let key = category.imageKey, !key.isEmpty else { return }
            if let img = await MediaCache.shared.image(for: key) {
                await MainActor.run { self.image = img }
            }
        }
    }
}

/// The interior of an open room — full-board overlay showing the room's items
/// as a normal tile grid. The room's own tile shows up at the top so the kid
/// can long-press it again to back out — same gesture that opened it.
struct RoomInteriorView: View {
    let room: Category
    /// Unlocked board → tiles inside the room are tap-to-edit too.
    var editMode: Bool = false
    var onEditTile: (Tile) -> Void = { _ in }
    let onClose: () -> Void

    @Environment(BoardStore.self) private var board
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(AuthManager.self) private var auth

    private var tiles: [Tile] { board.tiles(in: room) }

    var body: some View {
        GeometryReader { geo in
            let tile = layoutTile(in: geo.size.width)
            let cols = max(1, prefs.acrossNouns)

            VStack(spacing: 0) {
                // Header row: the room's tile re-rendered, long-press to close.
                HStack(spacing: 12) {
                    RoomTile(
                        category: room,
                        onTap: {},                 // tap on header = no-op
                        onLongPress: { onClose() } // long-press exits, same as open
                    )
                    .frame(width: tile)
                    Text(room.label)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: "#ad1457"))
                    Spacer()
                    Text("hold to close")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.trailing, 8)
                }
                .padding(.horizontal, BoardMetrics.columnPad)
                .padding(.vertical, 10)
                .background(Color(hex: prefs.colorNouns).opacity(0.85))

                // The room's items.
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(tile),
                                                                 spacing: BoardMetrics.tileGap),
                                             count: cols),
                              alignment: .leading,
                              spacing: BoardMetrics.tileGap) {
                        ForEach(tiles) { t in
                            TileView(tile: t,
                                     onTap: { tapped in
                                         Task {
                                             await TilePlayer.shared.play(
                                                 tapped,
                                                 childId: auth.childSlug,
                                                 categoryName: room.label
                                             )
                                         }
                                     },
                                     editMode: editMode, onEdit: onEditTile,
                                     posterMode: room.isPoster)
                            .frame(width: tile)
                        }
                    }
                    .padding(BoardMetrics.columnPad)
                }
                .background(Color(hex: prefs.colorNouns).opacity(0.5))
            }
        }
    }

    /// Pick a tile size that fits N tiles across the overlay.
    private func layoutTile(in width: CGFloat) -> CGFloat {
        let n = CGFloat(max(1, prefs.acrossNouns))
        let chrome = 2 * BoardMetrics.columnPad + (n - 1) * BoardMetrics.tileGap
        let avail = max(0, width - chrome)
        return max(BoardMetrics.minTile, min(width / 6, avail / n))
    }
}

import SwiftUI

/// Memorabilia album, organized into folders to match how the family thinks
/// about their tiles rather than a flat scroll:
///
///   Album → Section folder → Tile → all versions of that tile, newest first
///
/// Sections collapse into four parent-friendly buckets:
///   People       (people)
///   Words        (nouns + needs — the "things, adjectives, phrases" bucket)
///   Verbs        (verbs)
///   Celebrations (the holiday/birthday Events track)
struct AlbumView: View {
    @Environment(AuthManager.self) private var auth

    @State private var tiles: [APIClient.AlbumTile] = []
    @State private var loaded = false
    @State private var errorText: String?

    private let api = APIClient()

    var body: some View {
        Group {
            if let e = errorText {
                Text(e).font(.footnote).foregroundStyle(.red).padding()
            } else if !loaded {
                ProgressView("Loading…").frame(maxWidth: .infinity, alignment: .center).padding(.top, 60)
            } else if tiles.isEmpty {
                Text("No pictures yet. As tiles get new art, the old versions are kept here forever.")
                    .font(.footnote).foregroundStyle(.secondary).padding(24)
            } else {
                folderList
            }
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle("Album")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                tiles = try await api.albumByTile(childId: auth.childSlug, limit: 600)
            } catch {
                errorText = "Could not load the album: \(error.localizedDescription)"
            }
            loaded = true
        }
    }

    private var folderList: some View {
        ScrollView {
            VStack(spacing: 14) {
                ForEach(AlbumFolder.allCases) { folder in
                    let tilesInFolder = tiles.filter { folder.matches(section: $0.section) }
                    if !tilesInFolder.isEmpty {
                        NavigationLink {
                            AlbumFolderView(folder: folder, tiles: tilesInFolder)
                        } label: {
                            folderRow(folder: folder, tiles: tilesInFolder)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(16)
        }
    }

    private func folderRow(folder: AlbumFolder, tiles: [APIClient.AlbumTile]) -> some View {
        let pictureCount = tiles.reduce(0) { $0 + (1 + $1.history.count) }
        // Cover stack: up to 3 thumbnails of the most recent tiles, fanned out.
        let covers = Array(tiles.prefix(3)).compactMap { $0.current?.blobKey ?? $0.history.first?.blobKey }
        return HStack(spacing: 14) {
            ZStack {
                ForEach(Array(covers.enumerated()), id: \.offset) { i, key in
                    MediaImage(blobKey: key)
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.white, lineWidth: 2))
                        .rotationEffect(.degrees(Double(i - 1) * 6))
                        .offset(x: CGFloat(i - 1) * 4)
                }
                if covers.isEmpty {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(hex: folder.tint).opacity(0.18))
                        .frame(width: 60, height: 60)
                        .overlay(Image(systemName: folder.icon).foregroundStyle(Color(hex: folder.tint)))
                }
            }
            .frame(width: 78)

            VStack(alignment: .leading, spacing: 3) {
                Text(folder.title)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#1f2937"))
                Text("\(tiles.count) tile\(tiles.count == 1 ? "" : "s") · \(pictureCount) picture\(pictureCount == 1 ? "" : "s")")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: "#6b7280"))
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: "#c9b3bf"))
        }
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
    }
}

/// Album → folder. Sections collapse into four parent-friendly buckets so the
/// top level fits on one screen.
enum AlbumFolder: String, CaseIterable, Identifiable {
    case people, words, verbs, celebrations
    var id: String { rawValue }
    var title: String {
        switch self {
        case .people:       return "People"
        case .words:        return "Words"
        case .verbs:        return "Verbs"
        case .celebrations: return "Celebrations"
        }
    }
    var subtitle: String {
        switch self {
        case .people:       return "Family, friends, helpers"
        case .words:        return "Things, adjectives, phrases"
        case .verbs:        return "Actions and feelings"
        case .celebrations: return "Birthdays and holidays"
        }
    }
    var icon: String {
        switch self {
        case .people:       return "person.2.fill"
        case .words:        return "tag.fill"
        case .verbs:        return "figure.run"
        case .celebrations: return "sparkles"
        }
    }
    var tint: String {
        switch self {
        case .people:       return "#ec4899"
        case .words:        return "#0ea5e9"
        case .verbs:        return "#16a34a"
        case .celebrations: return "#f59e0b"
        }
    }
    func matches(section: String?) -> Bool {
        let s = (section ?? "").lowercased()
        switch self {
        case .people:       return s == "people"
        case .words:        return s == "nouns" || s == "needs" || s.isEmpty   // unfiled lands here too
        case .verbs:        return s == "verbs"
        case .celebrations: return s == "events"
        }
    }
}

/// One folder open: tiles in that section listed by name with a thumbnail
/// stack showing current + how many older versions there are.
private struct AlbumFolderView: View {
    let folder: AlbumFolder
    let tiles: [APIClient.AlbumTile]

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                ForEach(tiles) { tile in
                    NavigationLink {
                        AlbumTileView(tile: tile)
                    } label: {
                        tileRow(tile)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle(folder.title)
        .navigationBarTitleDisplayMode(.large)
    }

    private func tileRow(_ tile: APIClient.AlbumTile) -> some View {
        HStack(spacing: 12) {
            if let key = tile.current?.blobKey ?? tile.history.first?.blobKey {
                MediaImage(blobKey: key)
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(hex: "#fce4ec"))
                    .frame(width: 56, height: 56)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(tile.label ?? "Untitled")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: "#1f2937"))
                let total = 1 + tile.history.count
                Text("\(total) picture\(total == 1 ? "" : "s")")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: "#6b7280"))
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(hex: "#c9b3bf"))
        }
        .padding(12)
        .background(.white, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
    }
}

/// One tile open: every version, newest first, tappable for a full-screen
/// look. The current version is labeled.
private struct AlbumTileView: View {
    let tile: APIClient.AlbumTile
    @State private var zoomed: APIClient.AlbumEntry?

    private let columns = [GridItem(.adaptive(minimum: 110), spacing: 8)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 8) {
                if let cur = tile.current { entry(cur, isCurrent: true) }
                ForEach(tile.history) { entry($0, isCurrent: false) }
            }
            .padding(12)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle(tile.label ?? "Tile")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $zoomed) { e in
            VStack(spacing: 14) {
                MediaImage(blobKey: e.blobKey)
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .padding(.horizontal, 16)
                Text(tile.label ?? "")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                Text(dateText(e.when))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(.vertical, 24)
            .presentationDetents([.large])
        }
    }

    private func entry(_ e: APIClient.AlbumEntry, isCurrent: Bool) -> some View {
        Button { zoomed = e } label: {
            VStack(spacing: 3) {
                ZStack(alignment: .topTrailing) {
                    MediaImage(blobKey: e.blobKey)
                        .frame(minWidth: 110, minHeight: 110)
                        .aspectRatio(1, contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    if isCurrent {
                        Text("Current")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color(hex: "#16a34a"), in: Capsule())
                            .padding(6)
                    }
                }
                Text(dateText(e.when))
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }

    private func dateText(_ iso: String?) -> String {
        guard let iso else { return "" }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let d else { return "" }
        return d.formatted(date: .abbreviated, time: .omitted)
    }
}

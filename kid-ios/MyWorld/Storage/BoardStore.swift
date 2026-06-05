import Foundation
import Observation

/// In-memory board state for the signed-in child. Hydrates from disk on cold
/// launch so the board paints instantly even before the network responds, then
/// merges the fresh /api/sync result on top.
///
/// We persist the raw `APIClient.SyncResponse` as JSON in Documents — the
/// shape is small (~hundreds of KB at most) and using the same model objects
/// we render with means there's no schema-drift between cache + network.
@Observable
final class BoardStore {
    var categories: [Category] = []
    var tiles: [Tile] = []
    var loading: Bool = false
    var lastError: String?

    private let api: APIClient
    private let cacheURL: URL

    init(api: APIClient = APIClient()) {
        self.api = api
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        self.cacheURL = docs.appendingPathComponent("board.json")
        hydrateFromDisk()
    }

    // MARK: -- Public API used by views

    /// Top-level categories in a given section (parent_id == nil).
    func roots(in section: BoardSection) -> [Category] {
        categories
            .filter { $0.section == section && $0.parentId == nil }
            .sorted { ($0.order, $0.id) < ($1.order, $1.id) }
    }

    /// Subcategories (children) of a given category.
    func children(of category: Category) -> [Category] {
        categories
            .filter { $0.parentId == category.id }
            .sorted { ($0.order, $0.id) < ($1.order, $1.id) }
    }

    /// Tiles directly inside a category (categoryId == category.id).
    func tiles(in category: Category) -> [Tile] {
        tiles
            .filter { $0.categoryId == category.id }
            .sorted { (a, b) in
                if a.pinned != b.pinned { return a.pinned }   // pinned first
                if a.order != b.order   { return a.order < b.order }
                return a.id < b.id
            }
    }

    /// Pinned/persistent tiles — those flagged `pinned: true` across the board.
    /// Mirrors the persistent strip on the web app.
    func persistentStrip() -> [Tile] {
        tiles
            .filter { $0.pinned }
            .sorted { ($0.order, $0.id) < ($1.order, $1.id) }
    }

    /// Resolve a facilitator "scope" string into the set of tiles to practice.
    /// Mirrors the scope vocabulary the web therapist console emits:
    ///   - "all"            → every tile
    ///   - "people"/"nouns"/"verbs" → that whole section
    ///   - "cat:<id>"       → that category + all its descendant categories
    /// `from`/`to` (1-based, inclusive) optionally slice the ordered result —
    /// used for ranges like "Numbers 1–20".
    func tilesForScope(_ scope: String?, from: Int? = nil, to: Int? = nil) -> [Tile] {
        let s = scope ?? "all"
        var result: [Tile]
        if s == "all" {
            result = tiles
        } else if let sec = BoardSection(rawValue: s) {
            result = tiles.filter { $0.section == sec }
        } else if s.hasPrefix("cat:"), let id = Int(s.dropFirst(4)) {
            var ids: Set<Int> = [id]
            var frontier = [id]
            while !frontier.isEmpty {
                let next = categories
                    .filter { $0.parentId.map { frontier.contains($0) } ?? false }
                    .map(\.id)
                let fresh = next.filter { !ids.contains($0) }
                ids.formUnion(fresh)
                frontier = fresh
            }
            result = tiles.filter { $0.categoryId.map { ids.contains($0) } ?? false }
        } else {
            result = tiles
        }
        result.sort { ($0.order, $0.id) < ($1.order, $1.id) }

        if let from, let to, from >= 1, to >= from {
            let lo = min(from - 1, result.count)
            let hi = min(to, result.count)
            if lo < hi { result = Array(result[lo..<hi]) }
        }
        return result
    }

    // MARK: -- Sync

    /// Fetch the latest board from /api/sync. Silently keeps stale data on
    /// failure so we don't wipe the kid's board over a transient network hiccup.
    @MainActor
    func refresh(childId: String) async {
        loading = true
        defer { loading = false }
        do {
            let resp = try await api.sync(childId: childId)
            self.categories = resp.categories
            self.tiles = resp.items
            self.lastError = nil
            persistToDisk(resp)
            precacheMedia()
        } catch {
            self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Download every tile + category image (then every sound) up front, in a
    /// sensible order, so the whole board is ready before the child taps. A kid
    /// can't be left without words while a category lazily loads.
    func precacheMedia() {
        // Order: People → Nouns → Verbs → Needs, each by display order. Folder
        // icons first within a section, then tiles.
        let sectionOrder: [BoardSection] = [.people, .nouns, .verbs, .needs]
        var imageKeys: [String] = []
        for section in sectionOrder {
            let cats = categories
                .filter { $0.section == section }
                .sorted { ($0.order, $0.id) < ($1.order, $1.id) }
            imageKeys += cats.compactMap { $0.imageKey }
            let secTiles = tiles
                .filter { $0.section == section }
                .sorted { ($0.order, $0.id) < ($1.order, $1.id) }
            imageKeys += secTiles.compactMap { $0.imageKey }
        }
        let soundKeys = tiles.compactMap { $0.soundKey }

        Task.detached(priority: .utility) {
            // Images first (the child needs to SEE the words), then audio.
            await MediaCache.shared.warm(imageKeys)
            await MediaCache.shared.warm(soundKeys)
        }
    }

    // MARK: -- Persistence

    private func hydrateFromDisk() {
        guard let data = try? Data(contentsOf: cacheURL) else { return }
        guard let resp = try? JSONDecoder().decode(APIClient.SyncResponse.self, from: data) else { return }
        self.categories = resp.categories
        self.tiles = resp.items
        precacheMedia()   // start warming from the cached board on cold launch
    }

    private func persistToDisk(_ resp: APIClient.SyncResponse) {
        guard let data = try? JSONEncoder().encode(resp) else { return }
        try? data.write(to: cacheURL, options: .atomic)
    }
}

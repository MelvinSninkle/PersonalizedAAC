import Foundation

/// Offline-first child settings — the synced toggles under ⚙ Display settings
/// (and the onboarding setup questions, which write the same keys).
///
/// The old contract needed the network twice: a live server seed before any
/// toggle was even ENABLED, and a live write for every flip (which snapped
/// back on failure). On a plane, the settings screen was dead. This store
/// gives settings the same local-first contract as usage history:
///
///   • the last-known blob lives on disk, so toggles are usable immediately,
///     connected or not;
///   • a flip applies and persists locally at once;
///   • unsynced flips queue as a PATCH (merged key→value, last flip per key
///     wins — the same merge semantics as /api/child-settings itself) and
///     flush whenever the network comes back.
///
/// A flush NEVER builds its write from an empty read: it re-reads the live
/// server blob first and overlays the pending patch, so going offline can
/// never wipe keys some other device wrote in the meantime. If that read
/// fails, the patch simply stays queued for the next attempt.
actor ChildSettingsStore {
    static let shared = ChildSettingsStore()
    private let api = APIClient()

    /// In-memory mirror of the on-disk state, keyed by child slug.
    private var cached: [String: [String: Any]] = [:]
    private var pending: [String: [String: Any]] = [:]
    private var loadedFromDisk = Set<String>()

    // MARK: -- Public surface

    /// Current best-known settings: the last-known blob overlaid with any
    /// unsynced local flips. Tries the network first (which also flushes the
    /// queue); falls back to disk. `live` is false when the answer came from
    /// the local cache only — callers can say "offline" honestly.
    func load(childId: String) async -> (settings: [String: Any], live: Bool) {
        hydrate(childId)
        _ = await flush(childId: childId)
        if let server = await api.fetchChildSettings(childId: childId) {
            cached[childId] = server
            persist(childId)
            return (overlay(server, pending[childId] ?? [:]), true)
        }
        return (overlay(cached[childId] ?? [:], pending[childId] ?? [:]), false)
    }

    /// Apply a flip: local cache + pending queue first (always succeeds),
    /// then one flush attempt. Returns true when the change reached the
    /// server, false when it's queued for later — never a lost write.
    func apply(childId: String, patch: [String: Any]) async -> Bool {
        hydrate(childId)
        var blob = cached[childId] ?? [:]
        var queue = pending[childId] ?? [:]
        for (k, v) in patch { blob[k] = v; queue[k] = v }
        cached[childId] = blob
        pending[childId] = queue
        persist(childId)
        return await flush(childId: childId)
    }

    /// Push any queued flips: fresh server read, overlay the patch, write the
    /// merge back. True when the queue is empty afterwards.
    func flush(childId: String) async -> Bool {
        hydrate(childId)
        let queue = pending[childId] ?? [:]
        if queue.isEmpty { return true }
        guard let server = await api.fetchChildSettings(childId: childId) else { return false }
        let merged = overlay(server, queue)
        guard await api.writeChildSettings(childId: childId, settings: merged) else { return false }
        cached[childId] = merged
        pending[childId] = [:]
        persist(childId)
        return true
    }

    // MARK: -- Disk

    private func fileURL(_ childId: String, pending: Bool) -> URL {
        // Same home as the board cache (BoardStore's board.json).
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let safe = childId.map { $0.isLetter || $0.isNumber ? $0 : "-" }.map(String.init).joined()
        return docs.appendingPathComponent("child-settings\(pending ? "-pending" : "")-\(safe).json")
    }

    private func hydrate(_ childId: String) {
        guard !loadedFromDisk.contains(childId) else { return }
        loadedFromDisk.insert(childId)
        cached[childId] = read(fileURL(childId, pending: false)) ?? [:]
        pending[childId] = read(fileURL(childId, pending: true)) ?? [:]
    }

    private func persist(_ childId: String) {
        write(cached[childId] ?? [:], to: fileURL(childId, pending: false))
        write(pending[childId] ?? [:], to: fileURL(childId, pending: true))
    }

    private func read(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func write(_ dict: [String: Any], to url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private func overlay(_ base: [String: Any], _ patch: [String: Any]) -> [String: Any] {
        var out = base
        for (k, v) in patch { out[k] = v }
        return out
    }
}

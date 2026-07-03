import Foundation
import Observation

/// iPad-side runner for the Auto-teach subsystem. Polls /api/auto-teach/next
/// every ~5 minutes; when the server says "go" with a batch of tile slugs, it
/// STAGES the activity instead of firing it cold: BoardView shows a friendly
/// "Learning time!" countdown card, and only when the countdown runs out does
/// the slideshow/game actually take the screen (a grown-up can ✕ to skip that
/// round). Runs fully locally — no live-channel round trip — so a mid-game
/// child is protected by the same `game.current == nil` guard everything uses.
///
/// The runner also reports the device's IANA timezone with every poll: the
/// server's blackout / daily-game gates evaluate in FAMILY time (they used to
/// compare wall-clock strings in server UTC, which put the whole afternoon
/// inside "bedtime").
@MainActor
@Observable
final class AutoTeachRunner {
    /// A server-approved activity waiting on the countdown card.
    struct Staged: Equatable {
        let mode: String            // "exposure" | "game"
        let slugs: [String]         // taxonomy ids in the batch
        let secondsPerImage: Double
        let labelStyle: String
        let sessionMaxMin: Double
        let source: String          // "auto_slideshow" | "auto_game"
    }

    /// BoardView observes this and presents the countdown card.
    var staged: Staged?

    /// Last server reply (for in-app debugging — the parent never sees this).
    var lastReason: String?
    var lastTriggeredAt: Date?

    private var pollTask: Task<Void, Never>?
    private var childId: String = ""
    private let api = APIClient()

    /// Polled every 5 minutes. The server has the canonical cooldown
    /// (default 30 min) so the iPad doesn't have to throttle itself.
    private let pollInterval: TimeInterval = 5 * 60

    func start(childId: String) {
        guard self.childId != childId || pollTask == nil else { return }
        self.childId = childId
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            // Stagger the first poll so two iPads launched simultaneously
            // don't race each other on the same minute.
            try? await Task.sleep(for: .seconds(Double.random(in: 15...60)))
            while !Task.isCancelled {
                await self?.tick()
                try? await Task.sleep(for: .seconds(self?.pollInterval ?? 300))
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        staged = nil
    }

    /// The countdown card fired the activity (or a grown-up skipped it).
    /// On fire we tick every batch slug with the auto source — this is what
    /// arms the server's cooldown / daily-budget / one-game-per-day gates and
    /// advances each tile's exposure protocol.
    func consumeStaged(fired: Bool) {
        guard let s = staged else { return }
        staged = nil
        guard fired else { lastReason = "skipped_by_adult"; return }
        lastTriggeredAt = Date()
        let id = childId
        Task.detached(priority: .utility) {
            for slug in s.slugs {
                await APIClient().tickExposure(childId: id, skillSlug: slug, source: s.source)
            }
        }
    }

    /// Try a slideshow first (the high-frequency lane). If the server refuses,
    /// try the game-window once — at most one of the two ever fires per tick.
    private func tick() async {
        guard staged == nil else { return }
        if await trigger(mode: "exposure") { return }
        _ = await trigger(mode: "game")
    }

    private func trigger(mode: String) async -> Bool {
        guard let resp = try? await api.autoTeachNext(childId: childId, mode: mode,
                                                      tz: TimeZone.current.identifier) else {
            return false
        }
        lastReason = resp.ok ? "ok:\(mode)" : (resp.reason ?? "denied")
        guard resp.ok, let tiles = resp.tiles, !tiles.isEmpty, let session = resp.session else {
            return false
        }
        staged = Staged(
            mode: mode,
            slugs: tiles.map(\.slug),
            secondsPerImage: Double(session.microSec),
            labelStyle: session.labelStyle,
            sessionMaxMin: Double(session.sessionMaxMin),
            source: session.source
        )
        return true
    }
}

import Foundation
import Observation

/// iPad-side runner for the Auto-teach subsystem. Polls /api/auto-teach/next
/// every ~5 minutes; when the server says "go" with a batch of tile slugs,
/// triggers a slideshow (exposure) or game (matching) through the SAME live
/// command channel that the parent / therapist / web console use, so the iPad
/// runs the activity through its existing GameController code path.
///
/// Why we ride on /api/live rather than calling SlideshowView directly:
///   • A child mid-game / mid-slideshow / mid-routine never gets interrupted —
///     LiveSession's baseline gate already filters those.
///   • The same heartbeat that tells the parent's facilitator overlay the iPad
///     is alive also tells it auto-teach is the active driver — nothing on the
///     parent side has to know auto-teach is special.
@MainActor
@Observable
final class AutoTeachRunner {
    /// Last server reply (for in-app debugging — the parent never sees this).
    var lastReason: String?
    var lastTriggeredAt: Date?

    private var pollTask: Task<Void, Never>?
    private var childId: String = ""
    private let api = APIClient()

    /// Polled every 5 minutes. The server already has the canonical cooldown
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
    }

    /// Try a slideshow first (the high-frequency lane). If the server refuses,
    /// try the game-window once — at most one of the two ever fires per tick.
    private func tick() async {
        if await trigger(mode: "exposure") { return }
        _ = await trigger(mode: "game")
    }

    private func trigger(mode: String) async -> Bool {
        guard let resp = try? await api.autoTeachNext(childId: childId, mode: mode) else {
            return false
        }
        lastReason = resp.ok ? "ok:\(mode)" : (resp.reason ?? "denied")
        guard resp.ok, let tiles = resp.tiles, !tiles.isEmpty, let session = resp.session else {
            return false
        }
        // Build a live `start` cmd matching what the parent/web console emits.
        // For an exposure batch we pin the scope to the specific tile ids so
        // the slideshow only walks the picker's batch — not the whole section.
        let scopeSlugs = tiles.map(\.slug).joined(separator: ",")
        var cmd: [String: Any] = [
            "action": "start",
            "mode": (mode == "exposure" ? "exposure_slideshow" : "matching"),
            "scope": "slugs:\(scopeSlugs)",
            "secondsPerImage": session.microSec,
            "labelStyle": session.labelStyle,
        ]
        if mode == "game" {
            cmd["limitMin"] = session.sessionMaxMin
            cmd["choices"] = 3
        }
        try? await api.publishLiveCommand(childId: childId, cmd)
        lastTriggeredAt = Date()
        return true
    }
}

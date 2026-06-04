import Foundation
import Observation

/// Decoded shape of a facilitator command pushed via /api/live POST body.
/// Matches the JSON the web app's /api/live writes into `cmd`.
struct LiveCommand: Codable, Equatable {
    let seq: Int
    let action: String?       // "start" | "next" | "mark" | "end" | …
    let mode: String?         // "matching" | "slideshow" | "celebration" | …
    let scope: String?        // category id or "all"
    let scopes: [String]?
    let choices: Int?         // for matching, how many tiles on screen
    let limitMin: Double?
    let secondsPerImage: Double?
    let labelStyle: String?
    let music: String?
    let from: Double?
    let to: Double?
    let ts: Double?
}

/// One poll of /api/live response.
struct LiveStatus: Codable {
    let status: String
    let cmd: LiveCommand?
    let cmdSeq: Int
    let age: Int?
}

/// Polls /api/live for facilitator commands and exposes the latest one as
/// observable state for game-mode views to react to.
///
/// Polling cadence: 1.0s when nothing is active, 0.5s while a game is
/// running (so "next" / "mark" feel instant). We never hammer the endpoint
/// when the app is backgrounded — the polling task is cancelled on scene
/// inactive and restarted on active.
@Observable
final class LiveSession {
    /// The most recently received command (deduped by seq).
    var latest: LiveCommand?

    /// Latest seq we've handled — anything <= this we ignore as a duplicate.
    private var handledSeq: Int = 0

    private var task: Task<Void, Never>?
    private let api = APIClient()
    private var childId: String = "fletcherpeterson"

    /// Start polling for the given child. Idempotent — calling twice replaces
    /// the running task. Safe to call on every BoardView .task.
    func start(childId: String) {
        self.childId = childId
        task?.cancel()
        task = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollOnce()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    @MainActor
    private func pollOnce() async {
        guard let status = try? await api.live(childId: childId) else { return }
        guard let cmd = status.cmd, cmd.seq > handledSeq else { return }
        handledSeq = cmd.seq
        self.latest = cmd
    }

    /// Acknowledge a command so the same one isn't re-applied on next poll —
    /// for cases where the view explicitly handles + dismisses the command.
    func acknowledge() {
        latest = nil
    }
}

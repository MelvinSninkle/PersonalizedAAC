import Foundation
import Observation

/// Decoded shape of a facilitator command pushed via /api/live POST body.
/// Matches the JSON the web app's /api/live writes into `cmd`.
struct LiveCommand: Codable, Equatable {
    let seq: Int
    let action: String?       // "start" | "next" | "mark" | "skip" | "end" | …
    let method: String?       // "verbal" | "physical" (for "mark")
    let mode: String?         // "matching" | "slideshow" | … (often nil = matching)
    let scope: String?        // category id ("cat:123"), section name, or "all"
    let choices: Int?         // for matching, how many tiles on screen
    let from: Double?
    let to: Double?
    let ts: Double?
}

/// What the tablet publishes back so the facilitator phone can render progress.
/// Field names mirror exactly what therapist.html's renderLive() reads.
struct LivePayload: Codable, Equatable {
    var target: Target?
    var i: Int?
    var total: Int?
    var correctCount: Int?

    struct Target: Codable, Equatable {
        var label: String
        var imageKey: String?
    }
}

/// One poll of /api/live response.
struct LiveStatus: Codable {
    let status: String
    let cmd: LiveCommand?
    let cmdSeq: Int
    let age: Int?
}

/// Two jobs:
///   1. Poll /api/live (~1s) for facilitator commands → exposes `latest`.
///   2. Publish the tablet's presence + state (~3s heartbeat) so the
///      facilitator phone shows "Connected" and live progress. Without the
///      heartbeat the phone sits on "Waiting for tablet" forever.
@Observable
final class LiveSession {
    /// The most recently received command (deduped by seq).
    var latest: LiveCommand?

    private var handledSeq: Int = 0
    private var pollTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private let api = APIClient()
    private var childId: String = "fletcherpeterson"

    /// Current published state — the heartbeat resends this every few seconds.
    private var publishStatus: String = "standby"
    private var publishPayload: LivePayload?

    func start(childId: String) {
        self.childId = childId
        pollTask?.cancel()
        heartbeatTask?.cancel()

        // Command poll.
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollOnce()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
        // Presence heartbeat — keep status != 'idle' so the phone sees us.
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.beat()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    func stop() {
        pollTask?.cancel(); pollTask = nil
        heartbeatTask?.cancel(); heartbeatTask = nil
        // Best-effort: tell the phone we've gone away.
        let id = childId
        Task { await APIClient().publishLiveState(childId: id, status: "idle", payload: nil) }
    }

    // MARK: -- State the tablet publishes

    /// Board is up but no game running — "Tablet is listening, tap Start".
    func setStandby() {
        publishStatus = "standby"
        publishPayload = nil
        Task { await beat() }
    }

    /// A game is on screen; push the current target/progress to the phone.
    func setRunning(_ payload: LivePayload) {
        publishStatus = "running"
        publishPayload = payload
        Task { await beat() }
    }

    /// Game finished — phone shows "finished 🎉".
    func setEnded(_ payload: LivePayload?) {
        publishStatus = "ended"
        publishPayload = payload
        Task { await beat() }
    }

    // MARK: -- Internals

    @MainActor
    private func pollOnce() async {
        guard let status = try? await api.live(childId: childId) else { return }
        guard let cmd = status.cmd, cmd.seq > handledSeq else { return }
        handledSeq = cmd.seq
        self.latest = cmd
    }

    private func beat() async {
        await api.publishLiveState(childId: childId, status: publishStatus, payload: publishPayload)
    }

    /// Acknowledge a command so the same one isn't re-applied on next poll.
    func acknowledge() { latest = nil }
}

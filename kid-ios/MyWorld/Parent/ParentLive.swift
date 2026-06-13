import Foundation
import Observation

/// App-wide observer of the iPad's live session, polling /api/live so the
/// parent app can react to a running game from anywhere. Drives the
/// auto-popping facilitator overlay (PRD: when a facilitated game session
/// starts, the adult UI loads automatically).
@MainActor
@Observable
final class ParentLive {
    /// Last status read from /api/live. Nil before the first poll.
    var status: LiveStatus?

    /// The iPad is alive when status is non-idle AND age < 8s — same liveness
    /// rule the web therapist console uses.
    var tabletOnline: Bool {
        guard let s = status else { return false }
        return s.status != "idle" && (s.age ?? 99) < 8
    }

    /// A facilitable session is on the iPad right now — drives the
    /// auto-popping running overlay from anywhere in the parent app.
    var isRunning: Bool {
        guard let s = status else { return false }
        return s.status == "running" && (s.age ?? 99) < 8
    }

    private var pollTask: Task<Void, Never>?
    private let api = APIClient()
    private var childId: String = ""

    func start(childId: String) {
        guard self.childId != childId || pollTask == nil else { return }
        self.childId = childId
        pollTask?.cancel()
        let id = childId
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                if let s = try? await APIClient().live(childId: id) {
                    self?.status = s
                }
                try? await Task.sleep(for: .seconds(1.5))
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }
}

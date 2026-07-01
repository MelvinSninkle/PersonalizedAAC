import Foundation
import Observation

/// Runs the schedule the parent set up in the web Schedules panel:
///   - Pulls `child_settings.schedules` every few minutes.
///   - Ticks every 60s while the board is open.
///   - For each enabled schedule that's in its day-of-week + start/end window:
///       timing=times    → fire once per HH:MM that matches today (deduped)
///       timing=interval → fire every intervalMin (deduped via timestamp)
///   - Never fires while a game / slideshow / routine is running, never twice
///     in fast succession — same guards as the web's schedulerTick().
///   - Surfaces the matched Schedule on `pending`; BoardView observes it and
///     presents the right sheet (reminder toast / question modal / game nudge).
@Observable
final class Scheduler {
    /// Currently due schedule the UI should show. Cleared via `acknowledge()`.
    var pending: Schedule?

    private var schedules: [Schedule] = []
    private var childId: String = ""
    private let api = APIClient()
    private var fired: [String: Any] = [:]
    private var tickTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?

    /// While anything modal is up (a game, the unlock sheet, …) skip the tick
    /// instead of stacking a second sheet on top. Set by BoardView.
    var isBlocked: Bool = false

    func start(childId: String) {
        self.childId = childId
        fired = loadFired()
        refreshSchedules()
        tickTask?.cancel()
        refreshTask?.cancel()
        // Per-minute tick.
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.tick()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
        // Re-pull the schedule list every 5 minutes so parent-side edits land
        // without a full app relaunch.
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 300_000_000_000)
                await self?.refreshSchedulesAsync()
            }
        }
    }

    func stop() {
        tickTask?.cancel(); tickTask = nil
        refreshTask?.cancel(); refreshTask = nil
    }

    /// Manual refresh (e.g. when the Display "Refresh board" button is tapped).
    func refreshSchedules() {
        Task { [weak self] in await self?.refreshSchedulesAsync() }
    }

    private func refreshSchedulesAsync() async {
        let list = await api.fetchSchedules(childId: childId)
        await MainActor.run { self.schedules = list }
    }

    func acknowledge() { pending = nil }

    // MARK: -- Tick

    @MainActor
    private func tick() async {
        guard !isBlocked, pending == nil, !schedules.isEmpty else { return }
        let now = Date()
        let cal = Calendar.current
        let comps = cal.dateComponents([.weekday, .hour, .minute], from: now)
        let weekday = (comps.weekday ?? 1) - 1   // Calendar weekday is 1..7, we want 0..6
        let curMin = (comps.hour ?? 0) * 60 + (comps.minute ?? 0)
        let hhmm = String(format: "%02d:%02d", comps.hour ?? 0, comps.minute ?? 0)
        let today = isoDay(now)
        var changed = false
        for s in schedules where s.enabled {
            guard inWindow(s, weekday: weekday, curMin: curMin) else { continue }
            let id = s.id.isEmpty ? "\(s.type.rawValue)|\(s.prompt ?? "")" : s.id
            switch s.timing {
            case .times:
                guard let times = s.times, times.contains(hhmm) else { continue }
                let key = "T|\(id)|\(hhmm)"
                if fired[key] as? String != today {
                    fired[key] = today; changed = true
                    pending = s
                    saveFired(); return
                }
            case .interval:
                let key = "I|\(id)"
                // Arm on first sight: first fire is one interval later.
                if fired[key] == nil {
                    fired[key] = now.timeIntervalSince1970
                    changed = true
                    continue
                }
                let last = (fired[key] as? Double) ?? 0
                let ms = max(60, (s.intervalMin ?? 45) * 60)
                if now.timeIntervalSince1970 - last >= ms {
                    fired[key] = now.timeIntervalSince1970
                    changed = true
                    pending = s
                    saveFired(); return
                }
            }
        }
        if changed { saveFired() }
    }

    private func inWindow(_ s: Schedule, weekday: Int, curMin: Int) -> Bool {
        if let days = s.days, !days.isEmpty, !days.contains(weekday) { return false }
        let a = toMin(s.start), b = toMin(s.end)
        if let a, let b {
            if a <= b { if curMin < a || curMin > b { return false } }
            else      { if curMin < a && curMin > b { return false } }   // wraps midnight
        }
        return true
    }

    private func toMin(_ t: String?) -> Int? {
        guard let t else { return nil }
        let parts = t.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return h * 60 + m
    }

    private func isoDay(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        return f.string(from: d)
    }

    // MARK: -- Per-device dedupe state (so a fire doesn't double on rapid wake)

    private func loadFired() -> [String: Any] {
        (UserDefaults.standard.dictionary(forKey: "schedFired")) ?? [:]
    }
    private func saveFired() {
        UserDefaults.standard.set(fired, forKey: "schedFired")
    }
}

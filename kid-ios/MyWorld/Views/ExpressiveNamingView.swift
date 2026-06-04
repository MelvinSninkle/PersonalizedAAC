import SwiftUI

/// PRD §5 "Expressive naming" mode: the image is shown alone — no audio
/// prompt, no choice tiles — and the child speaks (or gestures, or selects an
/// object) the answer unaided. The facilitator's phone marks the response via
/// the existing `/api/live` `mark` command. This mode measures EXPRESSIVE
/// production, which carries more evidentiary weight than receptive matching
/// because the answer isn't on-screen to choose from.
///
/// UX:
///   - Big target image centered. No label, no description.
///   - Long-hold ✕ to exit (the universal parent-only gesture).
///   - A short tap on the image SKIPS the slide (recorded as a fail) and
///     advances, so the child can self-drive when no facilitator is present.
///   - Facilitator `mark { method }` → pass with that method, advance.
///   - Facilitator `skip` / `next` → fail, advance.
///   - Facilitator `end` → finish (with end_reason='facilitator_stop').
///   - Time limit → finish (end_reason='timeout').
///   - At session end the same `/api/game-log` payload as matching is shipped,
///     with `mode='expressive_naming'`.
struct ExpressiveNamingView: View {
    let session: GameController.Session
    let onExit: () -> Void

    @Environment(BoardStore.self) private var board
    @Environment(LiveSession.self) private var live
    @Environment(GameController.self) private var game
    @Environment(AuthManager.self) private var auth

    @State private var targets: [Tile] = []
    @State private var index = 0
    @State private var image: UIImage?
    @State private var locked = false
    @State private var celebrating = false
    @State private var finished = false
    @State private var lastHandledCmdSeq = 0
    @State private var limitTask: Task<Void, Never>?

    // Same per-attempt log shape as MatchingView so the server sees a uniform
    // payload regardless of which game mode produced it (PRD §3 honest scoring).
    @State private var startedAt: Date = .init()
    @State private var correctCount = 0
    @State private var loggedAttempts: [MatchingView.LoggedAttempt] = []
    @State private var pendingMarkMethod: String?

    private var target: Tile? { targets.indices.contains(index) ? targets[index] : nil }

    var body: some View {
        ZStack {
            Color(hex: "#fff7fb").ignoresSafeArea()

            if finished {
                finishedView
            } else if let _ = target {
                centerImage
            } else {
                Text("Nothing to practice here")
                    .font(.title2).foregroundStyle(.secondary)
            }

            LongPressExitButton.corner(
                tint: Color(hex: "#ad1457"),
                background: Color.black.opacity(0.06)
            ) { onExit() }

            ConfettiView(running: celebrating)
        }
        .contentShape(Rectangle())
        // A short tap skips this slide (recorded as fail) so the child can
        // self-drive. Long-hold of the ✕ in the corner is the exit; this is
        // an unrelated tap layer behind the X.
        .onTapGesture { skipFromTap() }
        .task { setup() }
        .onDisappear {
            limitTask?.cancel()
            GameAudio.shared.stopMusic()
        }
        .task(id: index) { await loadCurrent() }
        .onChange(of: game.inGameCommand) { _, cmd in handleCommand(cmd) }
    }

    // MARK: -- Pieces

    private var centerImage: some View {
        VStack(spacing: 16) {
            Spacer()
            if let img = image {
                Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: 820, maxHeight: 620)
                    .clipShape(RoundedRectangle(cornerRadius: 32))
                    .shadow(color: .black.opacity(0.12), radius: 28, y: 8)
                    .padding(40)
            } else {
                ProgressView().tint(Color(hex: "#ad1457"))
            }
            Spacer()
        }
    }

    private var finishedView: some View {
        VStack(spacing: 18) {
            Text("🎉").font(.system(size: 96))
            Text("Great job!")
                .font(.system(size: 52, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
        }
    }

    // MARK: -- Lifecycle

    private func setup() {
        let pool = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { $0.imageKey?.isEmpty == false }
        var picked = pool.shuffled()
        if let n = session.sample, n > 0 { picked = Array(picked.prefix(n)) }
        targets = picked
        index = 0
        correctCount = 0
        startedAt = Date()
        loggedAttempts = []
        if targets.isEmpty {
            finishGame(reason: "empty_scope")
        } else {
            GameAudio.shared.startMusic(childId: auth.childSlug)
            publishState()
        }
        startLimitTimerIfNeeded()
    }

    private func loadCurrent() async {
        image = nil
        locked = false
        pendingMarkMethod = nil
        guard let key = target?.imageKey, !key.isEmpty,
              let img = await MediaCache.shared.image(for: key) else { return }
        await MainActor.run { self.image = img }
        publishState()
    }

    private func skipFromTap() {
        // Treat a tap as "I don't know" — record a fail with method 'tap'
        // (not child-generated for spike weighting) and advance.
        guard !locked, let t = target else { return }
        locked = true
        recordAttempt(target: t, passed: false, methodOverride: "tap")
        advance(after: 0.3)
    }

    private func handleCommand(_ cmd: LiveCommand?) {
        guard let cmd, cmd.seq > lastHandledCmdSeq else { return }
        lastHandledCmdSeq = cmd.seq
        switch cmd.action {
        case "next", "skip":
            guard let t = target, !locked else { return }
            locked = true
            recordAttempt(target: t, passed: false, methodOverride: "tap")
            advance()
        case "mark":
            // PRD §4: in Expressive Naming the only "input" is the
            // facilitator's mark — there are no on-screen choices to tap.
            // Default to 'verbal' when the console doesn't specify, since
            // that's the canonical expressive-naming response.
            let method = (cmd.method?.isEmpty == false) ? cmd.method! : "verbal"
            guard let t = target, !locked else { return }
            locked = true
            correctCount += 1
            celebrate()
            // Optional reinforcement: speak the label so the child hears the
            // right word after producing it. Confirms the production.
            Task { await TilePlayer.shared.play(t) }
            recordAttempt(target: t, passed: true, methodOverride: method)
            advance(after: 0.6)
        case "end":
            finishGame(reason: "facilitator_stop")
        default:
            break
        }
        game.consumeInGameCommand()
    }

    // MARK: -- Game logic

    private func recordAttempt(target: Tile, passed: Bool, methodOverride: String? = nil) {
        let method = methodOverride ?? pendingMarkMethod ?? "tap"
        pendingMarkMethod = nil
        loggedAttempts.append(MatchingView.LoggedAttempt(
            itemId: target.id,
            label: target.label,
            category: target.taxonomySlug?.split(separator: ".").dropLast().joined(separator: ".") ?? nil,
            taxonomySlug: target.taxonomySlug,
            correct: passed,
            inputMethod: method,
            attemptsTaken: 1,            // expressive: a single facilitator decision per slide
            distractorCount: 0,          // no on-screen choices
            misses: passed ? 0 : 1,
            occurredAt: Date()
        ))
    }

    private func celebrate() {
        celebrating = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { celebrating = false }
    }

    private func advance(after delay: TimeInterval = 0) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            if index + 1 < targets.count {
                index += 1
            } else {
                finishGame(reason: "completed")
            }
        }
    }

    private func startLimitTimerIfNeeded() {
        limitTask?.cancel()
        guard let mins = session.limitMin, mins > 0 else { return }
        let nanos = UInt64(mins * 60 * 1_000_000_000)
        limitTask = Task {
            try? await Task.sleep(nanoseconds: nanos)
            guard !Task.isCancelled else { return }
            await MainActor.run { finishGame(reason: "timeout") }
        }
    }

    private func finishGame(reason: String) {
        guard !finished else { return }
        finished = true
        live.setEnded(currentPayload())
        GameAudio.shared.playCheer(childId: auth.childSlug)
        submitGameLog(endReason: reason)
        Task {
            try? await Task.sleep(nanoseconds: 4_400_000_000)
            await MainActor.run { onExit() }
        }
    }

    // MARK: -- Live + submit

    private func publishState() {
        live.setRunning(currentPayload())
    }

    private func currentPayload() -> LivePayload {
        LivePayload(
            target: target.map { .init(label: $0.label, imageKey: $0.imageKey) },
            i: index,
            total: targets.count,
            correctCount: correctCount
        )
    }

    private func submitGameLog(endReason: String) {
        guard !loggedAttempts.isEmpty else { return }
        var skillCounts: [String: Int] = [:]
        for a in loggedAttempts {
            guard let s = a.taxonomySlug, !s.isEmpty else { continue }
            skillCounts[s, default: 0] += 1
        }
        let skillSlug = skillCounts.max(by: { $0.value < $1.value })?.key
        let payload = APIClient.GameLogPayload(
            childId: auth.childSlug,
            mode: "expressive_naming",
            category: session.scope,
            startedAt: ISO8601DateFormatter().string(from: startedAt),
            endedAt: ISO8601DateFormatter().string(from: Date()),
            itemCount: targets.count,
            slidesAttempted: loggedAttempts.count,
            correctCount: correctCount,
            scoringVersion: 2,
            endReason: endReason,
            skillSlug: skillSlug,
            attempts: loggedAttempts.map { la in
                APIClient.GameLogPayload.Attempt(
                    itemId: la.itemId,
                    label: la.label,
                    category: la.category,
                    taxonomySlug: la.taxonomySlug,
                    correct: la.correct,
                    inputMethod: la.inputMethod,
                    misses: la.misses,
                    attemptsTaken: la.attemptsTaken,
                    distractorCount: la.distractorCount,
                    childGenerated: la.inputMethod != "tap",
                    occurredAt: ISO8601DateFormatter().string(from: la.occurredAt)
                )
            }
        )
        Task.detached(priority: .utility) {
            await APIClient().submitGameLog(payload)
        }
    }
}

import SwiftUI

/// Facilitated matching game — "find the one I say."
///
/// Pedagogy (matches the web app exactly):
///   - The target word is ANNOUNCED with audio when a round starts. No text is
///     shown to the child — they listen and pick.
///   - Wrong tap → no negative feedback. We replay the word and escalate a hint
///     on the CORRECT tile: 1st miss wiggles it, 2nd miss gives it a yellow
///     glow, 3rd miss reveals it and moves on (errorless learning).
///   - Right tap → green pop + confetti, then the next round.
///   - The child never sees a score. The facilitator's phone still gets the
///     full target/progress/correct-count via the published live state.
struct MatchingView: View {
    let session: GameController.Session
    let onExit: () -> Void

    @Environment(BoardStore.self) private var board
    @Environment(LiveSession.self) private var live
    @Environment(GameController.self) private var game
    @Environment(AuthManager.self) private var auth

    @State private var targets: [Tile] = []
    @State private var index = 0
    @State private var choiceTiles: [Tile] = []
    @State private var correctCount = 0          // facilitator-only, never shown here

    // Per-round scaffolding state
    @State private var misses = 0
    @State private var locked = false
    @State private var glowCorrect = false       // yellow highlight on the answer
    @State private var wiggleCorrectId: Int?     // brief shake on the answer
    @State private var chosenCorrectId: Int?     // green pop on the picked answer

    @State private var celebrating = false
    @State private var finished = false
    @State private var lastHandledCmdSeq = 0
    @State private var limitTask: Task<Void, Never>?

    // PRD §3 honest scoring: track per-attempt rows + the running list of
    // facilitator-marked methods so we can ship a real /api/game-log payload
    // at session end. attempts records pass/fail + attempts_taken + method
    // per slide. startedAt is captured once when setup runs.
    @State private var startedAt: Date = .init()
    @State private var loggedAttempts: [LoggedAttempt] = []
    /// Pending facilitator mark for the current round (if any) — applied when
    /// the round closes so we record the right input_method instead of "tap".
    @State private var pendingMarkMethod: String?

    private var target: Tile? { targets.indices.contains(index) ? targets[index] : nil }
    private var choiceCount: Int { max(2, min(session.choices ?? 3, 6)) }

    var body: some View {
        ZStack {
            Color(hex: "#fff7fb").ignoresSafeArea()

            if finished {
                finishedView
            } else if let target {
                VStack(spacing: 24) {
                    listenButton(target)
                    Spacer()
                    choiceGrid(target)
                    Spacer(minLength: 40)
                }
                .padding(24)
            } else {
                Text("Nothing to practice here")
                    .font(.title2).foregroundStyle(.secondary)
            }

            exitButton
            ConfettiView(running: celebrating)
        }
        .task { setup() }
        .onDisappear {
            limitTask?.cancel()
            GameAudio.shared.stopMusic()
        }
        .onChange(of: index) { _, _ in publishState() }
        .onChange(of: game.inGameCommand) { _, cmd in handleCommand(cmd) }
    }

    // MARK: -- Pieces

    /// A single "Listen again" button — replays the target audio. Deliberately
    /// shows NO text (the child isn't reading the answer, they're hearing it).
    private func listenButton(_ target: Tile) -> some View {
        Button {
            // Replays the PROMPT — in the clue/auditory modes that's the clue
            // or description, never the answer word (which would give it away).
            announceTarget()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "speaker.wave.3.fill")
                Text("Listen")
            }
            .font(.system(size: 26, weight: .bold, design: .rounded))
            .foregroundStyle(Color(hex: "#ad1457"))
            .padding(.horizontal, 28).padding(.vertical, 14)
            .background(Color.white)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color(hex: "#ff1493"), lineWidth: 3))
            .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
        }
        .buttonStyle(.plain)
    }

    private func choiceGrid(_ target: Tile) -> some View {
        let cols = choiceCount <= 4 ? choiceCount : 3
        return LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 18), count: cols),
            spacing: 18
        ) {
            ForEach(choiceTiles) { tile in
                let isAnswer = tile.id == target.id
                ChoiceTile(
                    tile: tile,
                    glow: isAnswer && glowCorrect,
                    wiggle: wiggleCorrectId == tile.id,
                    pop: chosenCorrectId == tile.id,
                    dim: chosenCorrectId != nil && chosenCorrectId != tile.id
                ) {
                    tap(tile, target: target)
                }
            }
        }
        .frame(maxWidth: 860)
    }

    private var finishedView: some View {
        VStack(spacing: 18) {
            Text("🎉").font(.system(size: 96))
            Text("Great job!")
                .font(.system(size: 52, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
        }
    }

    private var exitButton: some View {
        LongPressExitButton.corner(
            tint: Color(hex: "#ad1457"),
            background: Color.black.opacity(0.06)
        ) { onExit() }
    }

    // MARK: -- Game logic

    /// What we persist per slide. Mirrors api/game-log's `attempts[]` shape so
    /// no transform layer is needed at submit time.
    struct LoggedAttempt {
        var itemId: Int?
        var label: String
        var category: String?
        var taxonomySlug: String?
        var correct: Bool
        var inputMethod: String       // "tap" | "verbal" | "object" | "physical" | "gesture"
        var attemptsTaken: Int        // 1 = first try, 2 = mercy, etc.
        var distractorCount: Int
        var misses: Int               // legacy field — kept for parity with web rows
        var occurredAt: Date
    }

    private func setup() {
        var pool = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { ($0.imageKey?.isEmpty == false) }
        // Clue quiz: targets prefer tiles with something to speak (a teaching
        // clue or an auditory description) — clue-less tiles still serve as
        // distractors via buildChoices' board-wide fallback.
        if case .clueQuiz = session.mode {
            let cluey = pool.filter { ($0.descriptiveClues?.isEmpty == false) || ($0.description?.isEmpty == false) }
            if !cluey.isEmpty { pool = cluey }
        }
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
            GameAudio.shared.startMusic(childId: auth.childSlug)   // background music
            startRound()
        }
        startLimitTimerIfNeeded()
    }

    /// End the lesson: stop polling state to ended, play the vocalized cheer
    /// over the still-playing music, ship the /api/game-log payload, then
    /// auto-exit so the kid never sees a "Done" button to puzzle over. Parent
    /// can long-hold ✕ to leave early. PRD §3: slides_attempted reflects
    /// what actually happened (last index reached + 1), separate from the
    /// game's full length.
    private func finishGame(reason: String = "completed") {
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

    /// Build the /api/game-log payload from the per-round records and POST
    /// fire-and-forget. The post itself is best-effort: a failure never blocks
    /// the celebration or exit. PRD §3 honest scoring: denominator is
    /// `slidesAttempted` (rounds actually played), NOT `targets.count`.
    private func submitGameLog(endReason: String) {
        guard !loggedAttempts.isEmpty else { return }
        let modeStr: String
        switch session.mode {
        case .matching:                modeStr = "self_paced"
        case .auditoryComprehension:   modeStr = "auditory_comprehension"
        case .clueQuiz:                modeStr = "clue_quiz"
        case .expressiveNaming:        modeStr = "expressive_naming"
        case .slideshow(let fp):       modeStr = fp ? "exposure_slideshow" : "learn_slideshow"
        case .teach:                   modeStr = "teach_slideshow"   // never runs here; keeps the switch exhaustive
        case .celebration:             modeStr = "celebration"
        }
        let payload = APIClient.GameLogPayload(
            childId: auth.childSlug,
            mode: modeStr,
            category: session.scope,
            startedAt: ISO8601DateFormatter().string(from: startedAt),
            endedAt: ISO8601DateFormatter().string(from: Date()),
            itemCount: targets.count,                         // full game length
            slidesAttempted: loggedAttempts.count,            // honest denominator
            correctCount: correctCount,
            scoringVersion: 2,
            endReason: endReason,
            skillSlug: dominantSkillSlug,
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

    /// The skill anchor for the session: the most-frequent taxonomy_slug
    /// across the played targets. Empty when none of the played items had a
    /// canonical slug (custom-board tile, etc.) — the server falls back to
    /// label in that case.
    private var dominantSkillSlug: String? {
        var counts: [String: Int] = [:]
        for a in loggedAttempts {
            guard let s = a.taxonomySlug, !s.isEmpty else { continue }
            counts[s, default: 0] += 1
        }
        return counts.max(by: { $0.value < $1.value })?.key
    }

    /// Reset per-round state, build choices, announce the target.
    private func startRound() {
        misses = 0
        locked = false
        glowCorrect = false
        wiggleCorrectId = nil
        chosenCorrectId = nil
        buildChoices()
        publishState()
        announceTarget()
    }

    /// In matching mode we play the tile's recorded audio (or TTS the label
    /// as a fallback). In Auditory Comprehension we instead speak the
    /// description text — that IS the puzzle ("lives in a field, four legs,
    /// eats grass" → horse). PRD §5.
    private func announceTarget() {
        guard let target else { return }
        switch session.mode {
        case .auditoryComprehension:
            // Descriptions are English taxonomy prose — translated boards
            // hear the word itself in the board's language instead.
            let desc = target.description?.trimmingCharacters(in: .whitespacesAndNewlines)
            let prompt = (target.displayLabel?.isEmpty == false)
                ? target.display
                : (desc?.isEmpty == false) ? desc! : "Who or what is the \(target.label)?"
            GameAudio.shared.speak(prompt, childId: auth.childSlug)
        case .clueQuiz:
            GameAudio.shared.speak(cluePrompt(for: target), childId: auth.childSlug)
        default:
            Task { await TilePlayer.shared.play(target) }
        }
    }

    /// Clue quiz prompt: the clue at the current miss count — clues are
    /// authored easiest-first, so each wrong tap reveals the next one.
    /// Tiles without clues fall back to their auditory description, then to
    /// a generic question.
    private func cluePrompt(for target: Tile) -> String {
        // Clues are English taxonomy prose — on translated boards the prompt
        // is just the word in the board's language.
        if let d = target.displayLabel, !d.isEmpty { return d }
        let clues = (target.descriptiveClues ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if !clues.isEmpty { return clues[min(misses, clues.count - 1)] }
        if let d = target.description?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty { return d }
        return "Who or what is the \(target.label)?"
    }

    private func buildChoices() {
        guard let target else { choiceTiles = []; return }
        let pool = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { $0.id != target.id && ($0.imageKey?.isEmpty == false) }
        let fallback = board.tiles.filter { $0.id != target.id && ($0.imageKey?.isEmpty == false) }
        let source = pool.count >= choiceCount - 1 ? pool : fallback
        let distractors = source.shuffled().prefix(choiceCount - 1)
        choiceTiles = ([target] + distractors).shuffled()
    }

    private func tap(_ tile: Tile, target: Tile) {
        guard !locked else { return }
        if tile.id == target.id {
            // Correct → green pop, reinforce the word, confetti, advance.
            // PRD §3.2 mercy: a pass on attempt 2 or 3 is a FULL PASS, not a
            // downgrade — credit unconditionally on any successful tap.
            locked = true
            chosenCorrectId = tile.id
            correctCount += 1
            recordAttempt(target: target, passed: true)
            Task { await TilePlayer.shared.play(target) }
            celebrate()
            advance(after: 0.95)
        } else {
            // Wrong → escalate a hint on the CORRECT tile, replay the word.
            // Two attempts total: 1st miss highlights the answer (wiggle +
            // yellow glow) and re-announces; 2nd miss reveals + moves on.
            misses += 1
            if misses == 1 {
                glowCorrect = true
                wiggleCorrectId = target.id
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { wiggleCorrectId = nil }
                announceTarget()
            } else {        // 2nd miss → answer already glowing, move on
                locked = true
                recordAttempt(target: target, passed: false)
                advance(after: 0.9)
            }
        }
    }

    /// Append a row to loggedAttempts when a round closes (either via a
    /// correct tap or by hitting the mercy ceiling). attempts_taken is misses
    /// + 1 on a pass (the successful tap is one more attempt beyond the
    /// failures), or just misses on a fail. Method falls back to "tap" but a
    /// facilitator mark for this round takes precedence (PRD §4).
    private func recordAttempt(target: Tile, passed: Bool) {
        let method = pendingMarkMethod ?? "tap"
        pendingMarkMethod = nil
        let attemptsTaken = passed ? (misses + 1) : misses
        loggedAttempts.append(LoggedAttempt(
            itemId: target.id,
            label: target.label,
            category: target.taxonomySlug?.split(separator: ".").dropLast().joined(separator: ".") ?? nil,
            taxonomySlug: target.taxonomySlug,
            correct: passed,
            inputMethod: method,
            attemptsTaken: max(1, attemptsTaken),
            distractorCount: max(0, choiceTiles.count - 1),
            misses: misses,
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
                startRound()
            } else {
                finishGame()
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

    // MARK: -- Live integration

    private func handleCommand(_ cmd: LiveCommand?) {
        guard let cmd, cmd.seq > lastHandledCmdSeq else { return }
        lastHandledCmdSeq = cmd.seq
        switch cmd.action {
        case "next", "skip":
            // Facilitator chose to skip this round — record as a fail with
            // the current attempt count so the denominator still tracks it.
            if let t = target, !locked {
                pendingMarkMethod = nil
                recordAttempt(target: t, passed: false)
            }
            advance()
        case "mark":
            // PRD §4: the mark IS the credit + the input method. Pass-through
            // methods come from the facilitator console: 'verbal', 'object',
            // 'physical', 'gesture' — anything that isn't a button tap counts
            // as child-generated for spike-weighting later.
            let method = (cmd.method?.isEmpty == false) ? cmd.method! : "verbal"
            pendingMarkMethod = method
            // If the facilitator reports the kid took multiple tries before
            // they marked, retroactively set our misses so attempts_taken
            // lands right on the persisted row (PRD §3.2).
            if let n = cmd.attemptsTaken, n > 1 { misses = max(misses, n - 1) }
            if let t = target, !locked {
                correctCount += 1
                celebrate()
                recordAttempt(target: t, passed: true)
                locked = true
            }
            advance(after: 0.6)
        case "end":
            // Facilitator stopped early — honest end_reason so the dashboard
            // can distinguish a 5-of-12 quit from a 5-of-5 completion.
            finishGame(reason: "facilitator_stop")
        default:
            break
        }
        game.consumeInGameCommand()
    }

    private func currentPayload() -> LivePayload {
        LivePayload(
            target: target.map { .init(label: $0.label, imageKey: $0.imageKey) },
            i: index,
            total: targets.count,
            correctCount: correctCount
        )
    }

    private func publishState() {
        live.setRunning(currentPayload())
    }
}

/// One tappable choice. Visual states drive the errorless-learning scaffolding:
///   glow   → yellow highlight on the correct answer (after 2nd miss / reveal)
///   wiggle → brief shake on the correct answer (after 1st miss)
///   pop    → green ring on the answer the child correctly picked
///   dim    → fade the other tiles once the answer is found
private struct ChoiceTile: View {
    let tile: Tile
    var glow = false
    var wiggle = false
    var pop = false
    var dim = false
    let onTap: () -> Void

    @State private var image: UIImage?

    private var borderColor: Color {
        if pop  { return Color(hex: "#16a34a") }       // green
        if glow { return Color(hex: "#facc15") }       // yellow
        return Color.black.opacity(0.08)
    }
    private var borderWidth: CGFloat { (pop || glow) ? 6 : 2 }

    var body: some View {
        Button(action: onTap) {
            ZStack {
                RoundedRectangle(cornerRadius: 24).fill(Color(.systemBackground))
                if let img = image {
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(contentMode: tile.keepAspect ? .fit : .fill)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                } else {
                    ProgressView()
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).stroke(borderColor, lineWidth: borderWidth))
            .shadow(color: glow ? Color(hex: "#facc15").opacity(0.7) : .black.opacity(0.08),
                    radius: glow ? 16 : 8, y: 3)
            .scaleEffect(pop ? 1.06 : 1.0)
            .opacity(dim ? 0.4 : 1.0)
        }
        .buttonStyle(.plain)
        .offset(x: wiggle ? -8 : 0)
        .animation(wiggle ? .default.repeatCount(3, autoreverses: true).speed(6) : .spring(response: 0.25),
                   value: wiggle)
        .animation(.spring(response: 0.25), value: pop)
        .animation(.easeInOut(duration: 0.2), value: glow)
        .animation(.easeInOut(duration: 0.2), value: dim)
        .task(id: tile.imageKey) {
            guard let key = tile.imageKey, !key.isEmpty else { return }
            if let img = await MediaCache.shared.image(for: key, maxPixel: 640) {
                await MainActor.run { self.image = img }
            }
        }
    }
}

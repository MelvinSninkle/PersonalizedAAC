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
            Task { await TilePlayer.shared.play(target) }
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

    private func setup() {
        let pool = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { ($0.imageKey?.isEmpty == false) }
        var picked = pool.shuffled()
        if let n = session.sample, n > 0 { picked = Array(picked.prefix(n)) }
        targets = picked
        index = 0
        correctCount = 0
        if targets.isEmpty {
            finishGame()
        } else {
            GameAudio.shared.startMusic(childId: auth.childSlug)   // background music
            startRound()
        }
        startLimitTimerIfNeeded()
    }

    /// End the lesson: stop polling state to ended, play the vocalized cheer
    /// over the still-playing music, then auto-exit so the kid never sees a
    /// "Done" button to puzzle over. Parent can long-hold ✕ to leave early.
    private func finishGame() {
        guard !finished else { return }
        finished = true
        live.setEnded(currentPayload())
        GameAudio.shared.playCheer(childId: auth.childSlug)
        Task {
            try? await Task.sleep(nanoseconds: 4_400_000_000)
            await MainActor.run { onExit() }
        }
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

    private func announceTarget() {
        guard let target else { return }
        Task { await TilePlayer.shared.play(target) }
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
            locked = true
            chosenCorrectId = tile.id
            correctCount += (misses == 0 ? 1 : 0)
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
                advance(after: 0.9)
            }
        }
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
            await MainActor.run { finishGame() }
        }
    }

    // MARK: -- Live integration

    private func handleCommand(_ cmd: LiveCommand?) {
        guard let cmd, cmd.seq > lastHandledCmdSeq else { return }
        lastHandledCmdSeq = cmd.seq
        switch cmd.action {
        case "next", "skip":
            advance()
        case "mark":
            if cmd.method == "verbal" || cmd.method == "physical" || cmd.method == "correct" {
                correctCount += 1
                celebrate()
            }
            advance(after: 0.6)
        case "end":
            onExit()
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
            if let img = await MediaCache.shared.image(for: key) {
                await MainActor.run { self.image = img }
            }
        }
    }
}

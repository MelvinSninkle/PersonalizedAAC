import SwiftUI

/// Facilitated matching game. The tablet picks a target word and shows it
/// large at the top, with `choices` tiles below (the target + distractors).
/// The child taps a tile:
///   - correct → confetti, advance to the next target
///   - wrong   → gentle shake, stays so they can try again
///
/// The facilitator's phone can also drive it via live commands (next / skip /
/// end / mark). The tablet publishes its current target + progress every step
/// so the phone shows what's on screen.
struct MatchingView: View {
    let session: GameController.Session
    let onExit: () -> Void

    @Environment(BoardStore.self) private var board
    @Environment(LiveSession.self) private var live
    @Environment(GameController.self) private var game

    @State private var targets: [Tile] = []
    @State private var index = 0
    @State private var choiceTiles: [Tile] = []
    @State private var correctCount = 0
    @State private var celebrating = false
    @State private var wrongShakeId: Int?
    @State private var lastHandledCmdSeq = 0
    @State private var finished = false
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
                    promptHeader(target)
                    Spacer()
                    choiceGrid(target)
                    Spacer()
                    progressFooter
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
        .onDisappear { limitTask?.cancel() }
        .onChange(of: index) { _, _ in publishState() }
        .onChange(of: game.inGameCommand) { _, cmd in handleCommand(cmd) }
    }

    // MARK: -- Pieces

    private func promptHeader(_ target: Tile) -> some View {
        VStack(spacing: 8) {
            Text("Find…")
                .font(.title3).foregroundStyle(.secondary)
            Button {
                Task { await TilePlayer.shared.play(target) }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "speaker.wave.2.fill")
                    Text(target.label)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                }
                .foregroundStyle(Color(hex: "#ad1457"))
            }
            .buttonStyle(.plain)
        }
    }

    private func choiceGrid(_ target: Tile) -> some View {
        let cols = choiceCount <= 4 ? choiceCount : 3
        return LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 18), count: cols),
            spacing: 18
        ) {
            ForEach(choiceTiles) { tile in
                ChoiceTile(tile: tile, shaking: wrongShakeId == tile.id) {
                    tap(tile, target: target)
                }
            }
        }
        .frame(maxWidth: 820)
    }

    private var progressFooter: some View {
        Text("\(index + 1) of \(targets.count)   ·   \(correctCount) correct")
            .font(.callout)
            .foregroundStyle(.secondary)
    }

    private var finishedView: some View {
        VStack(spacing: 18) {
            Text("🎉")
                .font(.system(size: 90))
            Text("Great job!")
                .font(.system(size: 48, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
            Text("\(correctCount) of \(targets.count) correct")
                .font(.title3).foregroundStyle(.secondary)
            Button {
                onExit()
            } label: {
                Text("Done")
                    .font(.title3.weight(.semibold))
                    .padding(.horizontal, 40).padding(.vertical, 14)
                    .foregroundStyle(.white)
                    .background(Color(hex: "#ff1493"))
                    .clipShape(Capsule())
            }
            .padding(.top, 8)
        }
    }

    private var exitButton: some View {
        VStack {
            HStack {
                Spacer()
                Button {
                    onExit()
                } label: {
                    Image(systemName: "xmark")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.secondary)
                        .padding(12)
                        .background(.thinMaterial)
                        .clipShape(Circle())
                }
                .padding(.top, 16).padding(.trailing, 16)
            }
            Spacer()
        }
    }

    // MARK: -- Game logic

    private func setup() {
        let pool = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { ($0.imageKey?.isEmpty == false) }   // need an image to match on
        var picked = pool.shuffled()
        // Random sample: keep just N for a short, focused lesson.
        if let n = session.sample, n > 0 { picked = Array(picked.prefix(n)) }
        targets = picked
        index = 0
        correctCount = 0
        finished = targets.isEmpty
        buildChoices()
        publishState()
        startLimitTimerIfNeeded()
    }

    /// Auto-end the lesson after the facilitator's time limit (1–4 min).
    private func startLimitTimerIfNeeded() {
        limitTask?.cancel()
        guard let mins = session.limitMin, mins > 0 else { return }
        let nanos = UInt64(mins * 60 * 1_000_000_000)
        limitTask = Task {
            try? await Task.sleep(nanoseconds: nanos)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                finished = true
                live.setEnded(currentPayload())
            }
        }
    }

    private func buildChoices() {
        guard let target else { choiceTiles = []; return }
        // Distractors: other tiles from the same pool, falling back to any tile.
        let pool = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { $0.id != target.id && ($0.imageKey?.isEmpty == false) }
        let fallback = board.tiles.filter { $0.id != target.id && ($0.imageKey?.isEmpty == false) }
        let distractorSource = pool.count >= choiceCount - 1 ? pool : fallback
        let distractors = distractorSource.shuffled().prefix(choiceCount - 1)
        choiceTiles = ([target] + distractors).shuffled()
    }

    private func tap(_ tile: Tile, target: Tile) {
        Task { await TilePlayer.shared.play(tile) }
        if tile.id == target.id {
            correctCount += 1
            celebrate()
            advance(after: 1.4)
        } else {
            wrongShakeId = tile.id
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { wrongShakeId = nil }
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
                buildChoices()
            } else {
                finished = true
                live.setEnded(currentPayload())
            }
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

/// One tappable choice in the matching grid. Big, square, with a shake
/// animation when it's the wrong answer.
private struct ChoiceTile: View {
    let tile: Tile
    let shaking: Bool
    let onTap: () -> Void

    @State private var image: UIImage?

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
            .overlay(
                RoundedRectangle(cornerRadius: 24)
                    .stroke(Color.black.opacity(0.08), lineWidth: 2)
            )
            .shadow(color: .black.opacity(0.08), radius: 8, y: 3)
        }
        .buttonStyle(.plain)
        .offset(x: shaking ? -8 : 0)
        .animation(shaking ? .default.repeatCount(3, autoreverses: true).speed(6) : .default,
                   value: shaking)
        .task(id: tile.imageKey) {
            guard let key = tile.imageKey, !key.isEmpty else { return }
            if let img = await MediaCache.shared.image(for: key) {
                await MainActor.run { self.image = img }
            }
        }
    }
}

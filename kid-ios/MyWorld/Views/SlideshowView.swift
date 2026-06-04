import SwiftUI

/// Passive learning slideshow — "Learn" (plain labels) and "Exposure"
/// (first-person "I can see a ___"). Matches the web app:
///   - Auto-advances every `secondsPerImage` (default 5, min 2).
///   - LOOPS through the deck until the time limit (or ✕). Passive exposure is
///     about calm repetition, not finishing.
///   - Speaks each tile as it appears (recorded audio or TTS).
///   - Background music loops underneath.
/// A tap advances early; the ✕ exits.
struct SlideshowView: View {
    let session: GameController.Session
    let onExit: () -> Void

    @Environment(BoardStore.self) private var board
    @Environment(AuthManager.self) private var auth

    @State private var deck: [Tile] = []
    @State private var pos = 0
    @State private var image: UIImage?
    @State private var advanceTask: Task<Void, Never>?
    @State private var limitTask: Task<Void, Never>?

    private var firstPerson: Bool {
        if case .slideshow(let fp) = session.mode { return fp }
        return false
    }
    private var secondsPerImage: Double { max(2, session.secondsPerImage ?? 5) }
    private var current: Tile? { deck.indices.contains(pos) ? deck[pos] : nil }

    private var labelText: String {
        guard let t = current else { return "" }
        return firstPerson ? "I can see a \(t.label)" : t.label
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let _ = current {
                VStack(spacing: 24) {
                    Spacer()
                    if let img = image {
                        Image(uiImage: img)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 760, maxHeight: 560)
                            .clipShape(RoundedRectangle(cornerRadius: 28))
                            .shadow(radius: 28)
                    } else {
                        ProgressView().tint(.white)
                    }
                    Text(labelText)
                        .font(.system(size: 60, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                    Spacer()
                }
            } else {
                Text("No pictures to show here yet")
                    .foregroundStyle(.white)
            }

            // Exit — top-right, away from the center a kid taps to advance.
            VStack {
                HStack {
                    Spacer()
                    Button { onExit() } label: {
                        Image(systemName: "xmark")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(14)
                            .background(Color.white.opacity(0.16))
                            .clipShape(Circle())
                    }
                    .padding(.top, 18).padding(.trailing, 18)
                }
                Spacer()
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { advance() }     // tap advances early
        .task { setup() }
        .onDisappear {
            advanceTask?.cancel()
            limitTask?.cancel()
            GameAudio.shared.stopMusic()
        }
        .task(id: pos) { await loadCurrent() }
    }

    private func setup() {
        deck = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { $0.imageKey?.isEmpty == false && !$0.label.isEmpty }
            .shuffled()
        pos = 0
        GameAudio.shared.startMusic(childId: auth.childSlug, override: session.music)
        scheduleAdvance()
        startLimitIfNeeded()
    }

    private func loadCurrent() async {
        image = nil
        guard let t = current else { return }
        if let key = t.imageKey, !key.isEmpty,
           let img = await MediaCache.shared.image(for: key) {
            await MainActor.run { self.image = img }
        }
        await TilePlayer.shared.play(t)     // speak the word/phrase
    }

    /// Auto-advance after `secondsPerImage`. Re-armed each slide.
    private func scheduleAdvance() {
        advanceTask?.cancel()
        advanceTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(secondsPerImage * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await MainActor.run { advance() }
        }
    }

    private func advance() {
        guard !deck.isEmpty else { return }
        pos = (pos + 1) % deck.count   // loop forever until the limit / exit
        scheduleAdvance()
    }

    private func startLimitIfNeeded() {
        guard let mins = session.limitMin, mins > 0 else { return }
        limitTask?.cancel()
        limitTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(mins * 60 * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await MainActor.run { onExit() }
        }
    }
}

import SwiftUI

/// Passive learning slideshow — "Learn" (plain labels) and "Exposure"
/// (first-person "I can see a ___"). Matches the web pacing:
///   - Auto-advances every `secondsPerImage` (default 5, min 2).
///   - LOOPS through the deck until the time limit (or long-hold ✕). Passive
///     exposure is calm repetition, not "finishing".
///   - Speaks each tile as it appears (recorded audio or TTS — Exposure uses
///     the "I can see a ___" phrasing).
///   - Background music loops underneath.
/// A tap anywhere advances early; long-hold the ✕ in the corner to exit.
///
/// Visually minimal on purpose: soft pastel background, image only, no text
/// label on screen. The phrasing is heard, not read.
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
    private var spokenPhrase: String {
        guard let t = current else { return "" }
        return firstPerson ? "I can see a \(t.label)" : t.label
    }

    var body: some View {
        ZStack {
            // Soft pastel background — matches the board, not the harsh black.
            Color(hex: "#fff7fb").ignoresSafeArea()

            if let _ = current {
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
            }

            // Long-hold ✕ to exit (consistent across every full-screen view).
            LongPressExitButton.corner(
                tint: Color(hex: "#ad1457"),
                background: Color.black.opacity(0.06)
            ) { onExit() }
        }
        .contentShape(Rectangle())
        .onTapGesture { advance() }     // any tap advances
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
        // Speak the phrase ("milk" for Learn, "I can see a milk" for Exposure).
        // Exposure uses TTS so the phrasing reads correctly; Learn prefers the
        // tile's recorded sound when one exists.
        if firstPerson {
            GameAudio.shared.speak(spokenPhrase, childId: auth.childSlug)
        } else {
            await TilePlayer.shared.play(t)
        }
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

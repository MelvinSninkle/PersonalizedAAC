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
        // Translated boards speak the board-language word alone — the
        // "I can see a" frame is English prose that doesn't translate here.
        if let d = t.displayLabel, !d.isEmpty { return d }
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
        // Taps do NOTHING in a passive slideshow — a child mashing the screen
        // shouldn't skip slides. Long-hold ✕ is the only exit.
        .contentShape(Rectangle())
        .task { setup() }
        .onDisappear {
            advanceTask?.cancel()
            limitTask?.cancel()
            GameAudio.shared.stopMusic()
            // PRD §8: a slideshow run is one exposure of its dominant skill.
            // Tick once on exit so the schedule advances and Phase 7 can
            // bucket spikes against the right exposure count.
            tickDominantSkillOnExit()
        }
        .task(id: pos) { await loadCurrent() }
    }

    /// Most-common taxonomy_slug across the played deck. Slideshows that
    /// scope to a category usually have a coherent skill (e.g. "Numbers");
    /// for mixed decks we pick whichever skill the child saw most.
    /// Auto-teach runs (scope "slugs:…") skip this — the runner already ticked
    /// every batch slug with source auto_slideshow when the countdown fired.
    private func tickDominantSkillOnExit() {
        if session.scope?.hasPrefix("slugs:") == true { return }
        var counts: [String: Int] = [:]
        for t in deck {
            guard let s = t.taxonomySlug, !s.isEmpty else { continue }
            counts[s, default: 0] += 1
        }
        guard let skill = counts.max(by: { $0.value < $1.value })?.key else { return }
        let childId = auth.childSlug
        Task.detached(priority: .utility) {
            await APIClient().tickExposure(childId: childId, skillSlug: skill, source: "slideshow")
        }
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
           let img = await MediaCache.shared.image(for: key, maxPixel: 1024) {
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

/// "Teach me" — the child-launched teaching slideshow (header 📖 button).
/// One pass through the scope's tiles, shuffled. Unlike the passive slideshow,
/// reading along is the point: each slide shows the picture WITH the word on
/// screen, speaks the word, then speaks every taxonomy teaching clue
/// (descriptive_clues, easiest first) while showing it as a caption, then
/// advances. Exits by itself after the last tile; long-hold ✕ to leave early.
/// (Lives in this file so XcodeGen doesn't need a regen for a new file.)
struct TeachShowView: View {
    let session: GameController.Session
    let onExit: () -> Void

    @Environment(BoardStore.self) private var board
    @Environment(AuthManager.self) private var auth

    @State private var deck: [Tile] = []
    @State private var pos = 0
    @State private var image: UIImage?
    @State private var clue = ""
    @State private var runner: Task<Void, Never>?
    @State private var limitTask: Task<Void, Never>?

    private var current: Tile? { deck.indices.contains(pos) ? deck[pos] : nil }

    var body: some View {
        ZStack {
            Color(hex: "#fff7fb").ignoresSafeArea()

            VStack(spacing: 16) {
                if let img = image {
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxWidth: 720, maxHeight: 480)
                        .clipShape(RoundedRectangle(cornerRadius: 32))
                        .shadow(color: .black.opacity(0.12), radius: 28, y: 8)
                } else if current != nil {
                    ProgressView().tint(Color(hex: "#ad1457")).frame(height: 300)
                }

                if let d = current?.displayLabel, !d.isEmpty {
                    // Translated boards: non-English art renders with no baked
                    // caption band, so the word must be shown here.
                    Text(d)
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: "#ad1457"))
                }
                if current != nil {
                    // No separate word label (English boards) — the tile art
                    // carries its own caption band; repeating it read as clutter.
                    // The clue being spoken right now — empty between clues.
                    Text(clue)
                        .font(.system(size: 24, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color(hex: "#6b7280"))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 44)
                        .frame(minHeight: 70)
                }

                if !deck.isEmpty {
                    Text("\(min(pos + 1, deck.count)) / \(deck.count)")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color(hex: "#d6a8c6"))
                }
            }
            .padding(28)

            LongPressExitButton.corner(
                tint: Color(hex: "#ad1457"),
                background: Color.black.opacity(0.06)
            ) { onExit() }
        }
        .task { start() }
        .onDisappear {
            runner?.cancel()
            limitTask?.cancel()
            tickDominantSkillOnExit()
        }
    }

    private func start() {
        deck = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { $0.imageKey?.isEmpty == false && !$0.label.isEmpty }
            .shuffled()
        // Parent-launched runs can cap the deck ("5 random") and set a limit.
        if let n = session.sample, n > 0 { deck = Array(deck.prefix(n)) }
        guard !deck.isEmpty else { onExit(); return }
        runner = Task { await run() }
        if let mins = session.limitMin, mins > 0 {
            limitTask = Task {
                try? await Task.sleep(nanoseconds: UInt64(mins * 60 * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await MainActor.run { onExit() }
            }
        }
    }

    /// The teaching loop — event-paced (advances when the speech is done), not
    /// timer-paced like the passive slideshow.
    private func run() async {
        let childId = auth.childSlug
        for (i, tile) in deck.enumerated() {
            if Task.isCancelled { return }
            await MainActor.run { pos = i; clue = ""; image = nil }
            if let key = tile.imageKey, !key.isEmpty,
               let img = await MediaCache.shared.image(for: key, maxPixel: 1024) {
                if Task.isCancelled { return }
                await MainActor.run { image = img }
            }
            // Let the new image actually be ON SCREEN before the word plays —
            // speaking over the previous slide's tail read as out-of-sync.
            try? await Task.sleep(nanoseconds: 350_000_000)
            if Task.isCancelled { return }
            // The word first…
            await GameAudio.shared.speakAwait(tile.display, childId: childId)
            // …then every teaching clue, shown while it's spoken. Clues are
            // English taxonomy prose — skipped on translated boards.
            for c in (tile.displayLabel == nil ? (tile.descriptiveClues ?? []) : []) {
                if Task.isCancelled { return }
                await MainActor.run { clue = c }
                await GameAudio.shared.speakAwait(c, childId: childId)
                try? await Task.sleep(nanoseconds: 350_000_000)
            }
            try? await Task.sleep(nanoseconds: 900_000_000)
        }
        if !Task.isCancelled { await MainActor.run { onExit() } }
    }

    /// Same PRD §8 semantics as the passive slideshow — a teach run is one
    /// exposure of its dominant skill.
    private func tickDominantSkillOnExit() {
        var counts: [String: Int] = [:]
        for t in deck {
            guard let s = t.taxonomySlug, !s.isEmpty else { continue }
            counts[s, default: 0] += 1
        }
        guard let skill = counts.max(by: { $0.value < $1.value })?.key else { return }
        let childId = auth.childSlug
        Task.detached(priority: .utility) {
            await APIClient().tickExposure(childId: childId, skillSlug: skill, source: "slideshow")
        }
    }
}

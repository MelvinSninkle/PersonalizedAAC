import SwiftUI

/// The board, mirroring the web layout:
///
///   ┌──── HEADER (configurable colors) ────┐
///   │ People │ Nouns │ Verbs                │   ← visible columns set in prefs
///   │  (2fr) │ (4fr) │ (3fr)                │     (each can be hidden)
///   └──── NEEDS strip (optional) ──────────┘   ← horizontal strip, full width
struct BoardView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(BoardStore.self)  private var board
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(LiveSession.self) private var live
    @Environment(GameController.self) private var game

    @State private var showSettings = false
    @State private var showDisplay  = false
    @State private var editMode     = false

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(editMode: $editMode,
                      showDisplay: $showDisplay,
                      showSettings: $showSettings)

            GeometryReader { geo in
                HStack(spacing: 0) {
                    let widths = columnWidths(in: geo.size.width)
                    if prefs.showPeople {
                        SectionColumn(section: .people).frame(width: widths.people)
                        if prefs.showNouns || prefs.showVerbs { Divider() }
                    }
                    if prefs.showNouns {
                        SectionColumn(section: .nouns).frame(width: widths.nouns)
                        if prefs.showVerbs { Divider() }
                    }
                    if prefs.showVerbs {
                        SectionColumn(section: .verbs).frame(width: widths.verbs)
                    }
                }
            }

            if prefs.showNeeds {
                Divider()
                NeedsStrip()
            }
        }
        .background(Color(hex: "#fff7fb"))
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showDisplay)  { DisplaySettingsView() }
        .fullScreenCover(item: gameSessionBinding) { session in
            switch session.mode {
            case .slideshow, .celebration:
                SlideshowView(session: session) { game.stop() }
            case .matching:
                // Matching lands in the next commit — for now slideshow stands in.
                SlideshowView(session: session) { game.stop() }
            }
        }
        .task {
            await board.refresh(childId: auth.childSlug)
            live.start(childId: auth.childSlug)
        }
        .onDisappear { live.stop() }
        .refreshable { await board.refresh(childId: auth.childSlug) }
        .onChange(of: live.latest) { _, cmd in
            guard let cmd else { return }
            game.apply(cmd)
            live.acknowledge()
        }
    }

    /// Binding adapter that lets `fullScreenCover(item:)` observe the
    /// optional GameController.Session — the cover only presents when non-nil.
    private var gameSessionBinding: Binding<GameController.Session?> {
        Binding(
            get: { game.current },
            set: { newValue in if newValue == nil { game.stop() } }
        )
    }

    /// Computes the px-widths for People / Nouns / Verbs given which columns
    /// are visible, keeping the web's 2:4:3 flex ratios.
    private func columnWidths(in total: CGFloat) -> (people: CGFloat, nouns: CGFloat, verbs: CGFloat) {
        var sum: CGFloat = 0
        if prefs.showPeople { sum += 2 }
        if prefs.showNouns  { sum += 4 }
        if prefs.showVerbs  { sum += 3 }
        guard sum > 0 else { return (0, 0, 0) }
        let unit = total / sum
        return (
            people: prefs.showPeople ? unit * 2 : 0,
            nouns:  prefs.showNouns  ? unit * 4 : 0,
            verbs:  prefs.showVerbs  ? unit * 3 : 0
        )
    }
}

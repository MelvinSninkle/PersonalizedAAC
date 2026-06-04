import SwiftUI

/// The board, mirroring the web layout:
///
///   ┌──── HEADER (configurable colors) ────┐
///   │ People │ Nouns │ Verbs                │   ← visible columns set in prefs
///   └──── NEEDS strip (optional) ──────────┘   ← horizontal strip, full width
///
/// Tiles are a single uniform size across the whole board. A column's width
/// is `tilesAcross × tileSize`, so lowering a section's tiles-across in
/// Display Settings makes that column NARROWER (tiles keep their size) and the
/// freed space becomes whitespace on the right — rather than the old behavior
/// of fixed-ratio columns that just resized their own tiles.
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
                // One uniform tile size for the WHOLE board — columns and the
                // Needs strip — so every child-facing tile matches in size.
                let tile = computeLayout(in: geo.size.width).tile
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        let visible = visibleColumns
                        ForEach(Array(visible.enumerated()), id: \.element) { idx, section in
                            SectionColumn(section: section, tileSize: tile)
                                .frame(width: BoardMetrics.columnWidth(across: prefs.across(section),
                                                                       tile: tile))
                            if idx < visible.count - 1 { Divider() }
                        }
                        // Push columns left; freed space becomes whitespace.
                        Spacer(minLength: 0)
                    }
                    .frame(maxHeight: .infinity)

                    if prefs.showNeeds {
                        Divider()
                        NeedsStrip(tileSize: tile)
                    }
                }
            }
        }
        .background(Color(hex: "#fff7fb"))
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showDisplay)  { DisplaySettingsView() }
        .fullScreenCover(item: gameSessionBinding) { session in
            Group {
                switch session.mode {
                case .matching:
                    MatchingView(session: session) { endGame() }
                case .slideshow:
                    SlideshowView(session: session) { endGame() }
                case .celebration:
                    CelebrationView { endGame() }
                }
            }
        }
        .task {
            prefs.attach(childId: auth.childSlug)
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

    /// Close any running game and return the tablet to "listening" so the
    /// facilitator phone shows standby again.
    private func endGame() {
        game.stop()
        live.setStandby()
    }

    /// Binding adapter that lets `fullScreenCover(item:)` observe the
    /// optional GameController.Session — the cover only presents when non-nil.
    private var gameSessionBinding: Binding<GameController.Session?> {
        Binding(
            get: { game.current },
            set: { newValue in if newValue == nil { game.stop() } }
        )
    }

    /// The People/Nouns/Verbs columns currently visible, in order.
    private var visibleColumns: [BoardSection] {
        [.people, .nouns, .verbs].filter { prefs.show($0) }
    }

    /// Computes a single uniform tile size for the whole board. Every column's
    /// width is then `tilesAcross × tile`, so all tiles are the same size and
    /// reducing a column's tiles-across narrows that column (rather than
    /// growing its tiles). At the default density the board fills the screen;
    /// when packed past the reference density, tiles shrink to fit.
    private func computeLayout(in width: CGFloat) -> (tile: CGFloat, total: Int) {
        let visible = visibleColumns
        let n = visible.count
        guard n > 0, width > 0 else { return (BoardMetrics.minTile, 0) }
        let totalAcross = visible.reduce(0) { $0 + prefs.across($1) }
        guard totalAcross > 0 else { return (BoardMetrics.minTile, 0) }

        // Width consumed by gaps, paddings, and dividers (i.e. not tiles).
        let chrome = visible.reduce(CGFloat(0)) { acc, s in
            let a = prefs.across(s)
            return acc + 2 * BoardMetrics.columnPad + CGFloat(a - 1) * BoardMetrics.tileGap
        } + CGFloat(n - 1) * BoardMetrics.dividerWidth
        let availForTiles = max(0, width - chrome)

        // Constant comfortable size (keeps tiles steady as columns shrink) …
        let idealTile = width / BoardMetrics.referenceAcross
        // … but never overflow: shrink to fit if the board is packed.
        let fitTile = availForTiles / CGFloat(totalAcross)
        let tile = max(BoardMetrics.minTile, min(idealTile, fitTile))
        return (tile, totalAcross)
    }
}

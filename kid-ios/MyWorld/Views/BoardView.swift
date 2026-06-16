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
    @Environment(Scheduler.self) private var scheduler
    @Environment(AddTileQueue.self) private var addQueue
    @Environment(AutoTeachRunner.self) private var autoTeach

    @State private var showSettings = false
    @State private var showDisplay  = false
    @State private var editMode     = false
    @State private var showBatchReview = false
    @State private var pendingMessage: [MessageToken]?
    /// An in-grid "+ Add tile" tap; carries which section/folder to pre-select.
    @State private var addTileRequest: AddTileRequest?
    /// A tile tapped while the board is unlocked → opens the full board editor.
    @State private var editingTile: Tile?

    struct AddTileRequest: Identifiable {
        let id = UUID()
        let section: BoardSection
        let categoryId: Int?
    }

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
                            SectionColumn(section: section, tileSize: tile,
                                          editMode: editMode,
                                          onAdd: { sec, catId in
                                              addTileRequest = AddTileRequest(section: sec, categoryId: catId)
                                          },
                                          onEditTile: { editingTile = $0 })
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
                        NeedsStrip(tileSize: tile,
                                   editMode: editMode,
                                   onAdd: { addTileRequest = AddTileRequest(section: .needs, categoryId: nil) },
                                   onEditTile: { editingTile = $0 })
                    }
                }
            }
        }
        .background(Color(hex: "#fff7fb"))
        .overlay(alignment: .top) { scheduledPromptOverlay }
        .overlay(alignment: .bottom) { reviewBanner }
        .fullScreenCover(isPresented: Binding(
            get: { pendingMessage != nil },
            set: { if !$0 { pendingMessage = nil } }
        )) {
            if let toks = pendingMessage {
                MessageOverlayView(tokens: toks, childId: auth.childSlug) {
                    pendingMessage = nil
                }
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: addQueue.pendingReviewNotice)
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showDisplay)  { DisplaySettingsView() }
        .sheet(isPresented: $showBatchReview) { BatchReviewView { showBatchReview = false } }
        // Tap a tile while unlocked → the full board tile editor (rename, swap
        // picture, re-voice, pin, move, delete) — the app match to the web.
        .sheet(item: $editingTile) { tile in BoardTileEditSheet(tile: tile) }
        // Full-screen so the board + its header don't bleed through behind the
        // add UI (a centered form sheet looked cluttered on iPad).
        .fullScreenCover(item: $addTileRequest) { req in
            AddTileView(defaultSection: req.section, defaultCategoryId: req.categoryId) {
                addTileRequest = nil
            }
        }
        .fullScreenCover(item: gameSessionBinding) { session in
            Group {
                switch session.mode {
                case .matching, .auditoryComprehension:
                    // Auditory Comprehension reuses MatchingView's lifecycle
                    // and choice grid; only the prompt source differs
                    // (description TTS vs. recorded label audio — handled
                    // inside MatchingView.announceTarget).
                    MatchingView(session: session) { endGame() }
                case .expressiveNaming:
                    ExpressiveNamingView(session: session) { endGame() }
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
            scheduler.start(childId: auth.childSlug)
            autoTeach.start(childId: auth.childSlug)
        }
        .onDisappear {
            live.stop()
            scheduler.stop()
            autoTeach.stop()
        }
        .refreshable {
            await board.refresh(childId: auth.childSlug)
            scheduler.refreshSchedules()
        }
        .onChange(of: live.latest) { _, cmd in
            guard let cmd else { return }
            // PRD §4.7: a "message" command renders the parent's text as a
            // tile sequence. Doesn't go through GameController — it's an
            // overlay-only experience.
            if cmd.action == "message", let toks = cmd.tokens, !toks.isEmpty {
                pendingMessage = toks
            } else {
                game.apply(cmd)
            }
            live.acknowledge()
        }
        // Pause the scheduler tick while a game / unlock / settings sheet is up
        // so a fired schedule doesn't try to stack a second sheet on top.
        .onChange(of: game.current) { _, c in scheduler.isBlocked = (c != nil) || showSettings || showDisplay }
        .onChange(of: showSettings) { _, on in scheduler.isBlocked = on || showDisplay || (game.current != nil) }
        .onChange(of: showDisplay)  { _, on in scheduler.isBlocked = on || showSettings || (game.current != nil) }
    }

    /// Surface the scheduler's pending prompt as the right sheet.
    @ViewBuilder
    private var scheduledPromptOverlay: some View {
        if let s = scheduler.pending {
            switch s.type {
            case .reminder:
                ReminderToast(schedule: s) { scheduler.acknowledge() }
                    .transition(.move(edge: .top).combined(with: .opacity))
            case .question:
                ScheduledQuestionSheet(schedule: s) { scheduler.acknowledge() }
            case .game:
                GameNudgeCard(
                    schedule: s,
                    onPlay: {
                        // Launch a matching game scoped to the schedule's first scope.
                        let scope = (s.scopes?.first) ?? s.scope ?? "all"
                        scheduler.acknowledge()
                        game.startLocal(.matching, scope: scope)
                    },
                    onDismiss: { scheduler.acknowledge() }
                )
            }
        }
    }

    /// "Your bulk import is ready — review N tiles" banner. Pops from the
    /// bottom once a whole multi-photo batch has finished rendering (even if the
    /// parent already closed the Add-Tiles sheet). Tapping Review opens the
    /// native review sheet; ✕ defers it (the tiles are already on the board and
    /// still flagged, so the web dashboard can review them too).
    @ViewBuilder
    private var reviewBanner: some View {
        if let notice = addQueue.pendingReviewNotice {
            HStack(spacing: 12) {
                Text("✨")
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(notice.count) new \(notice.count == 1 ? "tile" : "tiles") ready")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    Text("Review the names & voices")
                        .font(.system(size: 12)).opacity(0.85)
                }
                Spacer()
                Button {
                    addQueue.pendingReviewNotice = nil
                    showBatchReview = true
                } label: {
                    Text("Review")
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Color.white)
                        .foregroundStyle(Color(hex: "#ad1457"))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                Button { addQueue.pendingReviewNotice = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .bold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.9))
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .foregroundStyle(.white)
            .background(Color(hex: "#ff1493"))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.2), radius: 10, y: 4)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    /// Close the current game and either advance the routine (if one is
    /// running) or return the tablet to "listening" so the facilitator phone
    /// shows standby again.
    private func endGame() {
        let routineContinues = game.sessionDidEnd()
        if !routineContinues { live.setStandby() }
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

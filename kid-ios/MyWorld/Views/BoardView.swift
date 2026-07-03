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
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.verticalSizeClass) private var vSize

    @State private var showSettings = false
    @State private var showDisplay  = false
    @State private var editMode     = false
    @State private var showBatchReview = false
    @State private var pendingMessage: [MessageToken]?
    /// An in-grid "+ Add tile" tap; carries which section/folder to pre-select.
    @State private var addTileRequest: AddTileRequest?
    /// A tile tapped while the board is unlocked → opens the full board editor.
    @State private var editingTile: Tile?
    /// Listening mode — the mic-driven live word-board in the header.
    @State private var speech = SpeechListener()
    @State private var listening = false
    @State private var listenTimeout: Task<Void, Never>?
    /// Gate the empty-board welcome so it only appears AFTER the first server
    /// refresh (never flashes during the initial cold-launch paint).
    @State private var didInitialLoad = false
    /// Board-build progress ("Making Simon's words… 34 of 108") while the
    /// server-side seed jobs are still rendering. nil = not building.
    @State private var seedStatus: APIClient.SeedStatus?
    @State private var seedPollTask: Task<Void, Never>?

    struct AddTileRequest: Identifiable {
        let id = UUID()
        let section: BoardSection
        let categoryId: Int?
    }

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(editMode: $editMode,
                      showDisplay: $showDisplay,
                      showSettings: $showSettings,
                      listening: $listening,
                      speech: speech)

            // Edit mode on a PORTRAIT PHONE squishes the toolbar buttons into
            // unreadable stubs — tell the parent the easy fix instead of
            // letting them squint. (Portrait phone = compact width + regular
            // height; rotating to landscape clears the hint automatically.)
            if editMode && hSize == .compact && vSize == .regular {
                HStack(spacing: 8) {
                    Text("🔄")
                    Text("Turn the phone sideways for the full editing toolbar")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                }
                .foregroundStyle(Color(hex: "#9d2463"))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(Color(hex: "#fce4ec"))
            }

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
        .overlay { emptyBoardOverlay }
        .overlay(alignment: .top) { scheduledPromptOverlay }
        .overlay(alignment: .bottom) { reviewBanner }
        .overlay(alignment: .bottomLeading) { seedProgressPill }
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
                case .matching, .auditoryComprehension, .clueQuiz:
                    // Auditory Comprehension reuses MatchingView's lifecycle
                    // and choice grid; only the prompt source differs
                    // (description TTS vs. recorded label audio — handled
                    // inside MatchingView.announceTarget).
                    MatchingView(session: session) { endGame() }
                case .expressiveNaming:
                    ExpressiveNamingView(session: session) { endGame() }
                case .slideshow:
                    SlideshowView(session: session) { endGame() }
                case .teach:
                    TeachShowView(session: session) { endGame() }
                case .celebration:
                    CelebrationView { endGame() }
                }
            }
        }
        .task {
            prefs.attach(childId: auth.childSlug)
            await board.refresh(childId: auth.childSlug)
            didInitialLoad = true
            live.start(childId: auth.childSlug)
            scheduler.start(childId: auth.childSlug)
            autoTeach.start(childId: auth.childSlug)
            startSeedWatch()
        }
        .onDisappear {
            live.stop()
            scheduler.stop()
            autoTeach.stop()
            listenTimeout?.cancel()
            if listening { listening = false }
            speech.stop()
            seedPollTask?.cancel()
        }
        .refreshable {
            await board.refresh(childId: auth.childSlug)
            scheduler.refreshSchedules()
        }
        .onChange(of: live.latest) { _, cmd in
            guard let cmd else { return }
            // Listening mode can be toggled remotely from the parent app.
            if cmd.action == "listen-start" {
                listening = true
            } else if cmd.action == "listen-stop" {
                listening = false
            // PRD §4.7: a "message" command renders the parent's text as a
            // tile sequence. Doesn't go through GameController — it's an
            // overlay-only experience.
            } else if cmd.action == "message", let toks = cmd.tokens, !toks.isEmpty {
                pendingMessage = toks
            } else {
                game.apply(cmd)
            }
            live.acknowledge()
        }
        // Listening mode: start/stop the mic when toggled (by the header button
        // or a remote command), and auto-stop after 2 minutes of no speech.
        .onChange(of: listening) { _, on in
            listenTimeout?.cancel()
            if on {
                guard game.current == nil, pendingMessage == nil else { listening = false; return }
                speech.start()
                scheduleListenTimeout()
            } else {
                speech.stop()
            }
        }
        .onChange(of: speech.transcript) { _, t in
            if listening && !t.isEmpty { scheduleListenTimeout() }
        }
        // Pause the scheduler tick while a game / unlock / settings sheet is up
        // so a fired schedule doesn't try to stack a second sheet on top.
        .onChange(of: game.current) { _, c in scheduler.isBlocked = (c != nil) || showSettings || showDisplay }
        .onChange(of: showSettings) { _, on in scheduler.isBlocked = on || showDisplay || (game.current != nil) }
        .onChange(of: showDisplay)  { _, on in scheduler.isBlocked = on || showSettings || (game.current != nil) }
    }

    /// Brand-new board with no tiles yet → a friendly full-screen welcome that
    /// can build the starter set on the spot. Only after the first server refresh
    /// (so it never flashes over a board that's simply still loading) and never
    /// while the board is unlocked for editing.
    @ViewBuilder
    private var emptyBoardOverlay: some View {
        if didInitialLoad, board.tiles.isEmpty, !board.loading, !editMode {
            EmptyBoardView(possessive: childPossessive(auth.childSlug)) {
                Task { await board.refresh(childId: auth.childSlug) }
            }
            .transition(.opacity)
        }
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

    /// While the server-side seed jobs are still rendering this board's
    /// personalized words, show a soft pill and pull fresh tiles in as they
    /// land. Display-only — closing the app never stops the build.
    @ViewBuilder
    private var seedProgressPill: some View {
        if let s = seedStatus, s.active {
            let name = prettyChildName(auth.childSlug)
            let who = name.isEmpty ? "your" : "\(name)’s"
            let text = s.render.done < s.render.total
                ? "Making \(who) words… \(s.render.done) of \(s.render.total)"
                : "Adding \(who) voice… \(s.voice.done) of \(s.voice.total)"
            HStack(spacing: 8) {
                Circle().fill(Color(hex: "#ff1493")).frame(width: 9, height: 9)
                    .opacity(0.9)
                Text(text)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: "#9d2463"))
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(Capsule().fill(.white))
            .overlay(Capsule().stroke(Color(hex: "#f3c6dd"), lineWidth: 2))
            .shadow(color: .black.opacity(0.1), radius: 6, y: 2)
            .padding(.leading, 12).padding(.bottom, 10)
            .transition(.opacity)
        }
    }

    private func startSeedWatch() {
        seedPollTask?.cancel()
        seedPollTask = Task { @MainActor in
            var lastDone = -1
            while !Task.isCancelled {
                let s = await APIClient().seedStatus(childId: auth.childSlug)
                guard !Task.isCancelled else { return }
                seedStatus = s
                guard let s, s.active else {
                    // Finished (or nothing building): one last pull, then stop.
                    if lastDone > -1 { await board.refresh(childId: auth.childSlug) }
                    return
                }
                let done = s.render.done + s.voice.done
                if done != lastDone {
                    lastDone = done
                    await board.refresh(childId: auth.childSlug)   // finished tiles pop in
                }
                try? await Task.sleep(nanoseconds: 12_000_000_000)
            }
        }
    }

    /// Auto-stop Listening Mode after 2 minutes with no new speech. Each
    /// recognized phrase reschedules this (see `.onChange(of: speech.transcript)`).
    private func scheduleListenTimeout() {
        listenTimeout?.cancel()
        listenTimeout = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 120_000_000_000)
            if !Task.isCancelled && listening { listening = false }
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

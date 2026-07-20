import SwiftUI

/// The pink (configurable) header strip across the top of the board. Layout
/// mirrors the web app:
///
///   ┌─[🔒]─────[title centered]──────[🙋 Play with me]─┐
///                                      [+ edit toolbar when unlocked]
///
/// Long-press the lock to flip into edit mode (which reveals ⚙ Display +
/// Parent / Therapist external links). No password gate in v0 — the gesture
/// itself is the parent-only affordance.
struct HeaderBar: View {
    @Environment(AuthManager.self) private var auth
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(AddTileQueue.self) private var addQueue
    @Environment(DeviceMode.self) private var mode
    @Environment(BoardStore.self) private var board
    @Environment(GameController.self) private var game
    @Environment(SentenceBar.self) private var sentence
    @Environment(AccessPrefs.self) private var access

    @Binding var editMode: Bool
    @Binding var showDisplay: Bool
    @Binding var showSettings: Bool
    @Binding var listening: Bool
    let speech: SpeechListener
    @State private var showUnlock = false
    @State private var showAddTile = false
    @State private var showSttUpsell = false

    var title: String { worldTitle(auth.user?.slug) }
    private var hex: String { prefs.colorHeaderText }
    /// The bar's ONLY height driver: expanded while a strip owns the header.
    private var tall: Bool { listening || sentence.active }

    var body: some View {
        VStack(spacing: 0) {
            mainRow
            // Edit mode: the parent toolbar gets its own row under the title
            // row — the pills were crowding the title (and the iPad camera
            // strip) when they all shared one line. The pink background grows
            // with the header, so both rows read as one bar.
            if editMode && !listening && !sentence.active {
                HStack(spacing: 8) {
                    Spacer()
                    editToolbar
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 7)
            }
        }
        // ONE animation source per geometry change. This used to stack three
        // value-keyed animations (listening / sentence.active / editMode)
        // while mainRow's frame animated 104→48 off two of those values —
        // closing listening flips branch content AND height in the same
        // update, and the coalesced transitions could strand the rendered
        // frame at 104 ("the top bar stays fat" with the title showing).
        .animation(.easeInOut(duration: 0.2), value: tall)
        .animation(.easeInOut(duration: 0.2), value: editMode)
        .background(Color(hex: prefs.colorHeaderBg))
        // Drop-target glow while a lifted tile hovers over the bar.
        .overlay(Rectangle().stroke(Color(hex: "#66bb6a"),
                                    lineWidth: sentence.drag?.overHeader == true ? 4 : 0))
        .onTapGesture(count: 3) {
            // Hidden gesture: triple-tap the bar opens device settings (sign
            // out, clear cache, switch to parent app) — but ONLY while the
            // board is already unlocked. A tablet-fluent child could find an
            // unguarded triple-tap; the lock's password gate is the door.
            if editMode { showSettings = true }
        }
        .sheet(isPresented: $showUnlock) {
            UnlockSheet { editMode = true }
        }
        // Full-screen (not a form sheet) so the board + its header don't bleed
        // through behind the add UI on iPad.
        .fullScreenCover(isPresented: $showAddTile) {
            AddTileView { showAddTile = false }
        }
    }

    private var mainRow: some View {
        ZStack {
            // Centered content: the branded title, or — while listening — the
            // live one-tile-high strip that takes over the branding spot.
            if sentence.active {
                // Sentence constructor: while composing, the strip is the ONLY
                // header content — name, globe, and buttons all yield (the
                // background color stays). Emptying the strip restores them.
                SentenceStripView()
                    .padding(.horizontal, 8)
            } else if listening {
                ListenStripView(speech: speech)
                    .padding(.horizontal, 66)   // clear the side buttons
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "globe.americas.fill")
                        .foregroundStyle(Color(hex: hex))
                    Text(title)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: hex))
                }
            }

            if !sentence.active {
                HStack(spacing: 10) {
                    // While the listening strip owns the header, the lock hides
                    // too — only the stop button remains, with room to breathe,
                    // so the controls never crowd the live tiles.
                    if !listening { lockButton }
                    if access.toolListen {
                        listenButton
                            .padding(.trailing, listening ? 6 : 0)
                    }
                    // ✏️ Sentence mode: modal, owned here — while on, the board
                    // pages instead of scrolling and a TAP stages its tile.
                    if !listening && access.sentenceBuilder && access.toolSentence {
                        sentenceModeButton
                    }
                    Spacer()
                    trailingControls
                }
                .padding(.horizontal, 12)
            }
        }
        .frame(height: tall ? 104 : 48)
    }

    // MARK: -- Left: the lock icon
    //
    // Tap = no-op (kids can mash on it and nothing happens — there's no flash
    //   of UI, no animation, nothing to "discover").
    // Tap when unlocked = re-locks immediately (one-tap exit for the parent).
    // Long-press 0.7s = opens the password sheet → unlock on correct password.

    private var lockButton: some View {
        Button {
            if editMode { editMode = false }
        } label: {
            Image(systemName: editMode ? "lock.open.fill" : "lock.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color(hex: hex).opacity(editMode ? 1 : 0.55))
                .padding(8)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.7)
                .onEnded { _ in
                    guard !editMode else { return }
                    // Password-free unlock (synced safety setting): the parent
                    // proved ownership with their password when enabling it.
                    if TouchConfig.easyUnlock { editMode = true } else { showUnlock = true }
                }
        )
    }

    // MARK: -- Left (after lock): the mic toggle for Listening Mode
    //
    // Deliberately NOT behind edit mode — the child can turn listening on/off
    // himself, mirrored opposite the Play button. Flips `listening`; BoardView
    // owns the actual speech start/stop + the 2-minute timeout.

    private var listenButton: some View {
        Button {
            // Membership gate: speech-to-text is a paid feature. Show the
            // friendly join popup instead of a dead toggle (turning OFF is
            // always allowed).
            if !listening && !board.sttAllowed { showSttUpsell = true; return }
            if !listening { sentence.setMode(false) }   // listening owns the header
            listening.toggle()
        } label: {
            Image(systemName: listening ? "stop.circle.fill" : "mic.circle.fill")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(listening ? Color(hex: "#dc2626") : Color(hex: hex).opacity(0.9))
                .padding(6)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .alert("Speech-to-text is a membership feature", isPresented: $showSttUpsell) {
            Button("OK") {}
        } message: {
            Text("Turn spoken words into picture tiles in real time — part of every My World membership, from $9.99/month. Join in the parent app under Credits & Store. Everything you've already made stays yours forever.")
        }
    }

    // MARK: -- Right: Play with me + (edit-only) toolbar

    @ViewBuilder
    private var trailingControls: some View {
        HStack(spacing: 8) {
            // Hidden while the listening strip owns the header (mirrors the
            // web, which hides the play button in listening mode) — the wide
            // strip needs the room.
            if !listening {
                if access.toolTeach { teachMeButton }
                if access.toolPlay { playWithMeButton }
            }
        }
    }

    // The parent tools shown while unlocked — rendered on the header's second
    // row (see body) so they never fight the title for space.
    @ViewBuilder
    private var editToolbar: some View {
        // Adding tiles now happens from the dashed "+ Add tile" cells in
        // the board grid (discoverable, pre-set to the section you're
        // looking at). The header only surfaces a live render-status pill
        // while photos are still processing — tap it to open the tray and
        // watch progress / fix any that stumbled. Tiles finish + land on
        // the board even if this is dismissed.
        let rendering = addQueue.jobs.filter { $0.phase == .working }.count
        if rendering > 0 {
            pillButton("⏳ \(rendering) rendering") { showAddTile = true }
        }
        pillButton("⚙ Settings")  { showDisplay = true }
        // Switch THIS device to the native parent app. Lives in edit
        // mode (reached by long-pressing the lock) so it's discoverable
        // for a parent but unreachable for the child. The role persists,
        // so the device stays in parent mode until switched back.
        pillButton("🧑 Parent app") {
            editMode = false
            mode.role = .parent
        }
        if let slug = auth.user?.slug {
            pillLink(label: "🩺 Therapist",
                     url: URL(string: "https://aac.andrewpeterson.io/therapist/\(slug)")!)
        }
    }

    private var sentenceModeButton: some View {
        Button {
            sentence.setMode(!sentence.mode)
        } label: {
            Text("✏️")
                .font(.system(size: 15))
                .padding(6)
                .background(Circle().fill(sentence.mode ? Color(hex: "#66bb6a") : Color.white.opacity(0.18)))
        }
        .buttonStyle(.plain)
    }

    private var teachMeButton: some View {
        Button {
            startTeachShow()
        } label: {
            Text("📖 Teach me")
                .font(.system(size: 14, weight: .semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(Color(hex: hex))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var playWithMeButton: some View {
        Button {
            startSelfQuiz()
        } label: {
            Text("🙋 Play with me")
                .font(.system(size: 14, weight: .semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(Color(hex: hex))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func pillButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(Color(hex: hex))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func pillLink(label: String, url: URL) -> some View {
        Link(destination: url) {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(Color(hex: hex))
                .clipShape(Capsule())
        }
    }

    private func playableCount(_ scope: String) -> Int {
        board.tilesForScope(scope).filter { ($0.imageKey?.isEmpty == false) }.count
    }

    /// The last category/subcategory chip the child pressed (persisted per
    /// child), falling back to the whole board only when that scope has
    /// NOTHING playable (deleted category, fresh install). A short list stays
    /// a short list — thin categories must remain learnable, so the quiz pulls
    /// its distractors from the whole board instead of bailing out.
    private func lastScope() -> String {
        let scope = GameController.PlayScope.recall(slug: auth.childSlug) ?? "all"
        return playableCount(scope) > 0 ? scope : "all"
    }

    /// Self-learning quiz: up to 10 randomly sampled tiles from the last-pressed
    /// scope — fewer items just means a shorter quiz, never a scope switch.
    private func startSelfQuiz() {
        guard game.current == nil else { return }
        sentence.setMode(false)   // a game owns the stage — stop any sentence mid-speech
        game.startLocal(.matching, scope: lastScope(), sample: 10)
    }

    /// "Teach me": slideshow of the same last-pressed scope that speaks each
    /// word and then all of its taxonomy teaching clues. Capped at 12 —
    /// word + up to three facts each already makes 12 a solid session, and
    /// a container-folder scope must never become an hour-long show.
    private func startTeachShow() {
        guard game.current == nil else { return }
        sentence.setMode(false)
        game.startLocal(.teach, scope: lastScope(), sample: 12)
    }
}

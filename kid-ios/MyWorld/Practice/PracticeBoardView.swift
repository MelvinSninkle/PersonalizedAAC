import SwiftUI
import Combine
import AVFoundation

// MARK: -- Practice chrome (environment payload TileView reads)

/// Injected ONLY by PracticeBoardView. Its presence turns on the Label Lab
/// caption bands + the pink/violet tier rings and suppresses the under-tile
/// label inside TileView; every real board renders without it, untouched.
@Observable
final class PracticeChrome {
    /// Tile ids whose category is on the Label Lab skip list (alphabet,
    /// numbers, movie posters, clock faces — categories that ARE their label).
    var bandSkip: Set<Int> = []
}

/// The pre-login practice board — the first thing a brand-new install lands
/// on, and what a signed-out device returns to. It IS the child's board:
/// the real SectionColumn / NeedsStrip / TileView pipeline, the real game
/// modes (📖 Teach me, 🙋 Play with me), and real Listening Mode, rendering
/// the same public /api/demo starter projection the web practice page uses —
/// so a screen recording of this screen is a screen recording of the product.
///
/// The differences from a real board are exactly the practice affordances:
///   - a second header row with the Style / Meet / Voice filters, the
///     ✨ What's-personalized tour, and local-only tap counters
///   - "Register an Account" where the child's name would be
///   - the lock button opens the create-an-account pitch (editing, adding
///     your own pictures — that's what the account is for)
///
/// Tap audio plays the selected voice's PRE-RENDERED demo clips
/// (demo-audio/<voice>/<slug>.mp3 through /api/media's public prefix) as each
/// tile's soundKey — the normal TilePlayer path — with device speech as the
/// offline fallback. Never live TTS (standing practice-board rule).
struct PracticeBoardView: View {
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(OnboardingCoordinator.self) private var coord
    @Environment(GameController.self) private var game

    // MARK: payload (mirror of /api/demo)

    struct Payload: Decodable {
        struct DemoTile: Decodable {
            let label: String
            let section: String
            let category: String?
            let subcategory: String?
            let imageKey: String?
            let matchTerms: [String]?
            let descriptiveClues: [String]?
        }
        struct Folder: Decodable {
            let section: String?
            let label: String        // normalized lowercase (label_norm)
            let imageKey: String?
        }
        struct StyleOpt: Decodable, Hashable { let id: Int; let label: String }
        struct KidOpt: Decodable, Hashable { let id: Int; let label: String }
        struct VoiceOpt: Decodable, Hashable { let id: String; let name: String }
        let tiles: [DemoTile]
        let folders: [Folder]?
        let voices: [VoiceOpt]?
        let styles: [StyleOpt]?
        let kids: [KidOpt]?
        let listenBlocklist: [String]?
    }

    // MARK: state

    /// Practice content rides its OWN in-memory BoardStore, injected over the
    /// app-wide one for this subtree — SectionColumn, NeedsStrip, the games,
    /// and the listening strip all read it through the normal environment.
    @State private var store = BoardStore(hydrateFromDiskCache: false)
    @State private var chrome = PracticeChrome()
    /// Practice-local access prefs: the sentence constructor is ON here (the
    /// pencil + drag-to-bar), independent of any family's stored settings.
    /// AccessPrefs is a read-only holder — a fresh instance never persists.
    @State private var access: AccessPrefs = {
        let a = AccessPrefs()
        a.sentenceBuilder = true
        a.sentenceDrag = true
        return a
    }()
    /// Fresh sentence + navigation state so nothing bleeds between the
    /// practice screen and a family board on the same device.
    @State private var sentence = SentenceBar()
    @State private var boardNav = BoardNav()

    @State private var payload: Payload?
    @State private var styleId: Int?          // nil = Classic (generic starter art)
    @State private var kidId: Int?            // nil = the style's main demo kid
    /// nil = unchosen (defaults to the first real voice once loaded);
    /// "" = the parent explicitly picked the device's own voice.
    @State private var voiceId: String?
    @State private var loading = true
    @State private var errorText: String?

    /// The welcome tour — floats over the first load, reopenable from ✨.
    @State private var showTour = true
    @State private var showAccountPrompt = false
    /// Local-only stats, like the web page: nothing posts anywhere.
    @State private var taps = 0
    @State private var tappedWords: Set<String> = []

    // Listening Mode — the same wiring BoardView uses (mic → rolling strip).
    @State private var speech = SpeechListener()
    @State private var listening = false
    @State private var listenTimeout: Task<Void, Never>?

    @State private var samplePlayer: AVAudioPlayer?

    private let api = APIClient()

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            filterBar
            boardArea
        }
        .background(Color(hex: "#fff7fb"))
        .environment(store)      // practice content, NOT the family board
        .environment(chrome)
        .environment(access)
        .environment(sentence)
        .environment(boardNav)
        // Shared space for the sentence-lift gesture (same name the real
        // board uses): tiles report drag points here; the header drop zone
        // is y ≤ SentenceBar.dropZoneMaxY.
        .coordinateSpace(name: "board")
        // Floating copy of the tile while drag-staging (sentenceDrag).
        .overlay {
            if let d = sentence.drag {
                SentenceDragGhost(tile: d.tile).position(d.point)
            }
        }
        .overlay { loadStateOverlay }
        .overlay { tourOverlay }
        .task(id: "\(styleId ?? 0)|\(kidId ?? 0)") { await load() }
        // Practice touch defaults: tap-again-to-learn ON, utterances
        // NON-interruptible — the recommended child-board feel, demoed as
        // such. TouchConfig is app-global, but a family signing in re-reads
        // their own settings (AccessPrefs.refresh) which overwrites these.
        .onAppear {
            TouchConfig.doubleTapTeach = true
            TouchConfig.interrupt = false
            TouchConfig.teachTapMs = 2000
        }
        // The real game covers — Teach me and Play with me present the same
        // views a child's board presents.
        .fullScreenCover(item: gameSessionBinding) { session in
            Group {
                switch session.mode {
                case .matching, .auditoryComprehension, .clueQuiz:
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
        // Listening Mode lifecycle — mirrors BoardView: start/stop with the
        // toggle, auto-stop after 2 minutes of silence.
        .onChange(of: listening) { _, on in
            listenTimeout?.cancel()
            if on {
                guard game.current == nil else { listening = false; return }
                speech.start()
                scheduleListenTimeout()
            } else {
                speech.stop()
            }
        }
        .onChange(of: speech.transcript) { _, t in
            if listening && !t.isEmpty { scheduleListenTimeout() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .myWorldTileSpoken)) { note in
            taps += 1
            if let label = note.userInfo?["label"] as? String {
                tappedWords.insert(label.lowercased())
            }
        }
        .onDisappear {
            listenTimeout?.cancel()
            if listening { listening = false }
            speech.stop()
            samplePlayer?.stop()
        }
        .sheet(isPresented: $showAccountPrompt) { accountPromptSheet }
    }

    // MARK: -- Row 1: the real board header, practice edition
    //
    // Lock · mic — [Register an Account in the child-name slot] — Teach · Play

    private var tall: Bool { listening || sentence.active }

    private var headerBar: some View {
        ZStack {
            if sentence.active {
                // Sentence constructor: while composing, the strip is the
                // ONLY header content — same rule as the real board.
                SentenceStripView()
                    .padding(.horizontal, 8)
            } else if listening {
                ListenStripView(speech: speech)
                    .padding(.horizontal, 66)   // clear the side buttons
            } else {
                Button {
                    register()
                } label: {
                    Text("Register an Account")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .lineLimit(1)
                        .padding(.horizontal, 16).padding(.vertical, 7)
                        .background(Color.white, in: Capsule())
                        .foregroundStyle(Color(hex: Brand.pinkDeep))
                        .shadow(color: .black.opacity(0.15), radius: 3, y: 1)
                }
                .buttonStyle(.plain)
            }

            if !sentence.active {
                HStack(spacing: 10) {
                    if !listening { lockButton }
                    listenButton
                        .padding(.trailing, listening ? 6 : 0)
                    // ✏️ Sentence mode — modal, like the real board: while on,
                    // a TAP stages its tile; ▶ in the strip speaks the sentence.
                    if !listening { sentenceModeButton }
                    Spacer()
                    if !listening {
                        teachMeButton
                        playWithMeButton
                    }
                }
                .padding(.horizontal, 12)
            }
        }
        .frame(height: tall ? 104 : 48)
        .animation(.easeInOut(duration: 0.2), value: tall)
        .background(Color(hex: Brand.pink))
        // Drop-target glow while a lifted tile hovers over the bar.
        .overlay(Rectangle().stroke(Color(hex: "#66bb6a"),
                                    lineWidth: sentence.drag?.overHeader == true ? 4 : 0))
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

    /// The lock a real board carries. Here, unlocking IS the pitch: editing
    /// and adding your own pictures is what the account unlocks.
    private var lockButton: some View {
        Button {
            showAccountPrompt = true
        } label: {
            Image(systemName: "lock.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.55))
                .padding(8)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var listenButton: some View {
        Button {
            listening.toggle()
        } label: {
            Image(systemName: listening ? "stop.circle.fill" : "mic.circle.fill")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(listening ? Color(hex: "#dc2626") : Color.white.opacity(0.9))
                .padding(6)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var teachMeButton: some View {
        Button {
            guard game.current == nil, !store.tiles.isEmpty else { return }
            game.startLocal(.teach, scope: "all", sample: 10)
        } label: {
            Text("📖 Teach me")
                .font(.system(size: 14, weight: .semibold))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(.white)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var playWithMeButton: some View {
        Button {
            guard game.current == nil, !store.tiles.isEmpty else { return }
            game.startLocal(.matching, scope: "all", sample: 10)
        } label: {
            Text("🙋 Play with me")
                .font(.system(size: 14, weight: .semibold))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(.white)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func endGame() {
        // Pre-login there is no live channel to reset — just close the session.
        game.sessionDidEnd()
    }

    private var gameSessionBinding: Binding<GameController.Session?> {
        Binding(
            get: { game.current },
            set: { newValue in if newValue == nil { game.stop() } }
        )
    }

    private func scheduleListenTimeout() {
        listenTimeout?.cancel()
        listenTimeout = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 120_000_000_000)
            if !Task.isCancelled && listening { listening = false }
        }
    }

    // MARK: -- Row 2: the practice filters

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                styleMenu
                kidMenu
                voiceMenu
                tourButton
                counters
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        }
        .background(Color(hex: Brand.bg))
        .overlay(alignment: .bottom) { Divider() }
    }

    private var styleMenu: some View {
        Menu {
            Button {
                kidId = nil; styleId = nil
            } label: {
                if styleId == nil { Label("Classic", systemImage: "checkmark") } else { Text("Classic") }
            }
            ForEach(payload?.styles ?? [], id: \.id) { s in
                Button {
                    kidId = nil; styleId = s.id
                } label: {
                    if styleId == s.id { Label(s.label, systemImage: "checkmark") } else { Text(s.label) }
                }
            }
        } label: {
            filterPill(icon: "paintpalette.fill", title: "Style", value: currentStyleLabel)
        }
    }

    /// The "Meet" filter — who the demo board is about. Visible whenever a
    /// style is active (extra kids appear as styles finish rendering them).
    @ViewBuilder
    private var kidMenu: some View {
        if styleId != nil {
            Menu {
                Button {
                    kidId = nil
                } label: {
                    if kidId == nil { Label("Our demo kid", systemImage: "checkmark") } else { Text("Our demo kid") }
                }
                ForEach(payload?.kids ?? [], id: \.id) { k in
                    Button {
                        kidId = k.id
                    } label: {
                        if kidId == k.id { Label(k.label, systemImage: "checkmark") } else { Text(k.label) }
                    }
                }
                if (payload?.kids ?? []).isEmpty {
                    Divider()
                    Text("More demo kids are on the way for this style")
                }
            } label: {
                filterPill(icon: "figure.child", title: "Meet", value: currentKidLabel)
            }
        }
    }

    private var voiceMenu: some View {
        Menu {
            ForEach(payload?.voices ?? [], id: \.id) { v in
                Button {
                    voiceId = v.id
                    rebuildTiles()
                    playVoiceSample()
                } label: {
                    if effectiveVoiceId == v.id { Label(v.name, systemImage: "checkmark") } else { Text(v.name) }
                }
            }
            Button {
                voiceId = ""
                rebuildTiles()
            } label: {
                if effectiveVoiceId == "" { Label("Device voice", systemImage: "checkmark") } else { Text("Device voice") }
            }
        } label: {
            filterPill(icon: "speaker.wave.2.fill", title: "Voice", value: currentVoiceName)
        }
    }

    private var tourButton: some View {
        Button {
            showTour = true
        } label: {
            HStack(spacing: 5) {
                Text("✨")
                Text("What's personalized?")
                    .font(.system(size: 13, weight: .semibold))
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Color.white, in: Capsule())
            .foregroundStyle(Color(hex: "#6d28d9"))
            .overlay(Capsule().strokeBorder(Color(hex: "#7c3aed").opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var counters: some View {
        HStack(spacing: 10) {
            counter("Taps this visit", taps)
            counter("Different words", tappedWords.count)
        }
        .padding(.leading, 4)
    }

    private func counter(_ label: String, _ value: Int) -> some View {
        HStack(spacing: 5) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.muted))
            Text("\(value)")
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
        }
    }

    private func filterPill(icon: String, title: String, value: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.pink))
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.muted))
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.ink))
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Color(hex: Brand.faint))
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(Color.white, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.black.opacity(0.08), lineWidth: 1))
    }

    private var currentStyleLabel: String {
        guard let id = styleId else { return "Classic" }
        return payload?.styles?.first { $0.id == id }?.label ?? "Classic"
    }
    private var currentKidLabel: String {
        guard let id = kidId else { return "Our demo kid" }
        return payload?.kids?.first { $0.id == id }?.label ?? "Our demo kid"
    }
    private var currentVoiceName: String {
        if effectiveVoiceId == "" { return "Device voice" }
        return payload?.voices?.first { $0.id == effectiveVoiceId }?.name ?? "—"
    }
    /// A warm human voice IS the demo, so the first real voice is the default;
    /// "" is an explicit device-voice pick and is never overridden.
    private var effectiveVoiceId: String? {
        if let voiceId { return voiceId }
        return payload?.voices?.first?.id
    }

    // MARK: -- The board itself — the REAL board's layout math + components

    private var boardArea: some View {
        GeometryReader { geo in
            let tile = computeLayout(in: geo.size.width)
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    let visible = visibleColumns
                    ForEach(Array(visible.enumerated()), id: \.element) { idx, section in
                        SectionColumn(section: section, tileSize: tile)
                            .frame(width: BoardMetrics.columnWidth(across: prefs.across(section),
                                                                   tile: tile))
                        if idx < visible.count - 1 { Divider() }
                    }
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

    private var visibleColumns: [BoardSection] {
        [.people, .nouns, .verbs].filter { prefs.show($0) }
    }

    private func computeLayout(in width: CGFloat) -> CGFloat {
        let visible = visibleColumns
        let n = visible.count
        guard n > 0, width > 0 else { return BoardMetrics.minTile }
        let totalAcross = visible.reduce(0) { $0 + prefs.across($1) }
        guard totalAcross > 0 else { return BoardMetrics.minTile }
        let chromeWidth = visible.reduce(CGFloat(0)) { acc, s in
            let a = prefs.across(s)
            return acc + 2 * BoardMetrics.columnPad + CGFloat(a - 1) * BoardMetrics.tileGap
        } + CGFloat(n - 1) * BoardMetrics.dividerWidth
        let availForTiles = max(0, width - chromeWidth)
        let idealTile = width / BoardMetrics.referenceAcross
        let fitTile = availForTiles / CGFloat(totalAcross)
        return max(BoardMetrics.minTile, min(idealTile, fitTile))
    }

    // MARK: -- Data: /api/demo → real Category/Tile models

    private func load() async {
        loading = true
        errorText = nil
        defer { loading = false }
        var path = "/api/demo"
        var q: [String] = []
        if let styleId { q.append("style=\(styleId)") }
        if let kidId { q.append("kid=\(kidId)") }
        if !q.isEmpty { path += "?" + q.joined(separator: "&") }
        do {
            let (data, _) = try await api.request(method: "GET", path: path, body: nil)
            let p = try JSONDecoder().decode(Payload.self, from: data)
            if p.tiles.isEmpty && payload != nil { return }   // keep the board we have
            payload = p
            if p.tiles.isEmpty {
                errorText = "The practice board isn't available right now, but the real thing is — tap Register an Account above!"
            }
            rebuildTiles()
        } catch {
            if payload == nil {
                errorText = "Couldn't load the practice board. Check the connection and try again."
            }
        }
    }

    /// The Label Lab band skip list — categories that ARE their own label.
    private static let bandSkipNames: Set<String> =
        ["alphabet", "letters", "numbers", "movies & shows", "movies", "shows", "clock", "time"]

    /// Convert the demo payload into REAL Category/Tile models inside the
    /// practice BoardStore. Both models decode themselves (their memberwise
    /// inits are suppressed by custom Decodable), so the conversion builds
    /// the same JSON /api/sync would send and decodes it — zero drift.
    private func rebuildTiles() {
        guard let p = payload else { return }
        let vid = effectiveVoiceId ?? ""
        var cats: [[String: Any]] = []
        var items: [[String: Any]] = []
        var catIds: [String: Int] = [:]
        var nextCat = 1
        var nextItem = 1000
        var bandSkip: Set<Int> = []

        func folderIcon(section: String, name: String) -> String? {
            let n = name.lowercased()
            let fs = p.folders ?? []
            return (fs.first { $0.label == n && ($0.section == nil || $0.section == section) }
                    ?? fs.first { $0.label == n })?.imageKey
        }
        func ensureCat(section: String, cat: String, sub: String) -> Int {
            let topKey = "\(section)|\(cat.lowercased())|"
            var topId = catIds[topKey]
            if topId == nil {
                topId = nextCat; nextCat += 1
                catIds[topKey] = topId
                var c: [String: Any] = ["id": topId!, "section": section, "label": cat,
                                        "order": topId!]
                if let ik = folderIcon(section: section, name: cat) { c["imageKey"] = ik }
                cats.append(c)
            }
            guard !sub.isEmpty else { return topId! }
            let subKey = "\(section)|\(cat.lowercased())|\(sub.lowercased())"
            var subId = catIds[subKey]
            if subId == nil {
                subId = nextCat; nextCat += 1
                catIds[subKey] = subId
                var c: [String: Any] = ["id": subId!, "section": section, "label": sub,
                                        "parentId": topId!, "order": subId!]
                if let ik = folderIcon(section: section, name: sub) { c["imageKey"] = ik }
                cats.append(c)
            }
            return subId!
        }

        for t in p.tiles {
            let section = t.section.lowercased()
            guard ["people", "nouns", "verbs", "needs"].contains(section) else { continue }
            let id = nextItem; nextItem += 1
            var item: [String: Any] = ["id": id, "section": section, "label": t.label, "order": id]
            if section != "needs" {
                let cat = (t.category ?? "").trimmingCharacters(in: .whitespaces)
                let sub = (t.subcategory ?? "").trimmingCharacters(in: .whitespaces)
                item["categoryId"] = ensureCat(section: section,
                                               cat: cat.isEmpty ? "More" : cat, sub: sub)
                if Self.bandSkipNames.contains(cat.lowercased())
                    || Self.bandSkipNames.contains(sub.lowercased()) {
                    bandSkip.insert(id)
                }
            }
            if let ik = t.imageKey, !ik.isEmpty { item["imageKey"] = ik }
            // The selected demo voice's pre-rendered clip IS the tile's sound
            // — TilePlayer plays it via the public media prefix, exactly like
            // a real tile's recorded audio. Device voice → no key → speech.
            if !vid.isEmpty {
                item["soundKey"] = "demo-audio/\(vid)/\(Self.demoSlug(t.label)).mp3"
            }
            if let mt = t.matchTerms, !mt.isEmpty { item["matchTerms"] = mt }
            // Tap-again-to-learn: the same taxonomy teaching facts real
            // boards speak (practice defaults doubleTapTeach ON).
            if let dc = t.descriptiveClues, !dc.isEmpty { item["descriptiveClues"] = dc }
            items.append(item)
        }

        do {
            let json = try JSONSerialization.data(withJSONObject: ["categories": cats, "items": items])
            let resp = try JSONDecoder().decode(APIClient.SyncResponse.self, from: json)
            store.categories = resp.categories
            store.tiles = resp.items
            store.listenBlocklist = Set((p.listenBlocklist ?? []).map { $0.lowercased() })
            chrome.bandSkip = bandSkip
        } catch {
            errorText = "Couldn't prepare the practice board."
        }
    }

    // MARK: -- Actions

    private func register() {
        carrySelections()
        coord.accountPrefersSignup = true
        coord.go(to: .account)
    }

    /// The style/voice tried here pre-select the same pickers in onboarding.
    private func carrySelections() {
        if let sid = styleId, let s = payload?.styles?.first(where: { $0.id == sid }) {
            coord.styleGuideId = s.id
            coord.styleLabel = s.label
        }
        if let vid = effectiveVoiceId, !vid.isEmpty,
           let v = payload?.voices?.first(where: { $0.id == vid }) {
            coord.voiceId = v.id
            coord.voiceName = v.name
        }
    }

    /// Switching voices plays that voice's pre-rendered introduction clip.
    /// Clip missing → stay silent; the next tile tap demonstrates the voice.
    private func playVoiceSample() {
        guard let vid = effectiveVoiceId, !vid.isEmpty else { return }
        let key = "demo-audio/\(vid)/voice-sample.mp3"
        Task {
            guard let data = try? await MediaCache.shared.data(for: key) else { return }
            await MainActor.run {
                samplePlayer = try? AVAudioPlayer(data: data)
                samplePlayer?.play()
            }
        }
    }

    /// Mirror of the practice page's clip slug — must stay in lockstep with
    /// DemoBoardView.demoSlug / the Lab's clip builder.
    static func demoSlug(_ s: String) -> String {
        let lowered = s.lowercased()
        var out = ""
        var lastDash = true
        for ch in lowered {
            if ch.isLetter || ch.isNumber, ch.isASCII {
                out.append(ch)
                lastDash = false
            } else if !lastDash {
                out.append("-")
                lastDash = true
            }
        }
        if out.hasSuffix("-") { out.removeLast() }
        return out
    }

    // MARK: -- Account prompt (the lock button's pitch)

    private var accountPromptSheet: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.open.fill")
                .font(.system(size: 34))
                .foregroundStyle(Color(hex: Brand.pink))
                .padding(.top, 26)
            Text("Unlocking is where it becomes your child's")
                .font(.system(size: 21, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.ink))
                .multilineTextAlignment(.center)
            Text("On a real board, the lock opens editing: add tiles from your own photos, rename and re-voice words, and organize folders. That all comes with your account — free to create.")
                .font(.system(size: 14))
                .foregroundStyle(Color(hex: Brand.muted))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                showAccountPrompt = false
                register()
            } label: {
                Text("Register an Account")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(Color(hex: Brand.pink), in: RoundedRectangle(cornerRadius: 999))
                    .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            Button("Keep exploring") { showAccountPrompt = false }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
                .buttonStyle(.plain)
            Spacer()
        }
        .padding(24)
        .presentationDetents([.medium])
    }

    // MARK: -- Load / error state

    @ViewBuilder
    private var loadStateOverlay: some View {
        if store.tiles.isEmpty {
            if loading {
                VStack(spacing: 12) {
                    ProgressView().tint(Color(hex: Brand.pink)).scaleEffect(1.4)
                    Text("Setting up the practice board…")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color(hex: Brand.pinkDeep))
                }
            } else if let err = errorText {
                VStack(spacing: 12) {
                    Text(err)
                        .font(.system(size: 14))
                        .foregroundStyle(Color(hex: Brand.muted))
                        .multilineTextAlignment(.center)
                    Button("Try again") { Task { await load() } }
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .background(Color(hex: Brand.pink), in: Capsule())
                        .foregroundStyle(.white)
                }
                .padding(24)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 20))
                .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
                .padding(40)
            }
        }
    }

    // MARK: -- Welcome tour (floats over the first load; reopenable via ✨)

    @ViewBuilder
    private var tourOverlay: some View {
        if showTour {
            ZStack {
                Color.black.opacity(0.35).ignoresSafeArea()
                    .onTapGesture { showTour = false }
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("👋 This is the board. Here's what becomes your child's")
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(hex: Brand.ink))
                            .fixedSize(horizontal: false, vertical: true)

                        tourRow(swatch: Color(hex: "#ff1493"),
                                bold: "Pink ring: My World Plus ($9.99/mo).",
                                body: "The heart of the board becomes theirs: your child and family drawn into the art, and the everyday actions and needs starring them.")
                        tourRow(swatch: Color(hex: "#7c3aed"),
                                bold: "Violet ring: My World Pro ($19.99/mo).",
                                body: "Their whole world: every food, toy, animal, and thing in Nouns redrawn as their actual stuff, in their style.")
                        tourRow(emoji: "📷",
                                bold: "Always free:",
                                body: "unlimited tiles from your exact photos, the whole starter board, games, and the sentence builder.")
                        tourRow(emoji: "🤝",
                                bold: "Try it with a safety net:",
                                body: "joining builds the full board up front, and if you cancel, everything you've made stays yours, forever.")

                        Text("Things to try right now: pick an art style and voice up top, tap 🎙 and just talk — words you say light up as tiles — and press 📖 Teach me or 🙋 Play with me for the learning games. Every tap speaks. Go ahead.")
                            .font(.system(size: 13))
                            .foregroundStyle(Color(hex: Brand.muted))
                            .fixedSize(horizontal: false, vertical: true)

                        Button {
                            showTour = false
                            register()
                        } label: {
                            Text("Register an Account")
                                .font(.system(size: 17, weight: .bold, design: .rounded))
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .background(Color(hex: Brand.pink), in: RoundedRectangle(cornerRadius: 999))
                                .foregroundStyle(.white)
                        }
                        .buttonStyle(.plain)

                        HStack {
                            Button {
                                showTour = false
                                coord.accountPrefersSignup = false
                                coord.go(to: .account)
                            } label: {
                                (Text("Already have a board? ") + Text("Log in").bold().underline())
                                    .font(.system(size: 13))
                                    .foregroundStyle(Color(hex: Brand.pinkDeep))
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            Button("Explore the board") { showTour = false }
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                .foregroundStyle(Color(hex: Brand.pinkDeep))
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(22)
                }
                .frame(maxWidth: 460, maxHeight: 560)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 24))
                .shadow(color: .black.opacity(0.2), radius: 24, y: 10)
                .padding(24)
            }
        }
    }

    private func tourRow(swatch: Color? = nil, emoji: String? = nil, bold: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if let swatch {
                RoundedRectangle(cornerRadius: 5)
                    .fill(swatch)
                    .frame(width: 16, height: 16)
                    .padding(.top, 2)
            } else if let emoji {
                Text(emoji).font(.system(size: 15))
            }
            (Text(bold).bold() + Text(" " + body))
                .font(.system(size: 13.5))
                .foregroundStyle(Color(hex: Brand.ink))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

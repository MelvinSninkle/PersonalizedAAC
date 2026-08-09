import SwiftUI
import AVFoundation

/// The onboarding practice board — the first thing a brand-new install lands
/// on, and what a signed-out device returns to, so a new family can register
/// from any device. The native twin of the web's /practice page: it renders
/// the same PUBLIC starter-board projection (GET /api/demo — live-fetched,
/// never a bundled fixture) with the same one-strip toolbar of filters:
///
///   Style   — Classic + every published style (per-style pre-rendered art)
///   Meet    — the style's demo kids; person tiles re-render for the pick
///   Voice   — pre-built demo clips (demo-audio/<voice>/<slug>.mp3); the
///             device voice is the offline fallback, never live TTS
///
/// Where the child's name sits on a real board, this header carries a
/// persistent "Register an Account" button; a welcome tour floats over the
/// first load explaining the pink/violet personalization rings (same honest
/// tier framing as the web page), and local-only tap counters give a taste
/// of the real product's tracking. Style + voice choices carry into the
/// onboarding pickers when the parent registers.
struct PracticeBoardView: View {
    @Environment(OnboardingCoordinator.self) private var coord
    @Environment(\.horizontalSizeClass) private var hSize

    // MARK: payload (mirror of /api/demo)

    struct Payload: Decodable {
        struct DemoTile: Decodable {
            let label: String
            let section: String
            let category: String?
            let subcategory: String?
            let imageKey: String?
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
    }

    // MARK: state

    @State private var payload: Payload?
    @State private var styleId: Int?          // nil = Classic (generic starter art)
    @State private var kidId: Int?            // nil = the style's main demo kid
    /// nil = unchosen (defaults to the first real voice once loaded);
    /// "" = the parent explicitly picked the device's own voice.
    @State private var voiceId: String?
    @State private var loading = true
    @State private var errorText: String?
    /// The welcome tour — floats over the first load (register CTA + what the
    /// rings mean + things to try), reopenable from ✨ What's personalized?.
    @State private var showTour = true
    /// Local-only stats, like the web page: nothing posts anywhere.
    @State private var taps = 0
    @State private var tappedWords: Set<String> = []
    /// Per-section chip selection (category / subcategory labels).
    @State private var selCat: [String: String] = [:]
    @State private var selSub: [String: String] = [:]
    /// Phone layout: one section at a time (mirrors the web's <700px tabs).
    @State private var phoneTab: String = "nouns"
    @State private var player: AVAudioPlayer?

    private let api = APIClient()
    /// Static so a mid-utterance view re-render can't deallocate the
    /// synthesizer and clip the word.
    private static let speech = AVSpeechSynthesizer()
    /// The real board's default tiles-across, per section (web ACROSS).
    private let across: [String: Int] = ["people": 2, "nouns": 5, "verbs": 2]

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            filterBar
            content
        }
        .background(Color(hex: "#ffffff"))
        .overlay { tourOverlay }
        .task(id: "\(styleId ?? 0)|\(kidId ?? 0)") { await load() }
    }

    // MARK: -- Row 1: brand · REGISTER (the child-name slot) · log in

    private var headerBar: some View {
        ZStack {
            // Center: where a real board shows "{Name}'s World" — here it's
            // the persistent register button.
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

            HStack(spacing: 8) {
                Image(systemName: "globe.americas.fill")
                    .foregroundStyle(.white)
                if hSize != .compact {
                    Text("My World · Try the board")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                Spacer()
                Button {
                    logIn()
                } label: {
                    Text("Log in")
                        .font(.system(size: 13, weight: .semibold))
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(Color.white.opacity(0.18), in: Capsule())
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
        }
        .frame(height: 48)
        .background(Color(hex: Brand.pink))
    }

    // MARK: -- Row 2: the practice filters (style · meet · voice · ✨ · stats)

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

    /// The "Meet" filter — who the demo board is about. Always visible while
    /// a style is active (the web hides it until a style has extra kids,
    /// which made it undiscoverable): with no alternates yet it still shows
    /// "Our demo kid" so the concept reads, and extra kids appear as styles
    /// finish rendering them.
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
                    playVoiceSample()
                } label: {
                    if effectiveVoiceId == v.id { Label(v.name, systemImage: "checkmark") } else { Text(v.name) }
                }
            }
            Button {
                voiceId = ""
                speakLocal("Hello!")
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
    /// Web parity: a warm human voice IS the demo, so the first real voice is
    /// the default; "" is an explicit device-voice pick and is never overridden.
    private var effectiveVoiceId: String? {
        if let voiceId { return voiceId }
        return payload?.voices?.first?.id
    }

    // MARK: -- Board content

    @ViewBuilder
    private var content: some View {
        if loading && payload == nil {
            Spacer()
            ProgressView("Loading the board…")
                .tint(Color(hex: Brand.pink))
            Spacer()
        } else if let err = errorText, payload == nil {
            Spacer()
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
            .padding(30)
            Spacer()
        } else if let p = payload {
            boardBody(p)
        }
    }

    private func boardBody(_ p: Payload) -> some View {
        VStack(spacing: 0) {
            if hSize == .compact { phoneTabs }
            HStack(alignment: .top, spacing: 0) {
                ForEach(visibleSections, id: \.self) { section in
                    sectionColumn(section, in: p)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxHeight: .infinity)
            needsStrip(p)
        }
    }

    /// iPad: the three columns side by side. iPhone: one at a time via tabs.
    private var visibleSections: [String] {
        hSize == .compact ? [phoneTab] : ["people", "nouns", "verbs"]
    }

    private var phoneTabs: some View {
        HStack(spacing: 8) {
            ForEach(["people", "nouns", "verbs"], id: \.self) { s in
                Button {
                    phoneTab = s
                } label: {
                    Text(s.capitalized)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(phoneTab == s ? Color(hex: Brand.pink) : Color.white, in: Capsule())
                        .foregroundStyle(phoneTab == s ? .white : Color(hex: Brand.pinkDeep))
                        .overlay(Capsule().strokeBorder(Color(hex: Brand.line), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Color(hex: Brand.bg))
    }

    private func tiles(_ p: Payload, in section: String) -> [Payload.DemoTile] {
        p.tiles.filter { $0.section == section }
    }

    private func folderIcon(_ p: Payload, section: String, name: String) -> String? {
        let n = name.lowercased()
        let fs = p.folders ?? []
        return (fs.first { $0.label == n && ($0.section == nil || $0.section == section) }
                ?? fs.first { $0.label == n })?.imageKey
    }

    private func sectionColumn(_ section: String, in p: Payload) -> some View {
        let all = tiles(p, in: section)
        let cats = uniqued(all.compactMap { $0.category }.filter { !$0.isEmpty })
        let cat = selCat[section].flatMap { cats.contains($0) ? $0 : nil } ?? cats.first ?? ""
        let inCat = all.filter { ($0.category ?? "") == cat }
        let subs = uniqued(inCat.compactMap { $0.subcategory }.filter { !$0.isEmpty })
        let sub = selSub[section].flatMap { subs.contains($0) ? $0 : nil } ?? subs.first ?? ""
        let shown = Array(inCat.filter { sub.isEmpty || ($0.subcategory ?? "") == sub }.prefix(80))

        return VStack(spacing: 0) {
            Text(section.capitalized)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10).padding(.vertical, 5)

            if cats.count > 1 {
                chipStrip(cats, active: cat, p: p, section: section) { picked in
                    selCat[section] = picked
                    selSub[section] = nil
                }
            }
            if subs.count > 1 {
                chipStrip(subs, active: sub, p: p, section: section) { picked in
                    selSub[section] = picked
                }
            }

            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8),
                                         count: max(1, across[section] ?? 3)),
                          spacing: 8) {
                    ForEach(Array(shown.enumerated()), id: \.offset) { _, t in
                        practiceTile(t, section: section)
                    }
                }
                .padding(8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color.white)
        .overlay(alignment: .trailing) {
            if hSize != .compact { Rectangle().frame(width: 1).foregroundStyle(.black.opacity(0.06)) }
        }
    }

    private func uniqued(_ xs: [String]) -> [String] {
        var seen = Set<String>(); var out: [String] = []
        for x in xs where seen.insert(x).inserted { out.append(x) }
        return out
    }

    private func chipStrip(_ names: [String], active: String, p: Payload, section: String,
                           onPick: @escaping (String) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(names, id: \.self) { name in
                    Button {
                        onPick(name)
                    } label: {
                        VStack(spacing: 2) {
                            PracticeTileImage(imageKey: folderIcon(p, section: section, name: name), corner: 10)
                                .frame(width: 44, height: 44)
                            Text(name)
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Color(hex: Brand.ink))
                                .lineLimit(1)
                                .frame(maxWidth: 60)
                        }
                        .padding(4)
                        .background(name == active ? Color(hex: Brand.line) : .clear,
                                    in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(name == active ? Color(hex: Brand.pink) : Color.black.opacity(0.08),
                                          lineWidth: name == active ? 2 : 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
        }
    }

    private func needsStrip(_ p: Payload) -> some View {
        let ts = Array(tiles(p, in: "needs").prefix(24))
        return Group {
            if !ts.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(ts.enumerated()), id: \.offset) { _, t in
                            practiceTile(t, section: "needs")
                                .frame(width: 96)
                        }
                    }
                    .padding(8)
                }
                .background(Color(hex: Brand.bg))
                .overlay(alignment: .top) { Divider() }
            }
        }
    }

    // MARK: -- One tile (always ringed — the ring IS the personalization story)

    /// Web parity: Nouns (the big vocabulary of THEIR things) carries the
    /// violet Pro ring; everything else personalizable fits the pink Plus
    /// ring. Framed as "comfortably personalizes each month", never a gate.
    private func ringColor(_ section: String) -> Color {
        section == "nouns" ? Color(hex: "#7c3aed").opacity(0.45)
                           : Color(hex: "#ff1493").opacity(0.5)
    }

    private func practiceTile(_ t: Payload.DemoTile, section: String) -> some View {
        Button {
            speak(t.label)
        } label: {
            VStack(spacing: 4) {
                PracticeTileImage(imageKey: t.imageKey, corner: 14)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(ringColor(section), lineWidth: 2.5))
                Text(t.label)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.ink))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(5)
            .background(.white, in: RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.07), radius: 3, y: 1)
        }
        .buttonStyle(TileButtonStyle())
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

                        Text("Things to try right now: pick an art style and voice up top, meet the demo kids, and tap anything — every tap speaks. Go ahead.")
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
                                logIn()
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

    // MARK: -- Actions

    private func register() {
        carrySelections()
        coord.accountPrefersSignup = true
        coord.go(to: .account)
    }

    private func logIn() {
        coord.accountPrefersSignup = false
        coord.go(to: .account)
    }

    /// The style + voice tried here pre-select the same pickers on the Child
    /// step, so "I liked Watercolor in Grace's voice" survives registration.
    /// (Style ids ARE style_guides ids; demo voice ids ARE the catalog's
    /// ElevenLabs ids — both pickers match on id.)
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

    // MARK: -- Data + audio

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
        } catch {
            if payload == nil {
                errorText = "Couldn't load the practice board. Check the connection and try again."
            }
        }
    }

    /// Local-only stats — a taste of the real product's tracking; nothing posts.
    private func noteTap(_ label: String) {
        taps += 1
        tappedWords.insert(label.lowercased())
    }

    /// Tap-to-speak, web parity: the selected voice's PRE-RENDERED clip
    /// (served through /api/media's public demo-audio/ prefix and cached by
    /// MediaCache), falling back to the device voice — never live TTS.
    private func speak(_ label: String) {
        noteTap(label)
        guard let vid = effectiveVoiceId, !vid.isEmpty else {
            speakLocal(label)
            return
        }
        let key = "demo-audio/\(vid)/\(Self.demoSlug(label)).mp3"
        Task {
            if let data = try? await MediaCache.shared.data(for: key) {
                await MainActor.run {
                    player = try? AVAudioPlayer(data: data)
                    player?.play()
                }
            } else {
                await MainActor.run { speakLocal(label) }
            }
        }
    }

    /// Switching voices plays that voice's pre-rendered introduction clip
    /// (the same sample onboarding uses). Clip missing → stay silent; the
    /// next tile tap demonstrates the voice anyway.
    private func playVoiceSample() {
        guard let vid = effectiveVoiceId, !vid.isEmpty else { return }
        let key = "demo-audio/\(vid)/voice-sample.mp3"
        Task {
            guard let data = try? await MediaCache.shared.data(for: key) else { return }
            await MainActor.run {
                player = try? AVAudioPlayer(data: data)
                player?.play()
            }
        }
    }

    private func speakLocal(_ text: String) {
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "en-US")
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        Self.speech.stopSpeaking(at: .immediate)
        Self.speech.speak(u)
    }

    /// Mirror of the practice page's clip slug: lowercase, runs of
    /// non-alphanumerics collapse to "-", trimmed at both ends. Must stay in
    /// lockstep with DemoBoardView.demoSlug / the Lab's clip builder.
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
}

/// Async tile/chip art loader on the shared MediaCache (decoded at display
/// size, C7). Gray placeholder while loading; word-tile styling is not needed
/// here because /api/demo only ships rows that HAVE art.
private struct PracticeTileImage: View {
    let imageKey: String?
    var corner: CGFloat = 14
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: corner).fill(Color(hex: "#e9eef5"))
            if let img = image ?? MediaCache.decodedImage(for: imageKey, maxPixel: 640) {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: corner))
        .task(id: imageKey) {
            guard let key = imageKey, !key.isEmpty else { image = nil; return }
            if MediaCache.decodedImage(for: key, maxPixel: 640) != nil { return }
            image = await MediaCache.shared.image(for: key, maxPixel: 640)
        }
    }
}

import SwiftUI

/// PRD §4.4 — pick a game, configure it, launch it on the iPad. Every option
/// the backend's live channel supports is exposed here (mode / scope / range
/// / sample / choices / time limit / slideshow pacing / first-person framing
/// / music override). Once the game starts, ParentLive flips isRunning and
/// the FacilitatorView pops automatically over the whole parent app — this
/// screen's only job is the SETUP phase.
struct StartGameView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(BoardStore.self)  private var board
    @Environment(ParentLive.self)  private var live

    private let api = APIClient()

    enum GameMode: String, CaseIterable, Identifiable {
        // Names match the backend's GameController dispatch (see iPad's
        // Live/GameController.swift `parseMode`). Each is a real iPad game.
        case matching, teach_slideshow, learn_slideshow, exposure_slideshow, clue_quiz, auditory_comprehension, expressive_naming, celebration
        var id: String { rawValue }
        var label: String {
            switch self {
            case .matching:               return "Matching"
            case .teach_slideshow:        return "Teach me (word + clues)"
            case .learn_slideshow:        return "Learn slideshow"
            case .exposure_slideshow:     return "Exposure slideshow"
            case .clue_quiz:              return "Clue quiz"
            case .auditory_comprehension: return "Listening (auditory)"
            case .expressive_naming:      return "Expressive naming"
            case .celebration:            return "Celebration"
            }
        }
        var blurb: String {
            switch self {
            case .matching:               return "Hear a word, tap the matching picture. No wrong-answer sounds, ever."
            case .teach_slideshow:        return "Each picture shows with its word: spoken, then every teaching clue read aloud. Watch-and-listen; advances when the speech finishes."
            case .learn_slideshow:        return "Calm watch-and-listen flashcards (\"This is a dog.\")."
            case .exposure_slideshow:     return "Same pacing, first-person framing (\"This is your dog.\") for self-modeling."
            case .clue_quiz:              return "Hear a teaching clue, tap the picture it describes. Each miss reveals another clue."
            case .auditory_comprehension: return "Hear a clue (\"lives in a field, eats grass\"), find the tile it describes."
            case .expressive_naming:      return "The child sees a picture and names what they see."
            case .celebration:            return "Flowers and cheers. Celebrate a moment."
            }
        }
        var usesChoices: Bool { self == .matching || self == .auditory_comprehension || self == .clue_quiz }
        var isSlideshow:  Bool { self == .learn_slideshow || self == .exposure_slideshow }
    }

    // Backend-supported settings, all on this one screen.
    @State private var mode: GameMode = .matching
    @State private var scope = "all"
    @State private var rangeFrom = ""
    @State private var rangeTo = ""
    @State private var sample = 5            // 0 = use all in order
    @State private var choices = 3
    @State private var limitMin = 0          // 0 = no limit
    @State private var secondsPerImage = 4   // slideshow only
    @State private var labelStyle = "plain"  // "plain" | "first_person" — exposed for matching/slideshow
    @State private var musicOverride: String? = nil   // path, e.g. "/audio/color-tap-learn.mp3"

    @State private var sendState: SendState = .idle
    enum SendState: Equatable { case idle, sending, sent, failed(String) }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                tabletPill
                modeCard
                scopeCard
                settingsCard
                if mode.isSlideshow { slideshowCard }
                startButton
                if case .failed(let why) = sendState {
                    Text("Could not start: \(why)")
                        .font(.footnote).foregroundStyle(.red)
                } else if sendState == .sent {
                    Text("Sent. The facilitator screen will open the moment the iPad starts.")
                        .font(.footnote).foregroundStyle(Color(hex: Brand.muted))
                }
            }
            .padding(16)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Start a game")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: -- Cards

    private var tabletPill: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(live.tabletOnline ? Color(hex: Brand.good) : Color(hex: Brand.faint))
                .frame(width: 10, height: 10)
            Text(live.tabletOnline ? "Tablet connected" : "Waiting for tablet…")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.ink))
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(
            live.tabletOnline ? Color(hex: Brand.goodBg) : Color(hex: Brand.card),
            in: RoundedRectangle(cornerRadius: 14)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(live.tabletOnline ? Color(hex: Brand.goodLine) : Color(hex: Brand.line),
                        lineWidth: 1)
        )
    }

    private var modeCard: some View {
        cardSection(label: "GAME") {
            menuRow(title: "Mode", value: mode.label) {
                ForEach(GameMode.allCases) { m in
                    Button(m.label) { mode = m }
                }
            }
            Text(mode.blurb)
                .font(.footnote)
                .foregroundStyle(Color(hex: Brand.muted))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var scopeCard: some View {
        cardSection(label: "WORDS") {
            menuRow(title: "Practice", value: scopeLabel) {
                Section("Sections") {
                    Button("Everything") { scope = "all" }
                    Button("People")     { scope = "people" }
                    Button("Nouns")      { scope = "nouns" }
                    Button("Verbs")      { scope = "verbs" }
                    Button("Needs")      { scope = "needs" }
                }
                Section("Categories") {
                    ForEach(rootCategories, id: \.id) { c in
                        Button("\(c.section.label): \(c.label)") { scope = "cat:\(c.id)" }
                    }
                }
            }
            if scope != "all" {
                rangeRow
            }
        }
    }

    private var rangeRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Limit to a range (optional)")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.ink))
            HStack {
                TextField("from #", text: $rangeFrom)
                    .keyboardType(.numberPad)
                    .padding(10)
                    .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 10))
                Text("to").foregroundStyle(Color(hex: Brand.muted))
                TextField("to #", text: $rangeTo)
                    .keyboardType(.numberPad)
                    .padding(10)
                    .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private var settingsCard: some View {
        cardSection(label: "ROUND") {
            menuRow(title: "Pick a few at random", value: sampleLabel) {
                Button("All, in order")  { sample = 0 }
                Button("3 random")       { sample = 3 }
                Button("5 random")       { sample = 5 }
                Button("8 random")       { sample = 8 }
                Button("10 random")      { sample = 10 }
            }
            if mode.usesChoices {
                stepperRow(title: "Choices on screen", value: $choices, range: 2...4)
            }
            menuRow(title: "Time limit", value: limitLabel) {
                Button("No limit")  { limitMin = 0 }
                Button("1 minute")  { limitMin = 1 }
                Button("2 minutes") { limitMin = 2 }
                Button("3 minutes") { limitMin = 3 }
                Button("4 minutes") { limitMin = 4 }
            }
        }
    }

    private var slideshowCard: some View {
        cardSection(label: "SLIDESHOW") {
            stepperRow(title: "Seconds per image", value: $secondsPerImage, range: 2...10)
            menuRow(title: "Label style", value: labelStyle == "first_person" ? "First person (\"This is your…\")" : "Plain (\"This is a…\")") {
                Button("Plain")        { labelStyle = "plain" }
                Button("First person") { labelStyle = "first_person" }
            }
            menuRow(title: "Background music", value: musicLabel) {
                Button("Default")              { musicOverride = nil }
                Button("Color tap (calm)")     { musicOverride = "/audio/color-tap-learn.mp3" }
                Button("Silence")              { musicOverride = "" }
            }
        }
    }

    private var startButton: some View {
        Button { Task { await start() } } label: {
            HStack(spacing: 8) {
                if sendState == .sending {
                    ProgressView().tint(.white)
                }
                Text(sendState == .sending ? "Starting…" : "Start on the iPad")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color(hex: Brand.pink), in: RoundedRectangle(cornerRadius: 999))
            .foregroundStyle(.white)
            .shadow(color: Color(hex: Brand.pink).opacity(0.35), radius: 8, y: 3)
        }
        .disabled(sendState == .sending || !live.tabletOnline)
        .padding(.top, 4)
    }

    // MARK: -- Reusable card primitives — keep visual rhythm consistent

    private func cardSection<C: View>(label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(Color(hex: Brand.pink))
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func menuRow<M: View>(title: String, value: String, @ViewBuilder menu: () -> M) -> some View {
        Menu {
            menu()
        } label: {
            HStack {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: Brand.ink))
                Spacer()
                Text(value)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: Brand.pinkDeep))
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11))
                    .foregroundStyle(Color(hex: Brand.pinkDeep))
            }
            .padding(12)
            .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func stepperRow(title: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.ink))
            Spacer()
            Stepper("\(value.wrappedValue)", value: value, in: range)
                .labelsHidden()
            Text("\(value.wrappedValue)")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
                .frame(minWidth: 32, alignment: .trailing)
        }
        .padding(12)
        .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: -- Computed labels

    private var rootCategories: [Category] {
        BoardSection.allCases.flatMap { board.roots(in: $0) }
    }

    private var scopeLabel: String {
        switch scope {
        case "all":    return "Everything"
        case "people": return "People"
        case "nouns":  return "Nouns"
        case "verbs":  return "Verbs"
        case "needs":  return "Needs"
        default:
            if scope.hasPrefix("cat:"),
               let id = Int(scope.dropFirst(4)),
               let c = rootCategories.first(where: { $0.id == id }) {
                return c.label
            }
            return "Category"
        }
    }
    private var sampleLabel: String { sample == 0 ? "All, in order" : "\(sample) random" }
    private var limitLabel: String  { limitMin == 0 ? "No limit" : "\(limitMin) min" }
    private var musicLabel: String {
        switch musicOverride {
        case nil:                          return "Default"
        case .some(""):                    return "Silence"
        case .some(let p) where p.contains("color-tap-learn"): return "Color tap (calm)"
        case .some(let p):                 return p
        }
    }

    // MARK: -- Start

    private func start() async {
        sendState = .sending
        var cmd: [String: Any] = [
            "action": "start",
            "mode":   mode.rawValue,
            "scope":  scope,
        ]
        if mode.usesChoices { cmd["choices"] = choices }
        if scope != "all" {
            if let f = Int(rangeFrom) { cmd["from"] = f }
            if let t = Int(rangeTo)   { cmd["to"]   = t }
        }
        if sample > 0   { cmd["sample"]   = sample }
        if limitMin > 0 { cmd["limitMin"] = limitMin }
        if mode.isSlideshow {
            cmd["secondsPerImage"] = secondsPerImage
            cmd["labelStyle"]      = labelStyle
            if let m = musicOverride { cmd["music"] = m }
        }
        do {
            try await api.publishLiveCommand(childId: auth.childSlug, cmd)
            sendState = .sent
        } catch {
            sendState = .failed(error.localizedDescription)
        }
    }
}

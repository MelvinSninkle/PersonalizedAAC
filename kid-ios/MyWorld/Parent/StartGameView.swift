import SwiftUI

/// PRD §4.4 + parity with the web therapist console. Two phases on one screen:
///
///   • SET UP  — pick a game mode, scope, sample size, choices, time limit;
///                tap Start to launch on the child's iPad.
///   • RUNNING — live mirror of the iPad: the current target tile + correct
///                count + 'mark' buttons (Tapped / Said / Object) + Skip /
///                Next / End. Mirrors therapist.html's facilitator marks so
///                a verbal or physical response can be counted just like a tap.
///
/// Both phases share one live poll (~1.5s — same cadence as web therapist).
struct StartGameView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(BoardStore.self)  private var board

    private let api = APIClient()

    enum GameMode: String, CaseIterable, Identifiable {
        case matching, slideshow, auditory_comprehension, expressive_naming, celebration
        var id: String { rawValue }
        var label: String {
            switch self {
            case .matching:               return "Matching"
            case .slideshow:              return "Slideshow"
            case .auditory_comprehension: return "Listening (auditory)"
            case .expressive_naming:      return "Expressive naming"
            case .celebration:            return "Celebration"
            }
        }
        var blurb: String {
            switch self {
            case .matching:               return "Hear a word, tap the matching picture. No wrong-answer sounds — ever."
            case .slideshow:              return "Calm watch-and-listen flashcards."
            case .auditory_comprehension: return "Hear a clue (\"lives in a field, eats grass\"), find the tile it describes."
            case .expressive_naming:      return "The child sees a picture and names what they see."
            case .celebration:            return "Flowers and cheers — celebrate a moment."
            }
        }
        var usesChoices: Bool { self == .matching || self == .auditory_comprehension }
    }

    // Setup state
    @State private var mode: GameMode = .matching
    @State private var scope = "all"
    @State private var rangeFrom = ""
    @State private var rangeTo = ""
    @State private var sample = 5         // 0 = use all in order
    @State private var choices = 3
    @State private var limitMin = 0       // 0 = no limit

    // Live state
    @State private var status: LiveStatus?
    @State private var sendState: SendState = .idle
    @State private var pollTask: Task<Void, Never>?
    enum SendState: Equatable { case idle, sending, sent, failed(String) }

    // A running session is one whose published status is 'running' AND whose
    // heartbeat is recent enough that the tablet is still alive.
    private var isRunning: Bool { status?.status == "running" && (status?.age ?? 99) < 8 }
    private var tabletOnline: Bool { (status?.age ?? 99) < 8 && status?.status != "idle" }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                tabletPill
                if isRunning {
                    livePanel
                } else {
                    setupPanel
                }
            }
            .padding(16)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle("Start a game")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            pollTask = Task { await pollLoop() }
        }
        .onDisappear { pollTask?.cancel() }
    }

    // MARK: -- Tablet presence pill

    private var tabletPill: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(tabletOnline ? Color(hex: "#16a34a") : Color(hex: "#9ca3af"))
                .frame(width: 10, height: 10)
            Text(tabletOnline ? "Tablet connected" : "Waiting for tablet…")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Color(hex: "#1f2937"))
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.white, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
    }

    // MARK: -- Setup phase

    private var setupPanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            // Mode
            sectionHeader("Game")
            modePicker
            Text(mode.blurb)
                .font(.footnote).foregroundStyle(Color(hex: "#6b7280"))

            // Scope
            sectionHeader("Words")
            scopePicker

            // Optional from/to range (web parity: only when scope is specific)
            if scope != "all" {
                rangeRow
            }

            // Sample, Choices, Limit
            settingRow(
                title: "Pick a few at random",
                trailing: AnyView(
                    Picker("", selection: $sample) {
                        Text("All, in order").tag(0)
                        Text("3 random").tag(3)
                        Text("5 random").tag(5)
                        Text("8 random").tag(8)
                        Text("10 random").tag(10)
                    }
                    .pickerStyle(.menu)
                    .tint(Color(hex: "#ad1457"))
                )
            )
            if mode.usesChoices {
                settingRow(
                    title: "Choices on screen",
                    trailing: AnyView(
                        Stepper("\(choices)", value: $choices, in: 2...4)
                            .labelsHidden()
                    )
                )
            }
            settingRow(
                title: "Time limit",
                trailing: AnyView(
                    Picker("", selection: $limitMin) {
                        Text("No limit").tag(0)
                        Text("1 minute").tag(1)
                        Text("2 minutes").tag(2)
                        Text("3 minutes").tag(3)
                        Text("4 minutes").tag(4)
                    }
                    .pickerStyle(.menu)
                    .tint(Color(hex: "#ad1457"))
                )
            )

            // Start button
            Button { Task { await start() } } label: {
                HStack(spacing: 8) {
                    if sendState == .sending { ProgressView().tint(.white) }
                    Text(sendState == .sending ? "Starting…" : "Start on the iPad")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color(hex: "#ff1493"), in: RoundedRectangle(cornerRadius: 999))
                .foregroundStyle(.white)
            }
            .disabled(sendState == .sending || !tabletOnline)

            if case .failed(let why) = sendState {
                Text("Could not start: \(why)").font(.footnote).foregroundStyle(.red)
            } else if sendState == .sent {
                Text("Sent — the game should start on the iPad in a moment.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(.white, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
    }

    private var modePicker: some View {
        Menu {
            ForEach(GameMode.allCases) { m in
                Button(m.label) { mode = m }
            }
        } label: {
            HStack {
                Text("Mode").font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: "#374151"))
                Spacer()
                Text(mode.label).font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: "#ad1457"))
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11)).foregroundStyle(Color(hex: "#ad1457"))
            }
            .padding(12)
            .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var scopePicker: some View {
        Menu {
            Section("Sections") {
                Button("Everything") { scope = "all" }
                Button("People")     { scope = "people" }
                Button("Nouns")      { scope = "nouns" }
                Button("Verbs")      { scope = "verbs" }
                Button("Needs")      { scope = "needs" }
            }
            Section("Categories") {
                ForEach(rootCategories, id: \.id) { c in
                    Button("\(c.section.label) — \(c.label)") { scope = "cat:\(c.id)" }
                }
            }
        } label: {
            HStack {
                Text("Practice").font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: "#374151"))
                Spacer()
                Text(scopeLabel).font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: "#ad1457"))
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11)).foregroundStyle(Color(hex: "#ad1457"))
            }
            .padding(12)
            .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var rangeRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Limit to a range (optional)")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(hex: "#374151"))
            HStack {
                TextField("from #", text: $rangeFrom)
                    .keyboardType(.numberPad)
                    .padding(10)
                    .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 10))
                Text("to").foregroundStyle(.secondary)
                TextField("to #", text: $rangeTo)
                    .keyboardType(.numberPad)
                    .padding(10)
                    .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func sectionHeader(_ t: String) -> some View {
        Text(t.uppercased())
            .font(.system(size: 11, weight: .bold))
            .tracking(0.5)
            .foregroundStyle(Color(hex: "#9d174d"))
    }

    private func settingRow(title: String, trailing: AnyView) -> some View {
        HStack {
            Text(title).font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(hex: "#374151"))
            Spacer()
            trailing
        }
        .padding(12)
        .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: -- Running phase — facilitator controls + live progress

    private var livePanel: some View {
        VStack(spacing: 14) {
            // Live target card.
            VStack(spacing: 8) {
                Text("Now on screen")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(Color(hex: "#9d174d"))
                if let target = livePayload?.target {
                    targetCard(target)
                } else {
                    Text("Waiting for the iPad to show a tile…")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                progressLine
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(.white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#f3c6da"), lineWidth: 1))

            // Mark buttons — facilitator counts a non-tap response as correct.
            VStack(spacing: 10) {
                sectionHeader("Mark this round")
                HStack(spacing: 10) {
                    markButton(method: "tap",    icon: "hand.tap.fill",       label: "Tapped it",    tint: "#1d4ed8")
                    markButton(method: "verbal", icon: "mouth.fill",          label: "Said it",      tint: "#047857")
                    markButton(method: "object", icon: "teddybear.fill",      label: "Showed object",tint: "#6d28d9")
                }
                HStack(spacing: 10) {
                    controlButton(action: "skip", label: "Skip",    tint: "#9d174d")
                    controlButton(action: "next", label: "Next →",  tint: "#4338ca")
                }
            }
            .padding(16)
            .background(.white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#f3c6da"), lineWidth: 1))

            Button("End the activity", role: .destructive) {
                Task { try? await api.publishLiveCommand(childId: auth.childSlug, ["action": "end"]) }
            }
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color(hex: "#fff0f6"), in: RoundedRectangle(cornerRadius: 999))
            .foregroundStyle(Color(hex: "#ad1457"))
        }
    }

    private func targetCard(_ target: LivePayload.Target) -> some View {
        HStack(spacing: 14) {
            if let key = target.imageKey {
                MediaImage(blobKey: key)
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            } else {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(hex: "#fce4ec"))
                    .frame(width: 84, height: 84)
                    .overlay(Text("🎯").font(.system(size: 32)))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(target.label)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#1f2937"))
                Text(status?.status == "ended" ? "finished 🎉" : "on screen now")
                    .font(.footnote)
                    .foregroundStyle(Color(hex: "#6b7280"))
            }
            Spacer()
        }
    }

    private var progressLine: some View {
        let i = (livePayload?.i ?? 0) + 1
        let total = livePayload?.total ?? 0
        let correct = livePayload?.correctCount ?? 0
        return Text("Item \(i) of \(total) · \(correct) correct")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color(hex: "#374151"))
    }

    private func markButton(method: String, icon: String, label: String, tint: String) -> some View {
        Button {
            Task { try? await api.publishLiveCommand(childId: auth.childSlug, ["action": "mark", "method": method]) }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 22))
                Text(label).font(.system(size: 12, weight: .semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(Color(hex: tint).opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(Color(hex: tint))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: tint).opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func controlButton(action: String, label: String, tint: String) -> some View {
        Button {
            Task { try? await api.publishLiveCommand(childId: auth.childSlug, ["action": action]) }
        } label: {
            Text(label)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Color(hex: tint).opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(Color(hex: tint))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: tint).opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: -- helpers

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
            if let id = Int(scope.dropFirst(4)), scope.hasPrefix("cat:"),
               let c = rootCategories.first(where: { $0.id == id }) {
                return c.label
            }
            return "Category"
        }
    }

    private var livePayload: LivePayload? { status?.payload }

    private func start() async {
        sendState = .sending
        var cmd: [String: Any] = ["action": "start",
                                   "mode": mode.rawValue,
                                   "scope": scope,
                                   "choices": choices]
        if scope != "all" {
            if let f = Int(rangeFrom) { cmd["from"] = f }
            if let t = Int(rangeTo)   { cmd["to"] = t }
        }
        if sample > 0   { cmd["sample"]   = sample }
        if limitMin > 0 { cmd["limitMin"] = limitMin }
        do {
            try await api.publishLiveCommand(childId: auth.childSlug, cmd)
            sendState = .sent
        } catch {
            sendState = .failed(error.localizedDescription)
        }
    }

    private func pollLoop() async {
        // 1.5s — same cadence as the web therapist console.
        while !Task.isCancelled {
            if let s = try? await api.live(childId: auth.childSlug) {
                await MainActor.run { self.status = s }
            }
            try? await Task.sleep(for: .seconds(1.5))
        }
    }
}

import SwiftUI

/// PRD §4.4 — launch and control games on the child's iPad from the phone.
/// Publishes the same `start` command the web therapist console emits; the
/// iPad's LiveSession poller picks it up within a second or two. The "is the
/// tablet there?" indicator reads the live status the iPad heartbeats back.
struct StartGameView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(BoardStore.self)  private var board

    private let api = APIClient()

    enum GameMode: String, CaseIterable, Identifiable {
        case matching, slideshow, auditory, expressive
        var id: String { rawValue }
        var label: String {
            switch self {
            case .matching:   return "Matching"
            case .slideshow:  return "Slideshow"
            case .auditory:   return "Listening (auditory)"
            case .expressive: return "Expressive"
            }
        }
        var blurb: String {
            switch self {
            case .matching:   return "Hear a word, tap the matching picture. No wrong-answer sounds — ever."
            case .slideshow:  return "Calm watch-and-listen flashcards."
            case .auditory:   return "Hear a clue, find the tile it describes."
            case .expressive: return "The child names what they see."
            }
        }
    }

    @State private var mode: GameMode = .matching
    @State private var scope = "all"
    @State private var choices = 3
    @State private var tabletStatus: String = "checking…"
    @State private var sendState: SendState = .idle
    enum SendState: Equatable { case idle, sending, sent, failed(String) }

    var body: some View {
        Form {
            Section {
                HStack {
                    Circle()
                        .fill(tabletOnline ? Color(hex: "#16a34a") : Color(hex: "#9ca3af"))
                        .frame(width: 10, height: 10)
                    Text(tabletOnline ? "Tablet connected" : "Tablet: \(tabletStatus)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Game") {
                Picker("Mode", selection: $mode) {
                    ForEach(GameMode.allCases) { m in Text(m.label).tag(m) }
                }
                Text(mode.blurb).font(.footnote).foregroundStyle(.secondary)
            }

            Section("Words") {
                Picker("Practice", selection: $scope) {
                    Text("Everything").tag("all")
                    Text("People").tag("people")
                    Text("Nouns").tag("nouns")
                    Text("Verbs").tag("verbs")
                    ForEach(rootCategories, id: \.id) { c in
                        Text("\(c.section.label) — \(c.label)").tag("cat:\(c.id)")
                    }
                }
                if mode == .matching || mode == .auditory {
                    Stepper("Choices on screen: \(choices)", value: $choices, in: 2...4)
                }
            }

            Section {
                Button {
                    Task { await start() }
                } label: {
                    HStack {
                        if sendState == .sending { ProgressView() }
                        Text(buttonLabel).bold()
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(sendState == .sending)

                Button("End the current activity", role: .destructive) {
                    Task { try? await api.publishLiveCommand(childId: auth.childSlug, ["action": "end"]) }
                }
            } footer: {
                if case .failed(let why) = sendState {
                    Text("Could not start: \(why)").foregroundStyle(.red)
                } else if sendState == .sent {
                    Text("Sent — the game starts on the iPad in a moment.")
                }
            }
        }
        .navigationTitle("Start a game")
        .navigationBarTitleDisplayMode(.inline)
        .task { await pollTablet() }
    }

    private var rootCategories: [Category] {
        BoardSection.allCases.flatMap { board.roots(in: $0) }
    }

    private var tabletOnline: Bool { tabletStatus != "checking…" && tabletStatus != "offline" }

    private var buttonLabel: String {
        switch sendState {
        case .sending: return "Starting…"
        case .sent:    return "Start again"
        default:        return "Start on the iPad"
        }
    }

    private func start() async {
        sendState = .sending
        do {
            var cmd: [String: Any] = ["action": "start", "mode": mode.rawValue, "scope": scope]
            if mode == .matching || mode == .auditory { cmd["choices"] = choices }
            try await api.publishLiveCommand(childId: auth.childSlug, cmd)
            sendState = .sent
        } catch {
            sendState = .failed(error.localizedDescription)
        }
    }

    /// One status read on appear + a slow refresh loop while the screen is up.
    /// The iPad heartbeats its state every ~3s; status age tells us liveness.
    private func pollTablet() async {
        while !Task.isCancelled {
            if let s = try? await api.live(childId: auth.childSlug) {
                if let age = s.age, age < 12 { tabletStatus = s.status }
                else { tabletStatus = "offline" }
            } else {
                tabletStatus = "offline"
            }
            try? await Task.sleep(for: .seconds(4))
        }
    }
}

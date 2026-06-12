import SwiftUI

/// The parent app home screen (PRD §4.1). A grid of clearly-labeled entry
/// points, each opening its own focused screen. Built for a parent out in the
/// world — a museum, a restaurant — who wants to act fast: every action is at
/// most one tap from here. Phone-first; the grid relaxes to more columns on
/// iPad via adaptive columns rather than separate layouts.
struct ParentHomeView: View {
    @Environment(AuthManager.self)  private var auth
    @Environment(BoardStore.self)   private var board
    @Environment(DeviceMode.self)   private var mode
    @Environment(AddTileQueue.self) private var addQueue

    @State private var showAddTile  = false
    @State private var showQuickBoard = false
    @State private var showSettings = false

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 14)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header

                    LazyVGrid(columns: columns, spacing: 14) {
                        homeCard(icon: "camera.fill", tint: "#ff1493",
                                 title: "Add a tile",
                                 subtitle: "Snap it, it's on the board") { showAddTile = true }

                        homeCard(icon: "square.grid.3x3.fill", tint: "#7c3aed",
                                 title: "Quick board",
                                 subtitle: "The child can talk on this device") { showQuickBoard = true }

                        navCard(icon: "gamecontroller.fill", tint: "#0ea5e9",
                                title: "Start a game",
                                subtitle: "Runs on the child's iPad") { StartGameView() }

                        navCard(icon: "text.bubble.fill", tint: "#16a34a",
                                title: "Message the board",
                                subtitle: "Your words as their tiles") { MessageBoardView() }

                        navCard(icon: "chart.bar.fill", tint: "#f59e0b",
                                title: "Stats",
                                subtitle: "Progress & mastery") { StatsView() }

                        navCard(icon: "clock.fill", tint: "#db2777",
                                title: "Schedules",
                                subtitle: "Prompts & reminders") { SchedulesView() }

                        navCard(icon: "photo.on.rectangle.angled", tint: "#9d174d",
                                title: "Album",
                                subtitle: "Every picture, every year") { AlbumView() }
                    }

                    if addQueue.hasActiveJobs {
                        Label("Tiles are rendering — they'll land on the board on their own.",
                              systemImage: "hourglass")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(16)
            }
            .background(Color(hex: "#fff7fb"))
            .navigationTitle("\(prettyChildName(auth.user?.slug))'s World")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape.fill") }
                }
            }
            .fullScreenCover(isPresented: $showAddTile) {
                AddTileView { showAddTile = false }
            }
            .fullScreenCover(isPresented: $showQuickBoard) {
                QuickBoardView { showQuickBoard = false }
            }
            .sheet(isPresented: $showSettings) {
                ParentSettingsView()
            }
            .task {
                // Hydrate the board once so Quick Board / game scopes / message
                // previews have data without each screen re-syncing.
                await board.refresh(childId: auth.childSlug)
            }
        }
    }

    private var header: some View {
        Text("What do you want to do?")
            .font(.system(size: 16, weight: .medium, design: .rounded))
            .foregroundStyle(.secondary)
    }

    private func homeCard(icon: String, tint: String, title: String, subtitle: String,
                          action: @escaping () -> Void) -> some View {
        Button(action: action) { cardLabel(icon: icon, tint: tint, title: title, subtitle: subtitle) }
            .buttonStyle(.plain)
    }

    private func navCard<D: View>(icon: String, tint: String, title: String, subtitle: String,
                                  @ViewBuilder destination: @escaping () -> D) -> some View {
        NavigationLink { destination() } label: { cardLabel(icon: icon, tint: tint, title: title, subtitle: subtitle) }
            .buttonStyle(.plain)
    }

    private func cardLabel(icon: String, tint: String, title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 26))
                .foregroundStyle(Color(hex: tint))
            Text(title)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(.primary)
            Text(subtitle)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
    }
}

/// Parent-side settings: vocabulary level (band + unlock), device mode switch,
/// account actions. The deep configuration (organize board, style guides…)
/// stays on the web dashboard by design.
struct ParentSettingsView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(DeviceMode.self)  private var mode
    @Environment(\.dismiss) private var dismiss

    @State private var band: APIClient.BandStatus?
    @State private var advancing = false
    @State private var advanceMsg: String?

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            Form {
                Section("Vocabulary level") {
                    if let b = band {
                        LabeledContent("Showing", value: bandLabel(b.current))
                        if let next = b.next {
                            if let m = b.mastery, b.readyToAdvance == true {
                                Text("\(m.correct) of \(m.total) recent answers correct — looks ready to grow.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Button(advancing ? "Unlocking…" : "Unlock \(bandLabel(next))") {
                                Task {
                                    advancing = true
                                    defer { advancing = false }
                                    do { try await api.advanceBand(childId: auth.childSlug); band = try? await api.bandStatus(childId: auth.childSlug); advanceMsg = "Unlocked." }
                                    catch { advanceMsg = "Could not unlock: \(error.localizedDescription)" }
                                }
                            }
                            .disabled(advancing)
                        } else {
                            Text("Top vocabulary band reached.").font(.footnote).foregroundStyle(.secondary)
                        }
                        if let msg = advanceMsg { Text(msg).font(.footnote).foregroundStyle(.secondary) }
                    } else {
                        Text("Loading…").foregroundStyle(.secondary)
                    }
                }
                Section("This device") {
                    Button {
                        mode.role = .childBoard
                        dismiss()
                    } label: {
                        Label("Use as the child's board", systemImage: "hand.tap.fill")
                    }
                    Link(destination: webDashboardURL) {
                        Label("Full dashboard on the web", systemImage: "safari")
                    }
                }
                Section("Account") {
                    if let u = auth.user { LabeledContent("Email", value: u.email) }
                    Button("Sign out", role: .destructive) {
                        Task { await auth.signOut(); dismiss() }
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .task { band = try? await api.bandStatus(childId: auth.childSlug) }
        }
    }

    private var webDashboardURL: URL {
        URL(string: "\(APIClient.defaultOrigin)/parent/\(auth.user?.slug ?? auth.childSlug)")!
    }
}

/// Human label for an acquisition-age band id. Shared by settings + stats.
func bandLabel(_ band: String?) -> String {
    switch band {
    case "12-18m": return "12–18 months · first words"
    case "18-30m": return "18–30 months · vocabulary burst"
    case "2-3y":   return "2–3 years · sentences"
    case "3-4y":   return "3–4 years · grammar"
    case "4y+":    return "4 years and up"
    default:        return "every band"
    }
}

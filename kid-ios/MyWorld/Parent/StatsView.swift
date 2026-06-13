import SwiftUI

/// PRD §4.5 — one clean place for progress. v1 renders the two highest-signal
/// views: 30-day mastery per category (accuracy bars) and the recent session
/// list. Deeper charts stay on the web dashboard until the native version
/// earns them.
struct StatsView: View {
    @Environment(AuthManager.self) private var auth

    @State private var data: APIClient.AnalyticsResponse?
    @State private var errorText: String?

    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let d = data {
                    masterySection(d.mastery)
                    sessionsSection(d.recentSessions)
                } else if let e = errorText {
                    Text(e).foregroundStyle(.red).font(.footnote)
                } else {
                    ProgressView("Loading…").frame(maxWidth: .infinity, alignment: .center).padding(.top, 60)
                }
            }
            .padding(16)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle("Stats")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { data = try await api.analytics(childId: auth.childSlug) }
            catch { errorText = "Could not load stats: \(error.localizedDescription)" }
        }
    }

    private func masterySection(_ rows: [APIClient.AnalyticsResponse.MasteryRow]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Mastery · last 30 days")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
            if rows.isEmpty {
                Text("No game data yet — start a game and this fills in.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(rows) { r in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(r.name).font(.system(size: 14, weight: .semibold))
                        Spacer()
                        Text("\(r.pct)%")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color(hex: "#fce4ec"))
                            Capsule()
                                .fill(r.pct >= 80 ? Color(hex: "#16a34a") : Color(hex: "#ff1493"))
                                .frame(width: max(6, geo.size.width * Double(r.pct) / 100))
                        }
                    }
                    .frame(height: 10)
                }
            }
        }
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
    }

    private func sessionsSection(_ rows: [APIClient.AnalyticsResponse.SessionRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent sessions")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
            if rows.isEmpty {
                Text("No sessions yet.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(rows.prefix(20)) { s in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.mode ?? "Game").font(.system(size: 14, weight: .semibold))
                        Text([s.category, s.date].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(s.result ?? "—")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                        Text(s.length ?? "")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 6)
                Divider()
            }
        }
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
    }
}

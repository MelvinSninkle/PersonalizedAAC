import SwiftUI
import UIKit

/// The mastery-bars + recent-sessions surface, lifted out of the old StatsView
/// so the hub stays clean. Uses the same /api/analytics call as AccuracyView.
struct MasterySessionsView: View {
    @Environment(AuthManager.self) private var auth
    private let api = APIClient()

    @State private var data: APIClient.AnalyticsResponse?
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let d = data {
                    masterySection(d.mastery)
                    sessionsSection(d.recentSessions)
                } else if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                } else {
                    ProgressView("Loading…").padding(.top, 60)
                }
            }
            .padding(16)
            // Full width from the FIRST frame — otherwise the loading spinner
            // defines the width and the page pops from a skinny column.
            .frame(maxWidth: .infinity, minHeight: UIScreen.main.bounds.height * 0.8, alignment: .top)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Mastery & sessions")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { data = try await api.analytics(childId: auth.childSlug) }
            catch { errorText = "Could not load: \(error.localizedDescription)" }
        }
    }

    private func masterySection(_ rows: [APIClient.AnalyticsResponse.MasteryRow]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Mastery · last 30 days")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            if rows.isEmpty {
                Text("No game data yet. Start a game and this fills in.")
                    .font(.footnote).foregroundStyle(Color(hex: Brand.muted))
            }
            ForEach(rows) { r in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(prettySkillName(r.name)).font(.system(size: 14, weight: .semibold))
                        Spacer()
                        Text("\(r.pct)%")
                            .font(.system(size: 12)).foregroundStyle(Color(hex: Brand.muted))
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color(hex: Brand.line))
                            Capsule()
                                .fill(r.pct >= 80 ? Color(hex: Brand.good) : Color(hex: Brand.pink))
                                .frame(width: max(6, geo.size.width * Double(r.pct) / 100))
                        }
                    }
                    .frame(height: 10)
                }
            }
        }
        .padding(14)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func sessionsSection(_ rows: [APIClient.AnalyticsResponse.SessionRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent sessions")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            if rows.isEmpty {
                Text("No sessions yet.")
                    .font(.footnote).foregroundStyle(Color(hex: Brand.muted))
            }
            ForEach(rows.prefix(20)) { s in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.mode ?? "Game").font(.system(size: 14, weight: .semibold))
                        Text([s.category, s.date].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 12)).foregroundStyle(Color(hex: Brand.muted))
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(s.result ?? "—")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(hex: Brand.ink))
                        Text(s.length ?? "")
                            .font(.system(size: 11)).foregroundStyle(Color(hex: Brand.muted))
                    }
                }
                .padding(.vertical, 6)
                Divider().background(Color(hex: Brand.line))
            }
        }
        .padding(14)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }
}

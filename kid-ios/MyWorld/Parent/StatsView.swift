import SwiftUI
import Charts

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
                    useSection(series: d.use.series, labels: d.labels)
                    gamesSection(series: d.games.series, labels: d.labels)
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

    /// Use-per-category stacked bars — what categories does the child tap, and
    /// how is that changing over time? Mirrors the "Use" chart on the web
    /// parent dashboard.
    private func useSection(series: [APIClient.AnalyticsResponse.UseSeries],
                            labels: [String]) -> some View {
        let top = Array(series.prefix(6))
        let points: [UsePoint] = top.flatMap { s in
            s.data.enumerated().compactMap { i, n in
                guard i < labels.count else { return nil }
                return UsePoint(category: s.name, bucket: labels[i], bucketIndex: i, count: n)
            }
        }
        return VStack(alignment: .leading, spacing: 12) {
            Text("Use · last \(labels.count) buckets")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
            if top.isEmpty {
                Text("No taps yet — once the child uses the board, this fills in.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Chart(points) { p in
                    BarMark(
                        x: .value("When", p.bucketIndex),
                        y: .value("Taps", p.count)
                    )
                    .foregroundStyle(by: .value("Category", p.category))
                    .cornerRadius(3)
                }
                .chartLegend(position: .bottom, alignment: .leading, spacing: 8)
                .chartXAxis {
                    AxisMarks(values: stride(from: 0, to: labels.count, by: max(1, labels.count / 6)).map { $0 }) { v in
                        AxisGridLine()
                        AxisValueLabel {
                            if let i = v.as(Int.self), i < labels.count {
                                Text(labels[i]).font(.system(size: 9))
                            }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .frame(height: 220)
            }
        }
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
    }

    private struct UsePoint: Identifiable {
        var id: String { category + "-" + String(bucketIndex) }
        let category: String
        let bucket: String
        let bucketIndex: Int
        let count: Int
    }

    /// Games-accuracy lines per category over time — the web's other big chart.
    private func gamesSection(series: [APIClient.AnalyticsResponse.GameSeries],
                              labels: [String]) -> some View {
        let top = Array(series.prefix(5))
        let points: [GamePoint] = top.flatMap { s in
            s.data.enumerated().compactMap { i, pct in
                guard i < labels.count, pct.isFinite, pct > 0 else { return nil }
                return GamePoint(category: s.name, bucketIndex: i, pct: pct)
            }
        }
        return VStack(alignment: .leading, spacing: 12) {
            Text("Accuracy over time")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
            if points.isEmpty {
                Text("No game data yet — once a game runs, accuracy by category lights up here.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Chart(points) { p in
                    LineMark(
                        x: .value("When", p.bucketIndex),
                        y: .value("Accuracy", p.pct)
                    )
                    .foregroundStyle(by: .value("Category", p.category))
                    .symbol(by: .value("Category", p.category))
                    .interpolationMethod(.catmullRom)
                }
                .chartYScale(domain: 0...100)
                .chartLegend(position: .bottom, alignment: .leading, spacing: 8)
                .chartYAxis {
                    AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .chartXAxis {
                    AxisMarks(values: stride(from: 0, to: labels.count, by: max(1, labels.count / 6)).map { $0 }) { v in
                        AxisGridLine()
                        AxisValueLabel {
                            if let i = v.as(Int.self), i < labels.count {
                                Text(labels[i]).font(.system(size: 9))
                            }
                        }
                    }
                }
                .frame(height: 200)
            }
        }
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
    }

    private struct GamePoint: Identifiable {
        var id: String { category + "-" + String(bucketIndex) }
        let category: String
        let bucketIndex: Int
        let pct: Double
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

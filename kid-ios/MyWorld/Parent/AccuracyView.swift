import SwiftUI
import Charts
import UIKit

/// Two separate charts on this screen:
///   • Overall pass rate per category (the headline trend)
///   • Pass rate per GAME MODE — matching vs slideshow vs auditory vs
///     expressive — because each is a qualitatively different measurement
///     (PRD §5.1) and aggregating them hides a child who excels at auditory
///     comprehension but struggles with expressive naming.
struct AccuracyView: View {
    @Environment(AuthManager.self) private var auth
    private let api = APIClient()

    @State private var data: APIClient.AnalyticsResponse?
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let d = data {
                    accuracySection(d.games.series, labels: d.labels)
                    byModeSection(d.gamesByMode.series, labels: d.labels)
                } else if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                } else {
                    ProgressView("Loading game data…").padding(.top, 60)
                }
            }
            .padding(16)
            // Full-height from the FIRST frame: without this the page mounts as
            // a thin strip sized to the spinner and visibly expands when the
            // charts arrive — the "middle-fourth pop" glitch.
            .frame(maxWidth: .infinity, minHeight: UIScreen.main.bounds.height * 0.8, alignment: .top)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Game accuracy")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { data = try await api.analytics(childId: auth.childSlug) }
            catch { errorText = "Could not load: \(error.localizedDescription)" }
        }
    }

    // MARK: -- By category

    private func accuracySection(_ series: [APIClient.AnalyticsResponse.GameSeries],
                                 labels: [String]) -> some View {
        let top = Array(series.prefix(6))
        let points: [Pt] = top.flatMap { s in
            s.data.enumerated().compactMap { i, pct in
                guard i < labels.count, pct > 0 else { return nil }
                return Pt(category: s.name, bucketIndex: i, pct: pct)
            }
        }
        return chartCard(title: "Pass rate by category",
                         emptyMessage: "No games scored yet — accuracy by category lights up here when game data arrives.",
                         isEmpty: points.isEmpty) {
            Chart(points) { p in
                LineMark(x: .value("When", p.bucketIndex),
                         y: .value("Accuracy", p.pct))
                .foregroundStyle(by: .value("Category", p.category))
                .symbol(by: .value("Category", p.category))
                .interpolationMethod(.catmullRom)
            }
            .chartYScale(domain: 0...100)
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
                AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { _ in
                    AxisGridLine()
                    AxisValueLabel().font(.system(size: 9))
                }
            }
            .frame(height: 220)
        }
    }

    // MARK: -- By mode

    private func byModeSection(_ series: [APIClient.AnalyticsResponse.ModeSeries],
                               labels: [String]) -> some View {
        let points: [Pt] = series.flatMap { s in
            s.data.enumerated().compactMap { i, pct in
                guard i < labels.count, pct > 0 else { return nil }
                return Pt(category: s.name, bucketIndex: i, pct: pct)
            }
        }
        return chartCard(title: "Pass rate by game mode",
                         emptyMessage: "No matching/slideshow/auditory/expressive sessions yet — each mode gets its own line here.",
                         isEmpty: points.isEmpty) {
            Chart(points) { p in
                LineMark(x: .value("When", p.bucketIndex),
                         y: .value("Accuracy", p.pct))
                .foregroundStyle(by: .value("Mode", p.category))
                .symbol(by: .value("Mode", p.category))
                .interpolationMethod(.catmullRom)
            }
            .chartYScale(domain: 0...100)
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
                AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { _ in
                    AxisGridLine()
                    AxisValueLabel().font(.system(size: 9))
                }
            }
            .frame(height: 200)
        }
    }

    // MARK: -- Shared chart chrome

    private struct Pt: Identifiable {
        var id: String { category + "-" + String(bucketIndex) }
        let category: String
        let bucketIndex: Int
        let pct: Double
    }

    private func chartCard<C: View>(title: String, emptyMessage: String, isEmpty: Bool,
                                    @ViewBuilder chart: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            if isEmpty {
                Text(emptyMessage)
                    .font(.footnote)
                    .foregroundStyle(Color(hex: Brand.muted))
                    .padding(.vertical, 8)
            } else {
                chart()
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }
}

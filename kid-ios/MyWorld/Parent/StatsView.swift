import SwiftUI
import Charts
import UIKit

/// PRD §4.5 stats hub — four focused sub-pages, each visible the moment its
/// data exists. The old single-scroll view buried everything; this routes
/// to the right surface for the question the parent is asking.
struct StatsView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                hubCard(icon: "chart.xyaxis.line",      title: "Usage over time",
                        subtitle: "Taps per category, day by day",
                        destination: AnyView(UsageView()))
                hubCard(icon: "chart.bar.fill",         title: "Top words",
                        subtitle: "Most-tapped words this month",
                        destination: AnyView(TopWordsView()))
                hubCard(icon: "magnifyingglass",        title: "Word history",
                        subtitle: "Search every tap, by word and time",
                        destination: AnyView(WordHistoryView()))
                hubCard(icon: "gauge.with.dots.needle.67percent",
                        title: "Game accuracy",
                        subtitle: "Pass rate by category and by game mode",
                        destination: AnyView(AccuracyView()))
                hubCard(icon: "hand.raised.fingers.spread.fill",
                        title: "How they answer",
                        subtitle: "Tap · verbal · object · physical · gesture",
                        destination: AnyView(InputMethodsView()))
                hubCard(icon: "rosette",                title: "Mastery & sessions",
                        subtitle: "30-day mastery and recent activity",
                        destination: AnyView(MasterySessionsView()))
            }
            .padding(16)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Stats")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func hubCard(icon: String, title: String, subtitle: String,
                         destination: AnyView) -> some View {
        NavigationLink { destination } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 50, height: 50)
                    .background(Color(hex: Brand.pink), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: Brand.ink))
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Color(hex: Brand.muted))
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color(hex: Brand.faint))
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}


// MARK: -- Usage over time (parity with the web dashboard's "Use" chart)

/// Taps per category over time — the web dashboard's headline "Use" chart,
/// now native. Day (14) / week (8) / month (6) buckets, top categories as
/// lines, names prettified. (Lives in this file so no xcodegen re-run.)
struct UsageView: View {
    @Environment(AuthManager.self) private var auth
    private let api = APIClient()

    @State private var data: APIClient.AnalyticsResponse?
    @State private var bucket = "day"
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Picker("Granularity", selection: $bucket) {
                    Text("Day").tag("day")
                    Text("Week").tag("week")
                    Text("Month").tag("month")
                }
                .pickerStyle(.segmented)

                if let d = data {
                    usageCard(d.use.series, labels: d.labels)
                } else if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                } else {
                    ProgressView("Loading usage…").padding(.top, 60)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: UIScreen.main.bounds.height * 0.8, alignment: .top)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Usage over time")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: bucket) { await load() }
    }

    private func load() async {
        do { data = try await api.analytics(childId: auth.childSlug, bucket: bucket) }
        catch { errorText = "Could not load: \(error.localizedDescription)" }
    }

    private struct Pt: Identifiable {
        var id: String { category + "-" + String(i) }
        let category: String
        let i: Int
        let taps: Int
    }

    private func usageCard(_ series: [APIClient.AnalyticsResponse.UseSeries],
                           labels: [String]) -> some View {
        // Top 8 categories by total taps — same cap as the web chart.
        let top = series.sorted { $0.data.reduce(0, +) > $1.data.reduce(0, +) }.prefix(8)
        let points: [Pt] = top.flatMap { s in
            s.data.enumerated().compactMap { i, n in
                guard i < labels.count else { return nil }
                return Pt(category: prettySkillName(s.name), i: i, taps: n)
            }
        }
        return VStack(alignment: .leading, spacing: 12) {
            Text("Taps per category")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            Text("How often \(prettyChildName(auth.user?.slug).isEmpty ? "your child" : prettyChildName(auth.user?.slug)) communicates with each category on their own.")
                .font(.footnote)
                .foregroundStyle(Color(hex: Brand.muted))
            if points.allSatisfy({ $0.taps == 0 }) || points.isEmpty {
                Text("No board activity yet — this lights up as the board gets used.")
                    .font(.footnote)
                    .foregroundStyle(Color(hex: Brand.muted))
                    .padding(.vertical, 10)
            } else {
                Chart(points) { p in
                    LineMark(x: .value("When", p.i), y: .value("Taps", p.taps))
                        .foregroundStyle(by: .value("Category", p.category))
                        .interpolationMethod(.catmullRom)
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
                .frame(height: 260)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }
}

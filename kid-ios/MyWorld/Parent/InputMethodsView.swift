import SwiftUI
import Charts
import UIKit

/// How the child is answering — tap vs verbal vs object vs physical vs
/// gesture. PRD §3 mercy bridge: a verbal or physical response is logged as
/// correct identically to a tap, so tracking the mix tells the parent + SLP
/// whether the child is moving toward independent tapping over time.
struct InputMethodsView: View {
    @Environment(AuthManager.self) private var auth
    private let api = APIClient()

    @State private var days = 30
    @State private var data: APIClient.InputMethodsResponse?
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                rangePicker
                if let d = data {
                    breakdownCard(d)
                    trendCard(d)
                    accuracyCard(d)
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
        .navigationTitle("How they answer")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: days) {
            do { data = try await api.inputMethods(childId: auth.childSlug, days: days) }
            catch { errorText = "Could not load: \(error.localizedDescription)" }
        }
    }

    private var rangePicker: some View {
        Picker("Range", selection: $days) {
            Text("7 days").tag(7)
            Text("30 days").tag(30)
            Text("90 days").tag(90)
        }
        .pickerStyle(.segmented)
        .tint(Color(hex: Brand.pink))
    }

    // MARK: -- Cards

    private func breakdownCard(_ d: APIClient.InputMethodsResponse) -> some View {
        let methods = Self.ordered
        let total = methods.reduce(0) { $0 + (d.totals[$1] ?? 0) }
        return card(title: "Response mix") {
            if total == 0 {
                Text("No game responses recorded yet.")
                    .font(.footnote).foregroundStyle(Color(hex: Brand.muted))
            } else {
                // Single stacked bar showing the share of each method.
                VStack(spacing: 10) {
                    GeometryReader { geo in
                        HStack(spacing: 0) {
                            ForEach(methods, id: \.self) { m in
                                let share = total > 0 ? Double(d.totals[m] ?? 0) / Double(total) : 0
                                if share > 0 {
                                    Rectangle()
                                        .fill(Color(hex: Self.color(m)))
                                        .frame(width: geo.size.width * share)
                                }
                            }
                        }
                    }
                    .frame(height: 18)
                    .clipShape(Capsule())
                    // Legend with counts.
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(methods, id: \.self) { m in
                            let n = d.totals[m] ?? 0
                            if n > 0 {
                                HStack(spacing: 8) {
                                    Circle().fill(Color(hex: Self.color(m))).frame(width: 10, height: 10)
                                    Text(Self.label(m))
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                        .foregroundStyle(Color(hex: Brand.ink))
                                    Spacer()
                                    Text("\(n) · \(Int(Double(n) / Double(total) * 100))%")
                                        .font(.system(size: 12, design: .monospaced))
                                        .foregroundStyle(Color(hex: Brand.muted))
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func trendCard(_ d: APIClient.InputMethodsResponse) -> some View {
        let pts: [Pt] = d.series.flatMap { s in
            s.data.enumerated().compactMap { i, n in
                guard i < d.buckets.count, n > 0 else { return nil }
                return Pt(method: Self.label(s.method), bucketIndex: i, n: n)
            }
        }
        return card(title: "How they answered over time") {
            if pts.isEmpty {
                Text("Not enough data yet for a trend line.")
                    .font(.footnote).foregroundStyle(Color(hex: Brand.muted))
            } else {
                Chart(pts) { p in
                    LineMark(x: .value("When", p.bucketIndex),
                             y: .value("Count", p.n))
                    .foregroundStyle(by: .value("Method", p.method))
                    .symbol(by: .value("Method", p.method))
                    .interpolationMethod(.catmullRom)
                }
                .chartLegend(position: .bottom, alignment: .leading, spacing: 8)
                .chartXAxis {
                    AxisMarks(values: stride(from: 0, to: d.buckets.count,
                                              by: max(1, d.buckets.count / 6)).map { $0 }) { v in
                        AxisGridLine()
                        AxisValueLabel {
                            if let i = v.as(Int.self), i < d.buckets.count {
                                Text(d.buckets[i]).font(.system(size: 9))
                            }
                        }
                    }
                }
                .frame(height: 200)
            }
        }
    }

    private func accuracyCard(_ d: APIClient.InputMethodsResponse) -> some View {
        let methods = Self.ordered
        return card(title: "Accuracy by method") {
            VStack(spacing: 8) {
                ForEach(methods, id: \.self) { m in
                    if let c = d.correctBy[m], c.total > 0 {
                        let pct = Int(Double(c.ok) / Double(c.total) * 100)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Circle().fill(Color(hex: Self.color(m))).frame(width: 8, height: 8)
                                Text(Self.label(m))
                                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                                    .foregroundStyle(Color(hex: Brand.ink))
                                Spacer()
                                Text("\(pct)% · \(c.ok)/\(c.total)")
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(Color(hex: Brand.muted))
                            }
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Color(hex: Brand.line))
                                    Capsule()
                                        .fill(Color(hex: Self.color(m)))
                                        .frame(width: max(6, geo.size.width * Double(pct) / 100))
                                }
                            }
                            .frame(height: 8)
                        }
                    }
                }
            }
        }
    }

    // MARK: -- Helpers

    private struct Pt: Identifiable {
        var id: String { method + "-" + String(bucketIndex) }
        let method: String
        let bucketIndex: Int
        let n: Int
    }

    private static let ordered = ["tap", "verbal", "object", "physical", "gesture", "other"]

    private static func label(_ m: String) -> String {
        switch m {
        case "tap":      return "Tapped"
        case "verbal":   return "Said it"
        case "object":   return "Showed object"
        case "physical": return "Physical prompt"
        case "gesture":  return "Gesture"
        default:           return "Other"
        }
    }
    private static func color(_ m: String) -> String {
        switch m {
        case "tap":      return Brand.tapInk
        case "verbal":   return Brand.verbalInk
        case "object":   return Brand.objectInk
        case "physical": return "#f59e0b"
        case "gesture":  return Brand.pinkMid
        default:           return Brand.faint
        }
    }

    private func card<C: View>(title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }
}

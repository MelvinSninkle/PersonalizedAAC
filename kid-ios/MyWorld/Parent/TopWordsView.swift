import SwiftUI

/// Most-tapped words ranked, with a day-range picker (7 / 30 / 90 / 365).
/// Each row shows count, top category, and a small bar that visualizes
/// the word's share of the top result.
struct TopWordsView: View {
    @Environment(AuthManager.self) private var auth
    private let api = APIClient()

    @State private var days = 30
    @State private var rows: [APIClient.TopWord] = []
    @State private var loaded = false
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                rangePicker
                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                } else if !loaded {
                    ProgressView("Loading…").padding(.top, 40)
                } else if rows.isEmpty {
                    emptyState
                } else {
                    listCard
                }
            }
            .padding(16)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Top words")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: days) { await reload() }
    }

    private var rangePicker: some View {
        Picker("Range", selection: $days) {
            Text("7 days").tag(7)
            Text("30 days").tag(30)
            Text("90 days").tag(90)
            Text("1 year").tag(365)
        }
        .pickerStyle(.segmented)
        .tint(Color(hex: Brand.pink))
    }

    private var emptyState: some View {
        Text("No taps yet in the last \(days) days. As the child uses the board, words climb to the top here.")
            .font(.footnote)
            .foregroundStyle(Color(hex: Brand.muted))
            .multilineTextAlignment(.center)
            .padding(.vertical, 40)
    }

    private var listCard: some View {
        let max = rows.first?.count ?? 1
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                wordRow(row, rank: i + 1, max: max)
                if i < rows.count - 1 {
                    Divider().background(Color(hex: Brand.line))
                }
            }
        }
        .padding(.vertical, 4)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func wordRow(_ row: APIClient.TopWord, rank: Int, max: Int) -> some View {
        let share = max > 0 ? Double(row.count) / Double(max) : 0
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(rank).")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.faint))
                    .frame(width: 28, alignment: .trailing)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.label)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: Brand.ink))
                    if let c = row.category, !c.isEmpty {
                        Text(c)
                            .font(.system(size: 11))
                            .foregroundStyle(Color(hex: Brand.muted))
                    }
                }
                Spacer()
                Text("\(row.count)")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.pinkDeep))
            }
            GeometryReader { geo in
                Capsule()
                    .fill(Color(hex: Brand.pink))
                    .frame(width: max(6, geo.size.width * share), height: 6)
                    .opacity(0.85)
            }
            .frame(height: 6)
            .background(Color(hex: Brand.line), in: Capsule())
            .padding(.leading, 36)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func reload() async {
        errorText = nil
        do {
            let resp = try await api.topWords(childId: auth.childSlug, days: days, limit: 100)
            rows = resp.rows
        } catch {
            errorText = "Could not load top words: \(error.localizedDescription)"
        }
        loaded = true
    }
}

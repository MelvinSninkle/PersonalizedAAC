import SwiftUI
import UIKit

/// Searchable tap log — every word the child tapped, with timestamps,
/// filterable by word substring and time range. Server pages 200 at a time.
struct WordHistoryView: View {
    @Environment(AuthManager.self) private var auth
    private let api = APIClient()

    @State private var query = ""
    @State private var sinceDays = 30
    @State private var rows: [APIClient.WordEvent] = []
    @State private var hasMore = false
    @State private var loading = false
    @State private var errorText: String?
    @State private var loadedOnce = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                searchField
                rangePicker
                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                } else if loadedOnce && rows.isEmpty {
                    emptyState
                } else {
                    listCard
                    if hasMore {
                        Button {
                            Task { await load(append: true) }
                        } label: {
                            Text(loading ? "Loading…" : "Load more")
                                .font(.system(size: 14, weight: .semibold, design: .rounded))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Color(hex: Brand.nextBg), in: Capsule())
                                .foregroundStyle(Color(hex: Brand.nextInk))
                        }
                        .disabled(loading)
                    }
                }
            }
            .padding(16)
            // Full width from the FIRST frame — otherwise the loading spinner
            // defines the width and the page pops from a skinny column.
            .frame(maxWidth: .infinity, minHeight: UIScreen.main.bounds.height * 0.8, alignment: .top)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Word history")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: TaskKey(query: query, days: sinceDays)) {
            // 350ms debounce on the query so every keystroke isn't a request.
            try? await Task.sleep(for: .milliseconds(350))
            if !Task.isCancelled { await load(append: false) }
        }
    }

    private struct TaskKey: Equatable { let query: String; let days: Int }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color(hex: Brand.muted))
            TextField("Search for a word…", text: $query)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color(hex: Brand.faint))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private var rangePicker: some View {
        Picker("Since", selection: $sinceDays) {
            Text("7 days").tag(7)
            Text("30 days").tag(30)
            Text("90 days").tag(90)
            Text("1 year").tag(365)
        }
        .pickerStyle(.segmented)
        .tint(Color(hex: Brand.pink))
    }

    private var emptyState: some View {
        Text(query.isEmpty
             ? "No taps in this window."
             : "No taps matching “\(query)” in this window.")
            .font(.footnote)
            .foregroundStyle(Color(hex: Brand.muted))
            .multilineTextAlignment(.center)
            .padding(.vertical, 40)
    }

    private var listCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                eventRow(row)
                if i < rows.count - 1 {
                    Divider().background(Color(hex: Brand.line))
                }
            }
        }
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func eventRow(_ ev: APIClient.WordEvent) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(ev.label)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.ink))
                if let c = ev.category, !c.isEmpty {
                    Text(c)
                        .font(.system(size: 11))
                        .foregroundStyle(Color(hex: Brand.muted))
                }
            }
            Spacer()
            Text(dateText(ev.when))
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color(hex: Brand.muted))
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func load(append: Bool) async {
        loading = true
        errorText = nil
        do {
            let since = Calendar.current.date(byAdding: .day, value: -sinceDays, to: Date())
            let resp = try await api.wordHistory(
                childId: auth.childSlug,
                query: query.trimmingCharacters(in: .whitespaces),
                since: since,
                until: Date(),
                // 60 per page: a screenful and a bit — Load more pages the
                // rest. 200-row first paints made the page feel endless.
                limit: 60,
                offset: append ? rows.count : 0
            )
            if append { rows.append(contentsOf: resp.rows) }
            else      { rows = resp.rows }
            hasMore = resp.hasMore
        } catch {
            errorText = "Could not load: \(error.localizedDescription)"
        }
        loading = false
        loadedOnce = true
    }

    private func dateText(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let d else { return iso.prefix(10).description }
        // Today → "3:42 PM", earlier → "Jun 12 · 3:42 PM"
        let cal = Calendar.current
        let now = Date()
        let timeFmt = Date.FormatStyle().hour().minute()
        if cal.isDate(d, inSameDayAs: now) { return d.formatted(timeFmt) }
        return d.formatted(.dateTime.month(.abbreviated).day()) + " · " + d.formatted(timeFmt)
    }
}

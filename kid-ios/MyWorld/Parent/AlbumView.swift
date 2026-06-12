import SwiftUI

/// The memorabilia album: every picture the board has ever held — current tile
/// art plus the archived versions each regeneration left behind, plus each
/// year's holiday celebration scenes. Timeline view, newest first; tap for
/// a full-screen look.
struct AlbumView: View {
    @Environment(AuthManager.self) private var auth

    @State private var entries: [APIClient.AlbumEntry] = []
    @State private var loaded = false
    @State private var errorText: String?
    @State private var zoomed: APIClient.AlbumEntry?

    private let api = APIClient()
    private let columns = [GridItem(.adaptive(minimum: 110), spacing: 8)]

    var body: some View {
        ScrollView {
            if let e = errorText {
                Text(e).font(.footnote).foregroundStyle(.red).padding()
            }
            if loaded && entries.isEmpty {
                Text("No pictures yet. As tiles get new art, the old versions are kept here forever.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(24)
            }
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(entries) { entry in
                    Button { zoomed = entry } label: {
                        VStack(spacing: 3) {
                            MediaImage(blobKey: entry.blobKey)
                                .frame(minWidth: 110, minHeight: 110)
                                .aspectRatio(1, contentMode: .fill)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                            Text(entry.label ?? "")
                                .font(.system(size: 11, weight: .semibold))
                                .lineLimit(1)
                            Text(dateText(entry.when) + (entry.kind == "current" ? " · current" : ""))
                                .font(.system(size: 9))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(12)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle("Album")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $zoomed) { entry in
            VStack(spacing: 14) {
                MediaImage(blobKey: entry.blobKey)
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .padding(.horizontal, 16)
                Text(entry.label ?? "")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                Text(dateText(entry.when))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(.vertical, 24)
            .presentationDetents([.large])
        }
        .task {
            do { entries = try await api.albumTimeline(childId: auth.childSlug, limit: 300) }
            catch { errorText = "Could not load the album: \(error.localizedDescription)" }
            loaded = true
        }
    }

    private func dateText(_ iso: String?) -> String {
        guard let iso else { return "" }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let d else { return "" }
        return d.formatted(date: .abbreviated, time: .omitted)
    }
}

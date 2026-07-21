import SwiftUI
import PhotosUI
import SafariServices

/// #11: the guided "add a movie or show" flow.
///
/// 1. FIND — the parent types a title; the server searches Wikidata (free,
///    CC0) through its single search interface and returns title/year/type
///    candidates. The parent always picks; nothing is auto-selected.
/// 2. LINK — the pick carries wikidata_qid + imdb_id onto the tile job.
/// 3. GET THE POSTER — an in-app browser opens the IMDb title page; the
///    parent long-presses the poster and saves it to Photos, then picks it
///    here. The app never fetches or stores studio artwork itself — the
///    only stored image is the parent's own upload. If they can't grab the
///    poster, the camera (DVD case, shelf toy) is right there.
/// 4. RENDER — the tile enqueues use-as-is (raw, no AI restyle), keeps the
///    poster's tall shape, files itself into the TV & Movies folder, and
///    speaks the title in the child's chosen voice via the normal pipeline.
struct MovieAddSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(BoardStore.self)   private var board
    @Environment(AuthManager.self)  private var auth
    @Environment(AddTileQueue.self) private var queue

    struct MovieResult: Decodable, Identifiable, Hashable {
        var id: String { qid }
        let qid: String
        let title: String
        let description: String?
        let year: Int?
        let type: String        // "film" | "tv" | "title"
        let imdbId: String?
    }

    @State private var query = ""
    @State private var searching = false
    @State private var results: [MovieResult] = []
    @State private var searchMsg: String?
    @State private var picked: MovieResult?

    @State private var showBrowser = false
    @State private var showCamera = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var importing = false
    @State private var queued = false

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let m = picked {
                        linkedSection(m)
                    } else {
                        searchSection
                    }
                }
                .padding(16)
            }
            .background(Color(hex: "#fff7fb"))
            .navigationTitle("🎬 Movie or show")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    // MARK: - Step 1: find

    private var searchSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What's the movie or show called?")
                .font(.headline)
            HStack(spacing: 8) {
                TextField("e.g. Bluey", text: $query)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .onSubmit { Task { await search() } }
                Button {
                    Task { await search() }
                } label: {
                    Text(searching ? "…" : "Find")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .foregroundStyle(.white)
                        .background(Color(hex: "#ff1493"), in: RoundedRectangle(cornerRadius: 12))
                }
                .disabled(searching || query.trimmingCharacters(in: .whitespaces).count < 2)
            }
            if let msg = searchMsg {
                Text(msg).font(.footnote).foregroundStyle(Color(hex: "#6b7280"))
            }
            ForEach(results) { m in
                Button {
                    picked = m
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.title + (m.year.map { " (\($0))" } ?? ""))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color(hex: "#111827"))
                        Text((m.type == "tv" ? "TV show" : m.type == "film" ? "Film" : "Title")
                             + ((m.description?.isEmpty == false) ? " · \(m.description!)" : ""))
                            .font(.footnote)
                            .foregroundStyle(Color(hex: "#6b7280"))
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(.white, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return }
        searching = true
        searchMsg = "Searching…"
        defer { searching = false }
        struct R: Decodable { let results: [MovieResult] }
        do {
            let (data, _) = try await api.request(
                method: "GET",
                path: "/api/items?movieSearch=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q)",
                body: nil)
            results = (try JSONDecoder().decode(R.self, from: data)).results
            searchMsg = results.isEmpty ? "Nothing found. Try the full title." : "Pick the right one:"
        } catch {
            results = []
            searchMsg = "Search didn't work. Check the connection and try again."
        }
    }

    // MARK: - Steps 2-4: linked → poster → enqueue

    private func linkedSection(_ m: MovieResult) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.title + (m.year.map { " (\($0))" } ?? ""))
                        .font(.headline)
                    Text(m.type == "tv" ? "TV show" : "Film")
                        .font(.footnote).foregroundStyle(Color(hex: "#6b7280"))
                }
                Spacer()
                Button("Change") { picked = nil; queued = false }
                    .font(.footnote.weight(.semibold))
            }
            .padding(12)
            .background(.white, in: RoundedRectangle(cornerRadius: 12))

            if queued {
                VStack(alignment: .leading, spacing: 6) {
                    Text("✓ On its way to the board").font(.headline)
                    Text("The tile lands in the TV & Movies folder in a minute, speaking \"\(m.title)\" in your child's voice. You can close this.")
                        .font(.footnote).foregroundStyle(Color(hex: "#047857"))
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: "#ecfdf5"), in: RoundedRectangle(cornerRadius: 12))
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Now the picture").font(.headline)
                    if m.imdbId != nil {
                        Text("Open the IMDb page, press and hold the poster, choose \"Add to Photos\", then come back and pick it below. Your saved poster goes on the tile exactly as it is, tall poster shape and all.")
                            .font(.footnote).foregroundStyle(Color(hex: "#6b7280"))
                        Button {
                            showBrowser = true
                        } label: {
                            label("🎞  Get the poster (IMDb)", filled: true)
                        }
                        .buttonStyle(.plain)
                    }
                    PhotosPicker(selection: $libraryItem, matching: .images) {
                        label(importing ? "Loading…" : "🖼  Use a saved picture", filled: false)
                    }
                    Button {
                        showCamera = true
                    } label: {
                        label("📷  Photograph the case or a toy", filled: false)
                    }
                    .buttonStyle(.plain)
                    Text("No AI redraw for posters: the picture goes on exactly as you provide it.")
                        .font(.caption2).foregroundStyle(Color(hex: "#9ca3af"))
                }
            }
        }
        .sheet(isPresented: $showBrowser) {
            if let imdb = m.imdbId, let url = URL(string: "https://www.imdb.com/title/\(imdb)/") {
                SafariSheet(url: url)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraCapture { data in
                showCamera = false
                if let data { enqueuePoster(data, for: m) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: libraryItem) { _, item in
            guard let item else { return }
            importing = true
            Task {
                defer { importing = false; libraryItem = nil }
                if let raw = try? await item.loadTransferable(type: Data.self),
                   let jpeg = downscaleJPEG(raw, maxDim: 1024, quality: 0.85) {
                    enqueuePoster(jpeg, for: m)
                }
            }
        }
    }

    private func label(_ text: String, filled: Bool) -> some View {
        Text(text)
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 46)
            .foregroundStyle(filled ? .white : Color(hex: "#ad1457"))
            .background(filled ? Color(hex: "#ff1493") : Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .stroke(Color(hex: filled ? "#ff1493" : "#f3c6dd"), lineWidth: filled ? 0 : 1.5))
    }

    /// The identical durable pipeline every parent upload rides — poster
    /// tiles just default to use-as-is + tall shape + the TV & Movies folder.
    private func enqueuePoster(_ jpeg: Data, for m: MovieResult) {
        _ = queue.enqueue(photoJPEG: jpeg,
                          section: .nouns,
                          categoryId: nil,
                          style: .soft,
                          model: "",
                          bg: "",
                          emotion: "default",
                          raw: true,
                          prefilledLabel: m.title,
                          childId: auth.childSlug,
                          board: board,
                          wikidataQid: m.qid,
                          imdbId: m.imdbId,
                          keepAspect: true,
                          folderHint: "TV & Movies")
        queued = true
    }
}

/// Minimal in-app Safari sheet. SFSafariViewController already supports
/// long-press → "Add to Photos" on images, which is the whole point here.
private struct SafariSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

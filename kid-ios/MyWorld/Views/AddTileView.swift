import SwiftUI
import PhotosUI
import UIKit

/// Native "Add tiles" flow, built for a parent with two kids hanging off her.
///
/// The slow part (image generation, ~20–40s) never blocks her. She picks where
/// the batch goes once, then snaps; each photo becomes a background job with its
/// own progress ring in the tray and auto-adds to the board when it finishes.
/// She can keep shooting the whole time, or close the sheet and let the tiles
/// finish landing on their own.
///
///   ┌─ Adding to: [Needs|People|Nouns|Verbs]  Folder ▾  Style ▾ ─┐
///   │  [ 📷 Take a photo ]   [ 🖼 Choose from Photos ]            │
///   │  ── In progress ──                                          │
///   │  [photo] Banana          🔊 Making the voice…       ◔       │
///   │  [photo] On the board ✓  tap to rename               ✓      │
///   └────────────────────────────────────────────────────────────┘
struct AddTileView: View {
    let onDone: () -> Void

    @Environment(BoardStore.self)   private var board
    @Environment(AuthManager.self)  private var auth
    @Environment(AddTileQueue.self) private var queue

    // Batch destination — seeded from where the "+ Add tile" cell was tapped,
    // then applied to every photo until changed. These MUST be seeded in init
    // (not .task): assigning `section` after the view exists trips the
    // onChange(of: section) handler below, which clears `categoryId` — that's
    // what was resetting the pre-selected folder back to "Top level".
    @State private var section: BoardSection
    @State private var categoryId: Int?
    @State private var style: ArtStyle = .threeD
    @State private var model: ImageModel = .nanoBanana
    /// Background-color preset for the generated tile. Defaults to pink to
    /// match the board brand; the user picks a different one per batch when
    /// they want some variety across categories.
    @State private var bg: TileBackground = .pink

    init(defaultSection: BoardSection = .needs, defaultCategoryId: Int? = nil, onDone: @escaping () -> Void) {
        self.onDone = onDone
        _section = State(initialValue: defaultSection)
        _categoryId = State(initialValue: defaultCategoryId)
    }

    // Picker presentation. One library picker handles both single and multi —
    // pick one photo or many from the same "Choose photo(s)" button.
    @State private var showCamera  = false
    @State private var showLibrary = false
    @State private var libraryItems: [PhotosPickerItem] = []
    @State private var importing = false

    @State private var editingJob: TileJob?
    /// A single freshly-captured photo waiting on the "hold on — here's more
    /// info" review before generation kicks off. Non-nil = the pre-gen sheet is
    /// up. Bulk imports skip this (they're reviewed after, in BatchReviewView).
    @State private var pendingCapture: PendingCapture?

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 18) {
                        destinationCard
                        captureButtons
                        tray
                    }
                    .padding(16)
                    // One picker, up to 50 — pick a single photo or many. Routed
                    // to a single add or a reviewable batch based on the count.
                    .photosPicker(isPresented: $showLibrary, selection: $libraryItems,
                                  maxSelectionCount: 50, matching: .images)
                    .sheet(item: $editingJob) { job in
                        TileEditSheet(job: job)
                    }
                    // "Hold on a second" — confirm the name and add any extra
                    // detail before the (slow, costly) generation starts.
                    .sheet(item: $pendingCapture) { pending in
                        PreGenerateSheet(
                            photoJPEG: pending.data,
                            destination: destinationName(),
                            onGenerate: { name, detail in
                                pendingCapture = nil
                                enqueue(pending.data, name: name, detail: detail)
                            },
                            onCancel: { pendingCapture = nil }
                        )
                    }
                }
            }
            .navigationTitle("Add tiles")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { onDone() }
                        .font(.system(size: 16, weight: .semibold))
                }
            }
            .sheet(isPresented: $showCamera) {
                // Flip the binding ourselves so the sheet actually dismisses and
                // a second tap re-opens the camera (the picker no longer self-
                // dismisses — see CameraPicker).
                CameraPicker { data in
                    showCamera = false
                    if let data { pendingCapture = PendingCapture(data: data) }
                }
                .ignoresSafeArea()
            }
            .onChange(of: libraryItems) { _, picked in
                guard !picked.isEmpty else { return }
                Task { await importPicked(picked) }
            }
            .task {
                // Destination is seeded in init now (see above). Reopening the
                // sheet starts the tray clean, but keep anything still rendering
                // visible so she can watch it land.
                queue.pruneFinished()
            }
        }
    }

    // MARK: -- Destination

    private var destinationCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("THESE TILES GO TO")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color(hex: "#999"))

            Picker("Section", selection: $section) {
                ForEach([BoardSection.needs, .people, .nouns, .verbs]) { s in
                    Text(sectionLabel(s)).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: section) { _, _ in categoryId = nil }

            // Horizontal scroll so the chips (folder / style / model — the model
            // label is long) never overflow or get clipped on a narrow sheet.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    let folders = folderOptions(section)
                    if !folders.isEmpty {
                        Menu {
                            Button("Top level") { categoryId = nil }
                            ForEach(folders) { f in
                                Button(f.depth > 0 ? "— " + f.label : f.label) { categoryId = f.id }
                            }
                        } label: {
                            menuChip(icon: "folder", text: folderName())
                        }
                    }
                    Menu {
                        ForEach(ArtStyle.allCases) { s in
                            Button(s.label) { style = s }
                        }
                    } label: {
                        menuChip(icon: "paintpalette", text: style.label)
                    }
                    Menu {
                        ForEach(ImageModel.allCases) { m in
                            Button(m.label) { model = m }
                        }
                    } label: {
                        menuChip(icon: "wand.and.stars", text: model.label)
                    }
                    Menu {
                        ForEach(TileBackground.allCases) { c in
                            Button {
                                bg = c
                            } label: {
                                Label(c.label, systemImage: "circle.fill")
                                    .foregroundStyle(Color(hex: c.hex))
                            }
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Circle()
                                .fill(Color(hex: bg.hex))
                                .frame(width: 14, height: 14)
                                .overlay(Circle().stroke(Color(hex: "#ad1457").opacity(0.3), lineWidth: 1))
                            Text(bg.label)
                                .font(.system(size: 13, weight: .semibold, design: .rounded))
                                .foregroundStyle(Color(hex: "#ad1457"))
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Color(hex: "#fce4ec"), in: Capsule())
                    }
                }
            }
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private func menuChip(icon: String, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
            Text(text).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 10))
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(Color(hex: "#ad1457"))
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color(hex: "#fce4ef"))
        .clipShape(Capsule())
    }

    // MARK: -- Capture

    private var captureButtons: some View {
        HStack(spacing: 12) {
            Button { showCamera = true } label: {
                captureLabel(icon: "camera.fill", text: "Take a photo", filled: true)
            }
            .buttonStyle(.plain)
            .disabled(importing)

            // One button for the library: pick a single photo or many. One photo
            // → a single tile; several → a reviewable batch.
            Button { showLibrary = true } label: {
                captureLabel(icon: importing ? nil : "photo.on.rectangle",
                             text: importing ? "Loading…" : "Choose photo(s)",
                             filled: false, busy: importing)
            }
            .buttonStyle(.plain)
            .disabled(importing)
        }
    }

    private func captureLabel(icon: String?, text: String, filled: Bool, busy: Bool = false) -> some View {
        VStack(spacing: 6) {
            if busy {
                ProgressView().tint(Color(hex: "#ad1457"))
            } else if let icon {
                Image(systemName: icon).font(.system(size: 26))
            }
            Text(text).font(.system(size: 15, weight: .semibold))
        }
        .frame(maxWidth: .infinity, minHeight: 84)
        .foregroundStyle(filled ? .white : Color(hex: "#ad1457"))
        .background(filled ? Color(hex: "#ff1493") : Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color(hex: "#ff1493"), lineWidth: filled ? 0 : 2)
        )
    }

    // MARK: -- Tray

    @ViewBuilder
    private var tray: some View {
        if !queue.jobs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("TILES")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(hex: "#999"))
                ForEach(queue.jobs) { job in
                    JobCard(job: job,
                            onTap:   { tapped(job) },
                            onRetry: { queue.retry(job, board: board) },
                            onRemove:{ queue.remove(job) })
                }
            }
        } else {
            Text("Snap a photo of anything — a snack, a toy, a person — and we'll turn it into a tile while you line up the next one.")
                .font(.system(size: 14))
                .foregroundStyle(Color(hex: "#aa7"))
                .multilineTextAlignment(.center)
                .padding(.top, 8)
        }
    }

    private func tapped(_ job: TileJob) {
        // Done → rename; needs-a-name → name it. (Error cards use their button.)
        if job.phase == .done || (job.phase == .needsAttention && job.errorText == nil) {
            editingJob = job
        }
    }

    // MARK: -- Helpers

    /// A single photo (camera, or one library pick) → one tile, no review flag.
    /// `name`/`detail` come from the pre-gen review sheet: an empty name lets the
    /// AI auto-label; `detail` is the parent's optional "here's more info" hint
    /// passed to generation to steer the art.
    private func enqueue(_ data: Data, name: String = "", detail: String = "") {
        queue.enqueue(photoJPEG: data,
                      section: section,
                      categoryId: categoryId,
                      style: style,
                      model: model.apiValue,
                      bg: bg.rawValue,
                      emotion: "default",
                      prefilledLabel: name.trimmingCharacters(in: .whitespaces),
                      prefilledDetail: detail.trimmingCharacters(in: .whitespaces),
                      childId: auth.childSlug,
                      board: board)
    }

    /// Library selection. Loads + downscales the bytes, then routes by count:
    /// one photo → a single tile (no review); several → a reviewable batch.
    private func importPicked(_ items: [PhotosPickerItem]) async {
        importing = true
        defer { importing = false; libraryItems = [] }
        var photos: [Data] = []
        for item in items {
            if let raw = try? await item.loadTransferable(type: Data.self),
               let jpeg = downscaleJPEG(raw, maxDim: 1024, quality: 0.85) {
                photos.append(jpeg)
            }
        }
        guard !photos.isEmpty else { return }
        if photos.count == 1 {
            // Single pick → same "hold on, here's more info" review as a snap.
            pendingCapture = PendingCapture(data: photos[0])
        } else {
            queue.enqueueBatch(photos: photos,
                               section: section,
                               categoryId: categoryId,
                               style: style,
                               model: model.apiValue,
                               bg: bg.rawValue,
                               emotion: "default",
                               childId: auth.childSlug,
                               board: board)
        }
    }

    private struct FolderOption: Identifiable { let id: Int; let label: String; let depth: Int }

    /// Top-level categories plus their subcategories (indented). Lets a "+ Add
    /// tile" tap from inside a subcategory pre-select the right folder, and lets
    /// the parent retarget anywhere in the section.
    private func folderOptions(_ section: BoardSection) -> [FolderOption] {
        var out: [FolderOption] = []
        for root in board.roots(in: section) {
            out.append(FolderOption(id: root.id, label: root.label, depth: 0))
            for sub in board.children(of: root) {
                out.append(FolderOption(id: sub.id, label: sub.label, depth: 1))
            }
        }
        return out
    }

    private func folderName() -> String {
        guard let id = categoryId,
              let f = folderOptions(section).first(where: { $0.id == id }) else { return "Top level" }
        return f.label
    }

    /// Human-readable "Needs › Snacks" destination for the pre-gen sheet header,
    /// so the parent confirms placement before the tile generates.
    private func destinationName() -> String {
        let sec = sectionLabel(section)
        guard let id = categoryId,
              let f = folderOptions(section).first(where: { $0.id == id }) else { return sec }
        return "\(sec) › \(f.label)"
    }

    private func sectionLabel(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "Needs"
        case .people: return "People"
        case .nouns:  return "Nouns"
        case .verbs:  return "Verbs"
        }
    }
}

// MARK: -- Tray card

/// One row in the tray. Shows the captured photo with a live progress ring while
/// the AI chain runs, a checkmark once it's on the board, or a name/retry prompt
/// when it needs a hand.
private struct JobCard: View {
    @Bindable var job: TileJob
    let onTap: () -> Void
    let onRetry: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
            VStack(alignment: .leading, spacing: 3) {
                Text(titleText)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(hex: "#333"))
                    .lineLimit(1)
                Text(job.errorText ?? job.statusText)
                    .font(.system(size: 13))
                    .foregroundStyle(job.errorText != nil ? .red : Color(hex: "#888"))
                    .lineLimit(2)
                if isError {
                    HStack(spacing: 14) {
                        Button("Retry",  action: onRetry).font(.system(size: 14, weight: .semibold))
                        Button("Remove", role: .destructive, action: onRemove).font(.system(size: 14))
                    }
                    .padding(.top, 2)
                }
            }
            Spacer()
            trailing
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 5, y: 2)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }

    private var thumbnail: some View {
        Image(uiImage: job.thumbnail)
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.black.opacity(0.06), lineWidth: 1)
            )
            .opacity(job.phase == .working ? 0.7 : 1)
    }

    @ViewBuilder
    private var trailing: some View {
        switch job.phase {
        case .working:
            ProgressRing(progress: job.progress)
                .frame(width: 30, height: 30)
        case .done:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 26))
                .foregroundStyle(.green)
        case .needsAttention:
            if isError {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(.orange)
            } else {
                Image(systemName: "pencil.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(Color(hex: "#ff1493"))
            }
        }
    }

    private var isError: Bool { job.phase == .needsAttention && job.errorText != nil }

    private var titleText: String {
        if !job.label.isEmpty { return job.label }
        switch job.phase {
        case .working:        return "New tile"
        case .done:           return "New tile"
        case .needsAttention: return isError ? "Couldn't finish" : "Needs a name"
        }
    }
}

/// A circular progress ring that animates smoothly toward `progress` (0…1).
private struct ProgressRing: View {
    let progress: Double
    var body: some View {
        ZStack {
            Circle()
                .stroke(Color(hex: "#fce4ef"), lineWidth: 4)
            Circle()
                .trim(from: 0, to: max(0.02, progress))
                .stroke(Color(hex: "#ff1493"), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.4), value: progress)
        }
    }
}

// MARK: -- Pre-generation review

/// A freshly-captured single photo held until the parent confirms its name and
/// adds any detail. Identifiable so it drives a `.sheet(item:)`.
struct PendingCapture: Identifiable {
    let id = UUID()
    let data: Data
}

/// "Hold on a second while I give you more info." Shown right after a single
/// capture, BEFORE the slow/costly generation starts, so the parent can:
///   • Override the name (leave blank → the AI auto-labels it), and
///   • Add an optional hint that steers the art ("this is Grandma Sue", "the
///     red cup, not the blue one", "her favorite stuffed bunny").
/// Bulk imports skip this and are reviewed afterward in BatchReviewView.
private struct PreGenerateSheet: View {
    let photoJPEG: Data
    let destination: String
    let onGenerate: (_ name: String, _ detail: String) -> Void
    let onCancel: () -> Void

    @State private var name = ""
    @State private var detail = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let img = UIImage(data: photoJPEG) {
                            Image(uiImage: img)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(maxWidth: .infinity)
                                .frame(maxHeight: 240)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                                .shadow(color: .black.opacity(0.1), radius: 8, y: 3)
                        }

                        label("Where it goes")
                        Text(destination)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color(hex: "#ad1457"))

                        label("Name (optional)")
                        TextField("Leave blank to let us name it", text: $name)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .focused($nameFocused)
                        Text("Spelled how it should sound — that's what's spoken.")
                            .font(.system(size: 12))
                            .foregroundStyle(Color(hex: "#999"))

                        label("Anything we should know? (optional)")
                        TextField("e.g. \"This is Grandma Sue\" or \"the red cup\"",
                                  text: $detail, axis: .vertical)
                            .lineLimit(2...4)
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                        Text("A quick hint helps the art look right — who or what this is.")
                            .font(.system(size: 12))
                            .foregroundStyle(Color(hex: "#999"))
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Make a tile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { onCancel() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Generate") { onGenerate(name, detail) }
                        .font(.system(size: 16, weight: .bold))
                }
            }
            .task {
                // Tiny delay so the keyboard doesn't fight the sheet animation.
                try? await Task.sleep(nanoseconds: 350_000_000)
                nameFocused = true
            }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color(hex: "#999"))
    }
}

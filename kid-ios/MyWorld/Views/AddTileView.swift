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
    var defaultSection: BoardSection = .needs
    var defaultCategoryId: Int?     = nil
    let onDone: () -> Void

    @Environment(BoardStore.self)   private var board
    @Environment(AuthManager.self)  private var auth
    @Environment(AddTileQueue.self) private var queue

    // Batch destination — chosen once, applied to every photo until changed.
    @State private var section: BoardSection = .needs
    @State private var categoryId: Int?
    @State private var style: ArtStyle = .threeD

    // Picker presentation
    @State private var showCamera  = false
    @State private var showLibrary = false
    @State private var libraryItem: PhotosPickerItem?
    // Multi-select bulk import
    @State private var showMultiLibrary = false
    @State private var libraryItems: [PhotosPickerItem] = []
    @State private var importing = false

    @State private var editingJob: TileJob?

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 18) {
                        destinationCard
                        captureButtons
                        bulkImportButton
                        tray
                    }
                    .padding(16)
                    // Attached here (not alongside the camera sheet) so each
                    // view owns a single .sheet — stacking two on one view is
                    // unreliable on older iOS. The library pickers ride along
                    // here too, away from the camera sheet.
                    .photosPicker(isPresented: $showLibrary, selection: $libraryItem, matching: .images)
                    .sheet(item: $editingJob) { job in
                        TileEditSheet(job: job)
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
                    if let data { enqueue(data) }
                }
                .ignoresSafeArea()
            }
            .onChange(of: libraryItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self) { enqueue(data) }
                    libraryItem = nil   // allow picking again immediately
                }
            }
            .onChange(of: libraryItems) { _, picked in
                guard !picked.isEmpty else { return }
                Task { await startBulkImport(picked) }
            }
            .task {
                section = defaultSection
                categoryId = defaultCategoryId
                // Reopening the sheet starts the tray clean, but keep anything
                // still rendering visible so she can watch it land.
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

            HStack(spacing: 12) {
                let folders = board.roots(in: section)
                if !folders.isEmpty {
                    Menu {
                        Button("Top level") { categoryId = nil }
                        ForEach(folders, id: \.id) { c in
                            Button(c.label) { categoryId = c.id }
                        }
                    } label: {
                        menuChip(icon: "folder", text: folderName(folders))
                    }
                }
                Menu {
                    ForEach(ArtStyle.allCases) { s in
                        Button(s.label) { style = s }
                    }
                } label: {
                    menuChip(icon: "paintpalette", text: style.label)
                }
                Spacer()
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

            Button { showLibrary = true } label: {
                captureLabel(icon: "photo.on.rectangle", text: "Choose photo", filled: false)
            }
            .buttonStyle(.plain)
        }
    }

    private var bulkImportButton: some View {
        Button { showMultiLibrary = true } label: {
            HStack(spacing: 10) {
                if importing {
                    ProgressView().tint(Color(hex: "#ad1457"))
                    Text("Loading photos…")
                } else {
                    Image(systemName: "square.grid.2x2.fill")
                    Text("Add several from Photos")
                }
            }
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(Color(hex: "#ad1457"))
            .background(Color(hex: "#fce4ef"))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(importing)
        // Attached to its own button (separate view) so the multi-select picker
        // doesn't share a view with the single-photo picker.
        .photosPicker(isPresented: $showMultiLibrary, selection: $libraryItems,
                      maxSelectionCount: 50, matching: .images)
    }

    private func captureLabel(icon: String, text: String, filled: Bool) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 26))
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

    private func enqueue(_ data: Data) {
        queue.enqueue(photoJPEG: data,
                      section: section,
                      categoryId: categoryId,
                      style: style,
                      emotion: "default",
                      prefilledLabel: "",
                      childId: auth.childSlug,
                      board: board)
    }

    /// Load every picked photo's bytes, downscale, and hand the whole set to the
    /// queue as one reviewable batch. The picker hands back lightweight item
    /// references; the actual image bytes load here.
    private func startBulkImport(_ items: [PhotosPickerItem]) async {
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
        queue.enqueueBatch(photos: photos,
                           section: section,
                           categoryId: categoryId,
                           style: style,
                           emotion: "default",
                           childId: auth.childSlug,
                           board: board)
    }

    private func folderName(_ folders: [Category]) -> String {
        guard let id = categoryId, let c = folders.first(where: { $0.id == id }) else { return "Top level" }
        return c.label
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

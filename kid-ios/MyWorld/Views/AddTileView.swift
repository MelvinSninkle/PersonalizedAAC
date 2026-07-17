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
///   ┌─ These tiles go to ────────────────────────────────────────┐
///   │  ◉ Bottom Row · Core words        ○ Left Column · People    │
///   │  ○ Middle Column · Gestalts…      ○ Right Column · Verbs    │
///   │  Which folder?  [🖼 Food] [🖼 Toys] …  (required for columns)│
///   │  Look: ◉ Board art style   ○ My exact photo                 │
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
    // then applied to every photo until changed. The board only ever RENDERS a
    // tile that lives inside a leaf folder (a category with no sub-folders) —
    // the flat Bottom Row is the one exception — so the picker walks
    // Section → Folder → Sub-folder and the camera stays locked until the
    // destination is somewhere the tile will actually show up.
    @State private var section: BoardSection
    @State private var rootId: Int?
    @State private var subId: Int?
    /// The folder the "+ Add tile" tap came from. Resolved into rootId/subId in
    /// .task — init can't reach the BoardStore Environment to walk the tree.
    private let seedCategoryId: Int?
    /// True = skip the AI restyle and put the photo on the board exactly as
    /// taken (the pipeline's `raw` flag — free on every tier).
    @State private var exactPhoto = false
    // Style + model are no longer user choices here: every styled tile renders
    // in the BOARD's saved art style (server-resolved style guide) and the
    // model is auto-routed server-side (people → GPT keystone, things → nano
    // banana, taxonomy overrides win). The look choice below is only
    // board-style vs the untouched photo.
    @State private var showStyleChange = false
    @State private var magic: MagicCandidate?
    /// True while advanceMagic is prefetching a candidate's impact — stops a
    /// second advance from double-consuming the queue.
    @State private var magicChecking = false
    private let magicApi = APIClient()

    init(defaultSection: BoardSection = .needs, defaultCategoryId: Int? = nil, onDone: @escaping () -> Void) {
        self.onDone = onDone
        _section = State(initialValue: defaultSection)
        self.seedCategoryId = defaultCategoryId
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
                            stylingAllowed: board.stylingAllowed,
                            styledCost: section == .people ? 5 : 1,
                            initialUseAsIs: exactPhoto,
                            onGenerate: { name, detail, raw in
                                pendingCapture = nil
                                enqueue(pending.data, name: name, detail: detail, raw: raw)
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
                // Resolve the seeded folder into the two-level picker: a
                // sub-folder seed selects its parent too.
                if let seed = seedCategoryId,
                   let cat = board.categories.first(where: { $0.id == seed }) {
                    if let parent = cat.parentId { rootId = parent; subId = cat.id }
                    else { rootId = cat.id }
                }
                // Free tier: styling is a membership perk, so the exact photo
                // (free) is the only available look.
                if !board.stylingAllowed { exactPhoto = true }
                // Drop finished cards, then pull any jobs still rendering
                // SERVER-SIDE so they reappear in the tray even after an app
                // restart (they're durable now — the work continues without
                // this device).
                queue.pruneFinished()
                await queue.restore(childId: auth.childSlug, board: board)
                // Re-offer follow-ups the parent left unanswered (any surface,
                // any session) — the server keeps them until answered.
                let pending = await magicApi.storeFollowups(childId: auth.childSlug)
                for f in pending where !queue.magicCandidates.contains(where: { $0.jobId == f.jobId }) {
                    queue.magicCandidates.append(MagicCandidate(
                        itemId: f.itemId, label: f.label, imageKey: f.imageKey,
                        childId: auth.childSlug, jobId: f.jobId,
                        impact: APIClient.ImpactResult(existing: f.existing, affected: f.affected)))
                }
                advanceMagic()
            }
            // Style is a BOARD-level choice; changing it means new tiles won't
            // match what's already there — confirm before handing off to the
            // web style settings (where the rebuild offer lives).
            .confirmationDialog("Change the board's art style?", isPresented: $showStyleChange, titleVisibility: .visible) {
                Button("Open style settings") {
                    if let url = URL(string: "\(APIClient.defaultOrigin)/parent/\(auth.childSlug)?panel=style") {
                        UIApplication.shared.open(url)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Tiles you make after changing the style won't match the board's current look. You can re-make the whole board in the new style afterward (discounted, in the Word Store).")
            }
            // The magic follow-up: a finished tile whose word already exists on
            // the board (offer replace) or appears inside other pictures (offer
            // contextual re-renders). One candidate at a time, FIFO.
            .onChange(of: queue.magicCandidates.count) { _, _ in advanceMagic() }
            .sheet(item: $magic, onDismiss: { advanceMagic() }) { c in
                MagicFollowUpSheet(candidate: c) {
                    // ANSWERED (any button reached the end of the flow) — stop
                    // re-offering. A swipe-dismiss skips this on purpose: the
                    // question stays pending and comes back next visit.
                    if let jobId = c.jobId {
                        Task { await magicApi.storeFollowupDone(childId: c.childId, jobId: jobId) }
                    }
                    magic = nil   // dismissal → onDismiss advances the queue
                }
            }
        }
    }

    /// Pop the next follow-up — but only present the sheet once we KNOW there
    /// is something to ask. The sheet used to open in its loading phase and
    /// instantly self-dismiss when the word had no matches, which read as
    /// "it started to ask me and then just did it". Candidates with nothing
    /// to offer are closed server-side without any UI.
    private func advanceMagic() {
        guard magic == nil, !magicChecking, !queue.magicCandidates.isEmpty else { return }
        magicChecking = true
        var c = queue.magicCandidates.removeFirst()
        Task {
            // (Not `??` — nil-coalescing's right side is an autoclosure, which
            // can't await.)
            var imp = c.impact
            if imp == nil { imp = await magicApi.storeImpact(childId: c.childId, word: c.label) }
            let hasReplace = imp?.existing.map { $0.itemId != c.itemId } ?? false
            let hasRegen = !(imp?.affected.filter { $0.itemId != c.itemId } ?? []).isEmpty
            if let imp, hasReplace || hasRegen {
                c.impact = imp
                magic = c
            } else if let jobId = c.jobId {
                await magicApi.storeFollowupDone(childId: c.childId, jobId: jobId)
            }
            magicChecking = false
            if magic == nil { advanceMagic() }
        }
    }

    // MARK: -- Destination

    private var sectionRoots: [Category] { board.roots(in: section) }
    private var selectedRoot: Category? {
        guard let rootId else { return nil }
        return sectionRoots.first { $0.id == rootId }
    }
    private var subOptions: [Category] { selectedRoot.map { board.children(of: $0) } ?? [] }
    private var selectedSub: Category? {
        guard let subId else { return nil }
        return subOptions.first { $0.id == subId }
    }
    /// The folder new tiles are filed under. The Bottom Row is flat — every
    /// Needs tile renders in the strip — so it takes no folder.
    private var destinationCategoryId: Int? {
        section == .needs ? nil : (subOptions.isEmpty ? rootId : subId)
    }
    /// True only when tiles added right now will actually RENDER on the board:
    /// the Bottom Row always does; a column tile must sit in a leaf folder.
    private var destinationReady: Bool {
        if section == .needs { return true }
        guard selectedRoot != nil else { return false }
        return subOptions.isEmpty || selectedSub != nil
    }

    private var destinationCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("THESE TILES GO TO")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color(hex: "#999"))

            VStack(spacing: 8) {
                ForEach([BoardSection.needs, .people, .nouns, .verbs]) { s in
                    sectionRow(s)
                }
            }
            .onChange(of: section) { _, _ in rootId = nil; subId = nil }

            if section != .needs {
                if sectionRoots.isEmpty {
                    Text("This column has no folders yet — unlock the board and add one there first. Tiles only show up inside a folder.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: "#b45309"))
                } else {
                    Text("WHICH FOLDER?")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color(hex: "#999"))
                    folderRow(sectionRoots, selectedId: rootId) { rootId = $0; subId = nil }
                    if let root = selectedRoot, !subOptions.isEmpty {
                        Text("WHICH FOLDER INSIDE \(root.label.uppercased())?")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color(hex: "#999"))
                        folderRow(subOptions, selectedId: subId) { subId = $0 }
                    }
                }
            }

            if destinationReady {
                Text("New tiles land in the last spot of \(destinationName()).")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: "#999"))
            }

            Text("HOW SHOULD THE PICTURES LOOK?")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color(hex: "#999"))
            HStack(spacing: 10) {
                lookChoice(title: "Board art style",
                           subtitle: board.stylingAllowed
                               ? (section == .people ? "Drawn to match — ⭐5 portrait" : "Drawn to match — ⭐1")
                               : "A membership perk",
                           selected: !exactPhoto,
                           disabled: !board.stylingAllowed) { exactPhoto = false }
                lookChoice(title: "My exact photo",
                           subtitle: "As taken, no restyle — free",
                           selected: exactPhoto) { exactPhoto = true }
            }
            if !exactPhoto && board.stylingAllowed {
                Button { showStyleChange = true } label: {
                    Text("Change the board's art style…")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color(hex: "#ad1457"))
                        .underline()
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    /// One selectable row per board region, named by where it LIVES on the
    /// board (parents don't know the sections' internal names).
    private func sectionRow(_ s: BoardSection) -> some View {
        let selected = section == s
        return Button { section = s } label: {
            HStack(spacing: 10) {
                Image(systemName: sectionGlyph(s))
                    .font(.system(size: 18))
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text(sectionTitle(s))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color(hex: "#333"))
                    Text(sectionSubtitle(s))
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(selected ? Color(hex: "#ff1493") : Color(hex: "#e0c3d2"))
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Color(hex: s.bandHex).opacity(selected ? 1 : 0.35))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .stroke(selected ? Color(hex: "#ff1493") : .clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
    }

    /// A horizontal, ordered rail of folder chips — the same order the child
    /// sees on the board — each wearing the folder's own tile art.
    private func folderRow(_ folders: [Category], selectedId: Int?, pick: @escaping (Int) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(folders) { f in
                    FolderChip(category: f, selected: f.id == selectedId) { pick(f.id) }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func lookChoice(title: String, subtitle: String, selected: Bool,
                            disabled: Bool = false, pick: @escaping () -> Void) -> some View {
        Button(action: pick) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? Color(hex: "#ff1493") : Color(hex: "#e0c3d2"))
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color(hex: "#333"))
                }
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(selected ? Color(hex: "#fce4ef") : Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .stroke(selected ? Color(hex: "#ff1493") : Color(hex: "#f3c6dd"), lineWidth: selected ? 2 : 1.5))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.45 : 1)
    }

    // MARK: -- Capture

    private var captureButtons: some View {
        // Locked until the destination is a spot that actually renders — a tile
        // added "nowhere" (no folder, or a folder that only holds sub-folders)
        // would be invisible on the board.
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Button { showCamera = true } label: {
                    captureLabel(icon: "camera.fill", text: "Take a photo", filled: true)
                }
                .buttonStyle(.plain)
                .disabled(importing || !destinationReady)

                // One button for the library: pick a single photo or many. One photo
                // → a single tile; several → a reviewable batch.
                Button { showLibrary = true } label: {
                    captureLabel(icon: importing ? nil : "photo.on.rectangle",
                                 text: importing ? "Loading…" : "Choose photo(s)",
                                 filled: false, busy: importing)
                }
                .buttonStyle(.plain)
                .disabled(importing || !destinationReady)
            }
            .opacity(destinationReady ? 1 : 0.45)

            if !destinationReady {
                Text(rootId == nil
                     ? "Pick a folder above first — tiles only show up on the board inside a folder."
                     : "\(selectedRoot?.label ?? "That folder") holds sub-folders — pick one, so the tile has a spot the board can show.")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(hex: "#b45309"))
                    .multilineTextAlignment(.center)
            }
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
    private func enqueue(_ data: Data, name: String = "", detail: String = "", raw: Bool = false) {
        queue.enqueue(photoJPEG: data,
                      section: section,
                      categoryId: destinationCategoryId,
                      style: .soft,
                      model: "",
                      bg: "",
                      emotion: "default",
                      raw: raw,
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
                               categoryId: destinationCategoryId,
                               style: .soft,
                               model: "",
                               bg: "",
                               emotion: "default",
                               raw: exactPhoto,
                               childId: auth.childSlug,
                               board: board)
        }
    }

    /// Human-readable "Middle Column › Food › Snacks" destination for the
    /// pre-gen sheet header, so the parent confirms placement before the tile
    /// generates.
    private func destinationName() -> String {
        var parts = [sectionTitle(section)]
        if let root = selectedRoot { parts.append(root.label) }
        if let sub = selectedSub { parts.append(sub.label) }
        return parts.joined(separator: " › ")
    }

    /// Board-position names — parents think in "where on the board", not in the
    /// sections' internal vocabulary.
    private func sectionTitle(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "Bottom Row"
        case .people: return "Left Column"
        case .nouns:  return "Middle Column"
        case .verbs:  return "Right Column"
        }
    }

    private func sectionSubtitle(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "Core words — always visible along the bottom"
        case .people: return "People"
        case .nouns:  return "Gestalts, nouns & adjectives"
        case .verbs:  return "Verbs"
        }
    }

    private func sectionGlyph(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "rectangle.bottomthird.inset.filled"
        case .people: return "rectangle.lefthalf.inset.filled"
        case .nouns:  return "rectangle.center.inset.filled"
        case .verbs:  return "rectangle.righthalf.inset.filled"
        }
    }
}

/// One folder in the destination rail: the folder's own tile art (async via
/// MediaCache) over its name, with a pink ring when selected. Shared with the
/// edit sheets' PlacementPicker (TileEditSheet.swift) — same look everywhere
/// a parent picks a folder.
struct FolderChip: View {
    let category: Category
    let selected: Bool
    let action: () -> Void
    @State private var icon: UIImage?

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Group {
                    if let icon {
                        Image(uiImage: icon).resizable().aspectRatio(contentMode: .fill)
                    } else {
                        ZStack {
                            Color(hex: "#fdf2f8")
                            Image(systemName: "folder.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(Color(hex: "#e0a3c2"))
                        }
                    }
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12)
                    .stroke(selected ? Color(hex: "#ff1493") : Color(hex: "#f3c6dd"),
                            lineWidth: selected ? 3 : 1.5))
                Text(category.label)
                    .font(.system(size: 12, weight: selected ? .bold : .semibold))
                    .foregroundStyle(selected ? Color(hex: "#ad1457") : Color(hex: "#666"))
                    .lineLimit(1)
            }
            .frame(width: 72)
        }
        .buttonStyle(.plain)
        .task(id: category.imageKey) {
            if let key = category.imageKey {
                icon = await MediaCache.shared.image(for: key, maxPixel: 256)
            }
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

    @State private var finishedArt: UIImage?

    private var thumbnail: some View {
        Image(uiImage: finishedArt ?? job.thumbnail)
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.black.opacity(0.06), lineWidth: 1)
            )
            .opacity(job.phase == .working ? 0.7 : 1)
            // Once the server finishes, swap the captured photo for the tile art.
            .task(id: job.generatedImageKey) {
                guard let key = job.generatedImageKey else { return }
                finishedArt = await MediaCache.shared.image(for: key, maxPixel: 320)
            }
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
    /// False on the free tier: styling is a membership perk, so the sheet
    /// locks to "use my photo as-is" (free on every plan) with a join note.
    var stylingAllowed: Bool = true
    /// Confirm-before-spend: what the styled render costs (people = the
    /// ⭐5 keystone portrait, everything else ⭐1). Server-enforced regardless.
    var styledCost: Int = 1
    /// Seeds the as-is toggle from the destination card's look choice, so a
    /// parent who already said "my exact photo" doesn't have to say it twice.
    var initialUseAsIs: Bool = false
    @State private var confirmSpend = false
    let onGenerate: (_ name: String, _ detail: String, _ raw: Bool) -> Void
    let onCancel: () -> Void

    @State private var name = ""
    @State private var detail = ""
    /// True = skip the AI restyle entirely and put the photo on the board
    /// exactly as taken (free — no credit spent).
    @State private var useAsIs = false
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

                        Toggle(isOn: $useAsIs) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Use my photo as-is")
                                    .font(.system(size: 15, weight: .semibold))
                                Text("No restyle — the photo itself becomes the tile. Free.")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Color(hex: "#999"))
                            }
                        }
                        .tint(Color(hex: "#ff1493"))
                        .padding(.top, 4)
                        .disabled(!stylingAllowed)

                        if !stylingAllowed {
                            // Free tier: the photo still lands (as-is, free) —
                            // and here's what a membership would add.
                            (Text("✨ Want this drawn in your child's art style? ")
                                .fontWeight(.bold)
                             + Text("Styled tiles are part of My World memberships, from $4.99/month — join in the parent app under Credits & Store. Everything you've already made is yours forever."))
                                .font(.system(size: 12))
                                .foregroundStyle(Color(hex: "#ad1457"))
                                .padding(12)
                                .background(Color(hex: "#fce4ec"), in: RoundedRectangle(cornerRadius: 12))
                        }
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
                    Button(useAsIs ? "Add photo" : "Generate · ⭐\(styledCost)") {
                        if useAsIs { onGenerate(name, detail, true) } else { confirmSpend = true }
                    }
                    .font(.system(size: 16, weight: .bold))
                }
            }
            .task {
                useAsIs = initialUseAsIs
                if !stylingAllowed { useAsIs = true }   // free tier: as-is is the (locked) default
                // Tiny delay so the keyboard doesn't fight the sheet animation.
                try? await Task.sleep(nanoseconds: 350_000_000)
                nameFocused = true
            }
            // Confirm-before-spend rule: a styled render states its cost first.
            .alert("Use ⭐\(styledCost)?", isPresented: $confirmSpend) {
                Button("OK") { onGenerate(name, detail, false) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Drawing this in the board's art style uses ⭐\(styledCost). \u{201C}Use my photo as-is\u{201D} is free.")
            }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color(hex: "#999"))
    }
}

// MARK: -- Magic follow-up (replace-existing / remake-related)

/// After a photo tile finishes, this sheet closes the loop the parent didn't
/// know to ask for:
///   1. REPLACE — the word already exists on the board: offer to swap the old
///      art (classic default or custom) for the new picture. Default action is
///      Replace; the old image is archived in the Album, never deleted.
///   2. REMAKE — other pictures on the board mention this word in their prompts
///      (curated objects_present index): offer to re-render them WITH the new
///      tile in the scene. 1 credit each, all pre-selected, paged past 20.
/// Lives in this file so no xcodegen re-run is needed.
private struct MagicFollowUpSheet: View {
    let candidate: MagicCandidate
    let onDone: () -> Void

    @Environment(BoardStore.self)  private var board
    @Environment(AuthManager.self) private var auth

    private enum Phase { case loading, replace, regen, done }
    @State private var phase: Phase = .loading
    @State private var impact: APIClient.ImpactResult?
    @State private var selected: Set<String> = []
    @State private var page = 0
    @State private var busy = false
    @State private var note: String?
    /// The board item that ends up holding the new image (regen reference).
    @State private var refItemId: Int = 0

    private let api = APIClient()
    private let pageSize = 20

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .loading: ProgressView("Checking the board…").padding(40)
                case .replace: replaceView
                case .regen:   regenView
                case .done:    doneView
                }
            }
            .navigationTitle(candidate.label.capitalized)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { onDone() } } }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
        .task {
            refItemId = candidate.itemId
            // The presenter prefetches impact and only shows this sheet when
            // there's something to ask — the fetch here is just a fallback.
            // (Not `??` — nil-coalescing's right side is an autoclosure,
            // which can't await.)
            if let pre = candidate.impact {
                impact = pre
            } else {
                impact = await api.storeImpact(childId: candidate.childId, word: candidate.label)
            }
            advance(from: .loading)
        }
    }

    /// Move to the next relevant phase, skipping ones with nothing to show.
    private func advance(from: Phase) {
        if from == .loading, let ex = impact?.existing, ex.itemId != candidate.itemId {
            phase = .replace; return
        }
        if from != .regen, let aff = impact?.affected, !aff.isEmpty {
            selected = Set(aff.map(\.id))     // magic default: all on
            phase = .regen; return
        }
        if note != nil { phase = .done } else { onDone() }
    }

    // MARK: replace

    private var replaceView: some View {
        VStack(spacing: 16) {
            Text("“\(candidate.label.capitalized)” is already on the board")
                .font(.system(size: 20, weight: .heavy, design: .rounded))
            if let ex = impact?.existing {
                HStack(spacing: 18) {
                    VStack(spacing: 6) {
                        MagicThumb(blobKey: ex.imageKey)
                        Text(ex.isDefault ? "Now (classic art)" : "Now (custom picture)")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Image(systemName: "arrow.right").foregroundStyle(.secondary)
                    VStack(spacing: 6) {
                        MagicThumb(blobKey: candidate.imageKey)
                        Text("Your new picture")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                }
                Text(ex.isDefault
                     ? "Swap in your picture? The classic art stays available to every board."
                     : "Swap in your new picture? The current one is archived in the Album — you never lose it.")
                    .font(.system(size: 14)).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if let e = note { Text(e).font(.system(size: 13)).foregroundStyle(.red) }
            HStack(spacing: 12) {
                Button { Task { await doReplace() } } label: {
                    Text(busy ? "Replacing…" : "Replace")
                        .font(.system(size: 16, weight: .bold))
                        .padding(.horizontal, 26).padding(.vertical, 12)
                        .background(Color(hex: "#ff1493")).foregroundStyle(.white)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain).disabled(busy)
                Button("Keep both") { advance(from: .replace) }
                    .font(.system(size: 15, weight: .semibold))
                    .disabled(busy)
            }
        }
        .padding(22)
    }

    private func doReplace() async {
        guard let ex = impact?.existing else { advance(from: .replace); return }
        busy = true
        defer { busy = false }
        do {
            try await api.storeAdoptImage(childId: candidate.childId,
                                          sourceItemId: candidate.itemId,
                                          targetItemId: ex.itemId)
            refItemId = ex.itemId          // the existing tile now holds the new art
            note = "Replaced — the old picture is archived in the Album."
            await board.refresh(childId: candidate.childId)
            advance(from: .replace)
        } catch {
            note = "Couldn't replace: \(error.localizedDescription)"
        }
    }

    // MARK: regen

    private var regenView: some View {
        let affected = impact?.affected ?? []
        let pages = stride(from: 0, to: affected.count, by: pageSize).map { Array(affected[$0..<min($0 + pageSize, affected.count)]) }
        let current = pages.indices.contains(page) ? pages[page] : []
        return VStack(spacing: 12) {
            Text("Your \(candidate.label) shows up in \(affected.count) other picture\(affected.count == 1 ? "" : "s")")
                .font(.system(size: 18, weight: .heavy, design: .rounded))
                .multilineTextAlignment(.center)
            Text("Remake them so they show YOUR \(candidate.label)? ⭐1 each — replaced art is archived.")
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], spacing: 10) {
                    ForEach(current) { t in
                        let on = selected.contains(t.id)
                        Button {
                            if on { selected.remove(t.id) } else { selected.insert(t.id) }
                        } label: {
                            VStack(spacing: 4) {
                                MagicThumb(blobKey: t.previewKey, side: 80)
                                    .overlay(alignment: .topTrailing) {
                                        Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(on ? Color(hex: "#ff1493") : .secondary)
                                            .background(Circle().fill(.white))
                                            .padding(3)
                                    }
                                Text(t.label).font(.system(size: 11, weight: .semibold)).lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if pages.count > 1 {
                HStack {
                    Button("‹ Back") { page = max(0, page - 1) }.disabled(page == 0)
                    Spacer()
                    Text("Page \(page + 1) of \(pages.count)").font(.system(size: 12)).foregroundStyle(.secondary)
                    Spacer()
                    Button("More ›") { page = min(pages.count - 1, page + 1) }.disabled(page >= pages.count - 1)
                }
                .font(.system(size: 14, weight: .semibold))
            }
            if let e = note, phase == .regen { Text(e).font(.system(size: 12)).foregroundStyle(.secondary) }
            HStack(spacing: 12) {
                Button { Task { await doRegen() } } label: {
                    Text(busy ? "Queuing…" : "Remake \(selected.count) (⭐\(selected.count))")
                        .font(.system(size: 16, weight: .bold))
                        .padding(.horizontal, 22).padding(.vertical, 12)
                        .background(Color(hex: "#ff1493")).foregroundStyle(.white)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain).disabled(busy || selected.isEmpty)
                Button("Not now") { onDone() }
                    .font(.system(size: 15, weight: .semibold)).disabled(busy)
            }
        }
        .padding(18)
    }

    private func doRegen() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.storeRegenWith(childId: candidate.childId,
                                                 taxonomyIds: Array(selected),
                                                 refItemId: refItemId)
            note = r.note ?? "\(r.queued) pictures re-rendering — they pop in over the next few minutes."
            phase = .done
        } catch let APIError.badStatus(status, body) {
            note = (status == 402 || body.contains("not_enough_credits"))
                ? "Not enough credits — add a pack in Credits & Store, then try again."
                : "Couldn't queue: \(String(body.prefix(120)))"
        } catch {
            note = "Couldn't queue: \(error.localizedDescription)"
        }
    }

    private var doneView: some View {
        VStack(spacing: 14) {
            Text("✨").font(.system(size: 44))
            Text(note ?? "All set!")
                .font(.system(size: 15, weight: .semibold))
                .multilineTextAlignment(.center)
            Button("Done") { onDone() }
                .font(.system(size: 16, weight: .bold))
        }
        .padding(30)
    }
}

/// Tiny async thumbnail for the magic sheet (MediaCache-backed).
private struct MagicThumb: View {
    let blobKey: String?
    var side: CGFloat = 110
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                ZStack {
                    Color(hex: "#fdf2f8")
                    Image(systemName: "photo").foregroundStyle(.tertiary)
                }
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6dd"), lineWidth: 2))
        .task(id: blobKey) {
            if let key = blobKey { image = await MediaCache.shared.image(for: key, maxPixel: 320) }
        }
    }
}

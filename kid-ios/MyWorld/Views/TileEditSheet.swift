import SwiftUI
import UIKit
import AVFoundation
import PhotosUI

/// Quick edit for a tile in the Add-Tile tray.
///
/// Two jobs, one sheet:
///   • A finished tile the AI mis-named → fix the label/placement; saving PUTs
///     the existing row (it's already on the board).
///   • A tile the AI couldn't name (vision miss) → type a name; saving creates
///     the row for the first time and drops it on the board.
///
/// TTS speaks straight from the title (phonetic-pronunciation generation was
/// removed — PRD "selection over generation"): if a name sounds wrong, the
/// parent retypes it the way it should sound. The art is already rendered
/// either way, so this is just text + a tap.
struct TileEditSheet: View {
    @Bindable var job: TileJob

    @Environment(\.dismiss)        private var dismiss
    @Environment(BoardStore.self)  private var board
    @Environment(AuthManager.self) private var auth

    @State private var label: String = ""
    @State private var section: BoardSection = .needs
    @State private var rootId: Int?
    @State private var subId: Int?

    @State private var saving = false
    @State private var errorText: String?
    @State private var previewPlayer: AVAudioPlayer?

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let png = job.imagePNG, let img = UIImage(data: png) {
                            Image(uiImage: img)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(maxWidth: .infinity)
                                .frame(maxHeight: 220)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                                .shadow(color: .black.opacity(0.1), radius: 8, y: 3)
                        }

                        field("Tile name")
                        HStack {
                            TextField("e.g. Banana", text: $label)
                                .textFieldStyle(.roundedBorder)
                                .textInputAutocapitalization(.words)
                                .autocorrectionDisabled()
                            // Tap to hear how it'll be spoken. If it sounds
                            // wrong, retype the name the way it should sound —
                            // there's no separate pronunciation field anymore.
                            Button {
                                Task { await previewVoice() }
                            } label: {
                                Image(systemName: "play.circle.fill")
                                    .font(.system(size: 30))
                                    .foregroundStyle(Color(hex: "#ff1493"))
                            }
                            .buttonStyle(.plain)
                        }
                        Text("Tap ▶ to hear it. If it sounds off, just spell the name how it should sound.")
                            .font(.system(size: 12))
                            .foregroundStyle(Color(hex: "#999"))

                        field("Where on the board")
                        PlacementPicker(section: $section, rootId: $rootId, subId: $subId,
                                        homeSection: job.section, homeCategoryId: job.categoryId)

                        if let errorText {
                            Text(errorText).font(.system(size: 14)).foregroundStyle(.red)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle(job.savedTileId == nil ? "Name this tile" : "Edit tile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .font(.system(size: 16, weight: .bold))
                            .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .task {
                label   = job.label
                section = job.section
                let home = placementHome(board, categoryId: job.categoryId)
                rootId = home.root
                subId  = home.sub
            }
        }
    }

    // MARK: -- Actions

    @MainActor
    private func previewVoice() async {
        let text = label.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        do {
            let mp3 = try await api.synthesizeSpeech(text: text, emotion: job.emotion, childId: auth.childSlug)
            job.soundMP3 = mp3
            let player = try AVAudioPlayer(data: mp3)
            player.prepareToPlay(); player.play()
            previewPlayer = player
        } catch {
            errorText = friendly(error)
        }
    }

    @MainActor
    private func save() async {
        let trimmedLabel = label.trimmingCharacters(in: .whitespaces)
        guard !trimmedLabel.isEmpty else { return }
        // Same rule as the add flow: a column tile only renders inside a leaf
        // folder, so don't let a save file it somewhere invisible.
        let effectiveCategory = placementEffectiveCategory(board, section: section, rootId: rootId, subId: subId)
        if section != .needs && effectiveCategory == nil {
            errorText = "Pick a folder above — tiles only show up on the board inside a folder."
            return
        }
        saving = true
        errorText = nil
        defer { saving = false }
        do {
            // Re-voice only when the spoken text actually changed (or we never
            // had a voice) — saves a TTS round-trip on a pure placement change.
            let speak = trimmedLabel
            let textChanged = trimmedLabel != job.label
            var soundKey: String?
            if job.soundMP3 == nil || textChanged {
                let mp3 = try await api.synthesizeSpeech(text: speak, emotion: job.emotion, childId: auth.childSlug)
                job.soundMP3 = mp3
                soundKey = try await api.uploadBlob(mp3, kind: "item-sound", ext: "mp3", contentType: "audio/mpeg")
            }

            if let tileId = job.savedTileId {
                _ = try await api.updateItem(id: tileId,
                                             label: trimmedLabel,
                                             section: section.rawValue,
                                             category: .set(effectiveCategory),
                                             soundKey: soundKey,
                                             childId: auth.childSlug)
            } else {
                guard let png = job.imagePNG else { throw APIError.invalidResponse }
                let imageKey = try await api.uploadBlob(png, kind: "item-image", ext: "png", contentType: "image/png")
                // First save must carry a sound even if the text was "unchanged"
                // from the empty default.
                let sKey: String
                if let soundKey { sKey = soundKey }
                else {
                    let mp3 = try await api.synthesizeSpeech(text: speak, emotion: job.emotion, childId: auth.childSlug)
                    sKey = try await api.uploadBlob(mp3, kind: "item-sound", ext: "mp3", contentType: "audio/mpeg")
                }
                let tile = try await api.createItem(section: section.rawValue,
                                                    categoryId: effectiveCategory,
                                                    label: trimmedLabel,
                                                    imageKey: imageKey,
                                                    soundKey: sKey,
                                                    keepAspect: false,
                                                    description: nil,
                                                    childId: auth.childSlug)
                job.savedTileId = tile.id
            }

            // Reflect the edit back onto the tray card.
            job.label = trimmedLabel
            job.section = section
            job.categoryId = effectiveCategory
            job.phase = .done
            job.progress = 1.0
            job.errorText = nil
            job.statusText = "✅ On the board"

            await board.refresh(childId: auth.childSlug)
            dismiss()
        } catch {
            errorText = friendly(error)
        }
    }

    // MARK: -- Helpers

    private func field(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color(hex: "#999"))
    }

    private func friendly(_ error: Error) -> String {
        if let api = error as? APIError {
            switch api {
            case .badStatus(let status, let body):
                if status == 402 || body.contains("not_enough_credits") {
                    return "You're out of image credits. Open Credits & Store on the parent home to add more, then retry."
                }
                return body.isEmpty ? "Server error." : String(body.prefix(160))
            case .notAuthenticated: return "Signed out — log in and try again."
            case .transport(let e): return "Network problem: \(e.localizedDescription)"
            case .invalidResponse:  return "Unexpected server response."
            case .decoding:         return "Couldn't read the server's response."
            }
        }
        return error.localizedDescription
    }
}

// MARK: -- Board tile editor

/// Full editor for a tile that's ALREADY on the board — the native match to the
/// web dashboard's "edit item" modal. Reachable by tapping a tile while the
/// board is unlocked (edit mode), so the parent finally has the same edit powers
/// in the app as on the web. Lets a parent:
///   • rename it (TTS speaks the title — there's no separate pronunciation),
///   • change the picture (new photo → AI art, or use the photo as-is) and
///     toggle keep-aspect,
///   • re-record the voice with an emotion preset,
///   • pin it to the top (People only),
///   • move it to another section / folder,
///   • set the Auditory-Comprehension description, or
///   • delete it.
///
/// Lives in this already-tracked file (not its own) so it builds without
/// re-running `xcodegen generate` for a brand-new file.
struct BoardTileEditSheet: View {
    let tile: Tile

    @Environment(\.dismiss)        private var dismiss
    @Environment(BoardStore.self)  private var board
    @Environment(AuthManager.self) private var auth

    @State private var label = ""
    @State private var section: BoardSection = .nouns
    @State private var rootId: Int?
    @State private var subId: Int?
    @State private var keepAspect = false
    @State private var pinned = false
    @State private var descriptionText = ""
    @State private var emotion = "default"

    // Picture staging: a freshly captured/picked raw photo awaiting the
    // "generate vs. use as-is" choice, then the final bytes we'll upload.
    @State private var newPhoto: Data?
    @State private var stagedImage: Data?
    @State private var stagedImageExt = "png"
    @State private var stagedImageCT  = "image/png"
    @State private var generating = false
    @State private var confirmDraw = false

    // Voice staging — a re-recorded clip to upload on save.
    @State private var stagedSound: Data?

    @State private var currentImage: UIImage?
    @State private var showCamera = false
    @State private var showLibrary = false
    @State private var redrawing = false
    @State private var redrawNote: String?
    /// Guided-retry sheet: the redraw button asks WHAT to change (required)
    /// before spending the retry — a blind re-roll wastes the credit.
    @State private var showRedrawSheet = false
    @State private var redrawGuidance = ""
    @State private var redrawGuidanceError: String?
    @State private var libraryItem: PhotosPickerItem?
    // Adjust framing: drag/zoom the picture inside a tile-shaped square and
    // bake exactly that square (the old picture is archived server-side).
    @State private var showFraming = false
    @State private var framingSource: UIImage?
    @State private var saving = false
    @State private var errorText: String?
    @State private var showDeleteConfirm = false
    @State private var previewPlayer: AVAudioPlayer?

    private let api = APIClient()
    private let emotions = ["default", "happy", "sad", "excited", "calm", "whisper"]

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        imageSection
                        nameSection
                        voiceSection
                        placementSection
                        if section == .people { pinSection }
                        descriptionSection
                        if let errorText {
                            Text(errorText).font(.system(size: 14)).foregroundStyle(.red)
                        }
                        deleteButton
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Edit tile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .font(.system(size: 16, weight: .bold))
                            .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || generating)
                    }
                }
            }
            .sheet(isPresented: $showCamera) {
                CameraPicker { data in
                    showCamera = false
                    if let data, let jpeg = downscaleJPEG(data, maxDim: 1024, quality: 0.85) {
                        newPhoto = jpeg; stagedImage = nil
                    }
                }
                .ignoresSafeArea()
            }
            .sheet(isPresented: $showRedrawSheet) { redrawSheet }
            .sheet(isPresented: $showFraming) {
                if let src = framingSource {
                    FramingSheet(source: src) { baked in
                        if let data = baked.jpegData(compressionQuality: 0.9) {
                            stagedImage = data
                            stagedImageExt = "jpg"
                            stagedImageCT = "image/jpeg"
                            newPhoto = nil
                            keepAspect = false   // the whole point is a filled square tile
                        }
                    }
                }
            }
            .photosPicker(isPresented: $showLibrary, selection: $libraryItem, matching: .images)
            .onChange(of: libraryItem) { _, item in
                guard let item else { return }
                Task {
                    if let raw = try? await item.loadTransferable(type: Data.self),
                       let jpeg = downscaleJPEG(raw, maxDim: 1024, quality: 0.85) {
                        newPhoto = jpeg; stagedImage = nil
                    }
                    libraryItem = nil
                }
            }
            .confirmationDialog("Delete this tile?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await deleteTile() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("\"\(tile.label)\" will be removed from the board. This can't be undone.")
            }
            .task { seed(); await loadCurrentImage() }
        }
    }

    // MARK: Sections

    private var imageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            field("Picture")
            // TILE-SHAPED preview: a square, exactly like the board renders,
            // so what you see here is what the tile shows (the old wide box
            // made crop/no-crop look broken — it previewed a shape no tile
            // ever has).
            HStack {
                Spacer(minLength: 0)
                ZStack {
                    RoundedRectangle(cornerRadius: 16).fill(Color.white)
                    if let staged = stagedImage, let img = UIImage(data: staged) {
                        Image(uiImage: img).resizable()
                            .aspectRatio(contentMode: keepAspect ? .fit : .fill)
                    } else if let np = newPhoto, let img = UIImage(data: np) {
                        Image(uiImage: img).resizable().aspectRatio(contentMode: .fit)
                    } else if let cur = currentImage {
                        Image(uiImage: cur).resizable()
                            .aspectRatio(contentMode: keepAspect ? .fit : .fill)
                    } else {
                        Image(systemName: "photo").font(.largeTitle).foregroundStyle(.tertiary)
                    }
                }
                .frame(width: 200, height: 200)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.black.opacity(0.08)))
                Spacer(minLength: 0)
            }

            if newPhoto != nil {
                // A new photo is waiting — the ONE choice every image add
                // gets: restyle to the board's saved art style, or keep the
                // photo exactly as taken. No per-tile style or model picking;
                // changing the style is a deliberate act in the parent
                // dashboard's Art style panel.
                HStack(spacing: 10) {
                    Button { confirmDraw = true } label: {
                        pill(generating ? "Generating…" : "Draw in board style · ⭐1", filled: true)
                    }
                    .buttonStyle(.plain).disabled(generating)
                    Button { usePhotoAsIs() } label: {
                        pill("Use photo as-is", filled: false)
                    }
                    .buttonStyle(.plain).disabled(generating)
                }
                Text("Drawn to match the board's art style, so the new picture fits the rest of the tiles.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                    // Confirm-before-spend rule: state the cost, then render.
                    .alert("Use ⭐1?", isPresented: $confirmDraw) {
                        Button("OK") { Task { await generateArt() } }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("Drawing this photo in the board's art style uses ⭐1. \u{201C}Use photo as-is\u{201D} is free.")
                    }
            } else {
                HStack(spacing: 10) {
                    Button { showCamera = true } label: { pill("Take photo", filled: false, icon: "camera.fill") }
                        .buttonStyle(.plain)
                    Button { showLibrary = true } label: { pill("Choose photo", filled: false, icon: "photo.on.rectangle") }
                        .buttonStyle(.plain)
                    // Library words can be re-drawn in the child's style — the
                    // first redo of each tile is free, then 1 credit (server-
                    // enforced; renders in the background and lands on its own).
                    if tile.taxonomySlug != nil {
                        // §8: ONE TAP — regenerates in the child's selected
                        // style automatically; no style hunting, no text.
                        Button { Task { await redrawTile(guidance: "") } } label: {
                            pill(redrawing ? "Redrawing…" : "Match my child's style", filled: false, icon: "sparkles")
                        }
                        .buttonStyle(.plain).disabled(redrawing)
                        Button { redrawGuidance = ""; redrawGuidanceError = nil; showRedrawSheet = true } label: {
                            pill("Fix with a note", filled: false, icon: "wand.and.stars")
                        }
                        .buttonStyle(.plain).disabled(redrawing)
                    }
                }
                if let note = redrawNote {
                    Text(note)
                        .font(.system(size: 12)).foregroundStyle(Color(hex: "#2e7d32"))
                }
                if stagedImage != nil {
                    Text("New picture ready — tap Save to apply.")
                        .font(.system(size: 12)).foregroundStyle(Color(hex: "#2e7d32"))
                }
            }

            if stagedImage != nil || currentImage != nil {
                Button {
                    framingSource = stagedImage.flatMap(UIImage.init(data:)) ?? currentImage
                    if framingSource != nil { showFraming = true }
                } label: { pill("Adjust framing", filled: false, icon: "crop") }
                .buttonStyle(.plain)
                Text("Drag the photo inside a tile-shaped frame to pick exactly what shows. The old picture stays in the album.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
    }

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            field("Name")
            HStack {
                TextField("Tile name", text: $label)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                Button { Task { await previewVoice() } } label: {
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 30)).foregroundStyle(Color(hex: "#ff1493"))
                }
                .buttonStyle(.plain)
            }
            Text("Tap ▶ to hear it. If it sounds off, spell the name how it should sound.")
                .font(.system(size: 12)).foregroundStyle(Color(hex: "#999"))
        }
    }

    private var voiceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            field("Voice")
            HStack(spacing: 10) {
                Menu {
                    ForEach(emotions, id: \.self) { e in
                        Button(e.capitalized) { emotion = e }
                    }
                } label: { menuPill("waveform", emotion.capitalized) }
                Button { Task { await revoice() } } label: {
                    pill(stagedSound == nil ? "Re-record voice" : "Voice updated ✓", filled: false, icon: "mic.fill")
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var placementSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            field("Where on the board")
            PlacementPicker(section: $section, rootId: $rootId, subId: $subId,
                            homeSection: tile.section, homeCategoryId: tile.categoryId)
            if placementChanged {
                if placementReady {
                    Text("Moves to \(placementName()) when you save.")
                        .font(.system(size: 12)).foregroundStyle(Color(hex: "#2e7d32"))
                } else {
                    Text("Pick a folder above to finish the move — tiles only show on the board inside a folder. (Selecting the tile's own spot again keeps it where it is.)")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color(hex: "#b45309"))
                }
            }
        }
    }

    /// The tile's current home resolved into the two-level picker.
    private var placementHomeIds: (root: Int?, sub: Int?) {
        placementHome(board, categoryId: tile.categoryId)
    }
    /// True only when the parent actually moved something in the picker —
    /// an untouched edit must NEVER re-file the tile.
    private var placementChanged: Bool {
        section != tile.section || rootId != placementHomeIds.root || subId != placementHomeIds.sub
    }
    private var placementReady: Bool {
        section == .needs
            || placementEffectiveCategory(board, section: section, rootId: rootId, subId: subId) != nil
    }

    private func placementName() -> String {
        var parts = [placementSectionTitle(section)]
        if section != .needs, let rootId,
           let root = board.roots(in: section).first(where: { $0.id == rootId }) {
            parts.append(root.label)
            if let subId, let sub = board.children(of: root).first(where: { $0.id == subId }) {
                parts.append(sub.label)
            }
        }
        return parts.joined(separator: " › ")
    }

    private var pinSection: some View {
        Toggle("Pin to the top (e.g. for the child)", isOn: $pinned)
            .font(.system(size: 14)).tint(Color(hex: "#ff1493"))
    }

    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            field("Description (optional)")
            TextField("Used in the listening game — e.g. \"lives in a field, four legs, eats grass\"",
                      text: $descriptionText, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
            Text("Spoken as the clue in Auditory Comprehension. Leave blank for the default prompt.")
                .font(.system(size: 12)).foregroundStyle(Color(hex: "#999"))
        }
    }

    private var deleteButton: some View {
        Button(role: .destructive) { showDeleteConfirm = true } label: {
            Label("Delete tile", systemImage: "trash")
                .font(.system(size: 14, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(Color.red.opacity(0.1))
                .foregroundStyle(.red)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .padding(.top, 6)
    }

    // MARK: Actions

    private func seed() {
        label          = tile.label
        section        = tile.section
        let home = placementHome(board, categoryId: tile.categoryId)
        rootId         = home.root
        subId          = home.sub
        keepAspect     = tile.keepAspect
        pinned         = tile.pinned
        descriptionText = tile.description ?? ""
    }

    private func loadCurrentImage() async {
        guard let key = tile.imageKey, !key.isEmpty else { return }
        if let img = await MediaCache.shared.image(for: key) { currentImage = img }
    }

    @MainActor
    private func generateArt() async {
        guard let photo = newPhoto else { return }
        generating = true
        errorText = nil
        defer { generating = false }
        do {
            // Fixed neutral style text — the server attaches the child's
            // saved house-style image and routes the model itself. Per-tile
            // style/model picking is deliberately gone (surface-audit C7).
            let png = try await api.generateImage(photoJPEG: photo,
                                                  label: label.trimmingCharacters(in: .whitespaces),
                                                  style: "picture drawn in the board's art style",
                                                  model: "",
                                                  bg: "",
                                                  childId: auth.childSlug)
            stagedImage = png; stagedImageExt = "png"; stagedImageCT = "image/png"
            newPhoto = nil
        } catch {
            errorText = friendly(error)
        }
    }

    private func usePhotoAsIs() {
        guard let photo = newPhoto else { return }
        // Plain CENTER square crop, matching the web upload path — no
        // automatic blank-space trimming of any kind. Adjust framing picks
        // any other square.
        if let img = UIImage(data: photo), abs(img.size.width - img.size.height) > 1 {
            let side = min(img.size.width, img.size.height)
            let x = ((img.size.width - side) / 2).rounded(.down)
            let y = ((img.size.height - side) / 2).rounded(.down)
            let out = min(1024, side)
            let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
            let k = out / side
            let squared = UIGraphicsImageRenderer(size: CGSize(width: out, height: out), format: fmt).image { _ in
                img.draw(in: CGRect(x: -x * k, y: -y * k,
                                    width: img.size.width * k, height: img.size.height * k))
            }
            if let data = squared.jpegData(compressionQuality: 0.9) {
                stagedImage = data; stagedImageExt = "jpg"; stagedImageCT = "image/jpeg"
                newPhoto = nil
                return
            }
        }
        stagedImage = photo; stagedImageExt = "jpg"; stagedImageCT = "image/jpeg"
        newPhoto = nil
    }

    @MainActor
    private func previewVoice() async {
        let text = label.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        do {
            let mp3 = try await api.synthesizeSpeech(text: text, emotion: emotion, childId: auth.childSlug)
            let player = try AVAudioPlayer(data: mp3)
            player.prepareToPlay(); player.play()
            previewPlayer = player
        } catch { errorText = friendly(error) }
    }

    @MainActor
    private func revoice() async {
        let text = label.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        do {
            let mp3 = try await api.synthesizeSpeech(text: text, emotion: emotion, childId: auth.childSlug)
            stagedSound = mp3
            let player = try AVAudioPlayer(data: mp3)
            player.prepareToPlay(); player.play()
            previewPlayer = player
        } catch { errorText = friendly(error) }
    }

    @MainActor
    private func save() async {
        let newLabel = label.trimmingCharacters(in: .whitespaces)
        guard !newLabel.isEmpty else { return }
        if placementChanged && !placementReady {
            errorText = "Pick a folder above to finish the move — tiles only show on the board inside a folder."
            return
        }
        saving = true; errorText = nil
        defer { saving = false }
        do {
            // Upload any new picture / voice first; send only what changed.
            var imageKey: String?
            if let img = stagedImage {
                imageKey = try await api.uploadBlob(img, kind: "item-image", ext: stagedImageExt, contentType: stagedImageCT)
            }
            let labelChanged = newLabel != tile.label
            var soundKey: String?
            if let mp3 = stagedSound {
                soundKey = try await api.uploadBlob(mp3, kind: "item-sound", ext: "mp3", contentType: "audio/mpeg")
            } else if labelChanged {
                // Renamed without an explicit re-record → re-voice from the new title.
                let mp3 = try await api.synthesizeSpeech(text: newLabel, emotion: emotion, childId: auth.childSlug)
                soundKey = try await api.uploadBlob(mp3, kind: "item-sound", ext: "mp3", contentType: "audio/mpeg")
            }

            let sectionChanged = section != tile.section
            // Placement is sent ONLY when the parent actually moved the tile in
            // the picker. The old menu picker nil-ed the folder on open (its
            // section onChange fired while seeding), so every save of a
            // non-Nouns tile silently re-filed it to the top level.
            let category: APIClient.CategoryUpdate = placementChanged
                ? .set(placementEffectiveCategory(board, section: section, rootId: rootId, subId: subId))
                : .unchanged
            let descTrimmed = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
            let descChanged = descTrimmed != (tile.description ?? "")

            _ = try await api.updateItem(
                id: tile.id,
                label: labelChanged ? newLabel : nil,
                section: sectionChanged ? section.rawValue : nil,
                category: category,
                imageKey: imageKey,
                soundKey: soundKey,
                keepAspect: keepAspect != tile.keepAspect ? keepAspect : nil,
                pinned: pinned != tile.pinned ? pinned : nil,
                description: descChanged ? descTrimmed : nil,
                childId: auth.childSlug)

            await board.refresh(childId: auth.childSlug)
            dismiss()
        } catch {
            errorText = friendly(error)
        }
    }

    @MainActor
    private func deleteTile() async {
        saving = true; errorText = nil
        defer { saving = false }
        do {
            try await api.deleteItem(id: tile.id)
            await board.refresh(childId: auth.childSlug)
            dismiss()
        } catch {
            errorText = friendly(error)
        }
    }

    /// Queue a re-render of this library word in the child's style. The server
    /// gives every tile ONE free redo, then charges a credit; the new art
    /// renders in the background and replaces the tile on a later sync (the
    /// old image is archived to the Album, never deleted).
    private func redrawTile(guidance: String) async {
        redrawing = true; errorText = nil; redrawNote = nil
        defer { redrawing = false }
        do {
            let r = try await api.storeRetry(childId: auth.childSlug, itemId: tile.id, guidance: guidance)
            redrawNote = (r.freeRetry == true)
                ? "Redrawing now (free) — the new picture lands on the board in a minute or two."
                : "Redrawing now (⭐\(r.charged)) — the new picture lands on the board in a minute or two."
        } catch {
            errorText = friendly(error)
        }
    }

    /// Guided-retry sheet: the current image + the parent's correction go to
    /// the model together, so the retry improves THIS picture instead of
    /// rolling fresh dice. Text is required — that's where the value is.
    private var redrawSheet: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                VStack(alignment: .leading, spacing: 14) {
                    Text("WHAT SHOULD BE DIFFERENT?")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color(hex: "#999"))
                    TextField("e.g. \"make the cup red like ours\" or \"remove the extra hand\"",
                              text: $redrawGuidance, axis: .vertical)
                        .lineLimit(3...5)
                        .textFieldStyle(.roundedBorder)
                    Text("We send your current picture plus this note, so the redraw fixes exactly what's wrong instead of starting over.")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(hex: "#999"))
                    if let e = redrawGuidanceError {
                        Text(e)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.red)
                    }
                    Spacer()
                }
                .padding(16)
            }
            .navigationTitle("Redraw picture")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { showRedrawSheet = false }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Redraw") {
                        let g = redrawGuidance.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !g.isEmpty else {
                            redrawGuidanceError = "Tell it what to change first — that's what makes the retry better than a re-roll."
                            return
                        }
                        showRedrawSheet = false
                        Task { await redrawTile(guidance: g) }
                    }
                    .font(.system(size: 16, weight: .bold))
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: Helpers

    private func field(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color(hex: "#999"))
    }

    // A Menu label shaped exactly like an outline pill (same font, height,
    // corner, stroke) so the voice picker matches the button beside it.
    private func menuPill(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
            Text(text).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
        }
        .font(.system(size: 14, weight: .semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 11)
        .foregroundStyle(Color(hex: "#ad1457"))
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#ff1493"), lineWidth: 1.5))
    }

    private func pill(_ text: String, filled: Bool, icon: String? = nil) -> some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon) }
            Text(text)
        }
        .font(.system(size: 14, weight: .semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 11)
        .foregroundStyle(filled ? .white : Color(hex: "#ad1457"))
        .background(filled ? Color(hex: "#ff1493") : Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#ff1493"), lineWidth: filled ? 0 : 1.5))
    }

    private func friendly(_ error: Error) -> String {
        if let api = error as? APIError {
            switch api {
            case .badStatus(let status, let body):
                if status == 402 || body.contains("not_enough_credits") {
                    return "You're out of image credits. Open Credits & Store on the parent home to add more, then retry."
                }
                return body.isEmpty ? "Server error." : String(body.prefix(160))
            case .notAuthenticated: return "Signed out — log in and try again."
            case .transport(let e): return "Network problem: \(e.localizedDescription)"
            case .invalidResponse:  return "Unexpected server response."
            case .decoding:         return "Couldn't read the server's response."
            }
        }
        return error.localizedDescription
    }
}


// MARK: -- Placement picker (shared by both edit sheets)

/// Where a tile's category sits in the two-level picker: its root chip, and
/// the sub chip when the tile lives in a sub-folder.
private func placementHome(_ board: BoardStore, categoryId: Int?) -> (root: Int?, sub: Int?) {
    guard let cid = categoryId,
          let cat = board.categories.first(where: { $0.id == cid }) else { return (nil, nil) }
    if let parent = cat.parentId { return (parent, cid) }
    return (cid, nil)
}

/// The folder a save would file the tile under — AddTileView's
/// destinationCategoryId rule: the flat Bottom Row takes no folder; a root
/// that holds sub-folders resolves to the picked sub (tiles only render
/// inside leaf folders). nil for a column means "not a real spot yet".
private func placementEffectiveCategory(_ board: BoardStore, section: BoardSection,
                                        rootId: Int?, subId: Int?) -> Int? {
    if section == .needs { return nil }
    guard let rootId,
          let root = board.roots(in: section).first(where: { $0.id == rootId }) else { return nil }
    return board.children(of: root).isEmpty ? rootId : subId
}

/// Board-position names — parents think in "where on the board", not the
/// sections' internal vocabulary (same wording as the Add-tiles flow).
private func placementSectionTitle(_ s: BoardSection) -> String {
    switch s {
    case .needs:  return "Bottom Row"
    case .people: return "Left Column"
    case .nouns:  return "Middle Column"
    case .verbs:  return "Right Column"
    }
}

/// The Add-tiles destination card, reused by the edit sheets: one selectable
/// row per board region, then folder rails wearing each folder's REAL tile
/// art (FolderChip, AddTileView.swift). Selection changes only through taps —
/// no onChange resets — and tapping the tile's own section back restores its
/// original folder, so the picker can never silently re-file a tile.
private struct PlacementPicker: View {
    @Environment(BoardStore.self) private var board
    @Binding var section: BoardSection
    @Binding var rootId: Int?
    @Binding var subId: Int?
    /// The tile's current home — re-selecting this section re-seeds its folder.
    let homeSection: BoardSection
    let homeCategoryId: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(spacing: 8) {
                ForEach([BoardSection.needs, .people, .nouns, .verbs]) { s in
                    sectionRow(s)
                }
            }
            if section != .needs {
                let roots = board.roots(in: section)
                if roots.isEmpty {
                    Text("This column has no folders yet — add one on the board first. Tiles only show up inside a folder.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: "#b45309"))
                } else {
                    caption("Which folder?")
                    rail(roots, selectedId: rootId) { rootId = $0; subId = nil }
                    if let root = roots.first(where: { $0.id == rootId }) {
                        let subs = board.children(of: root)
                        if !subs.isEmpty {
                            caption("Which folder inside \(root.label)?")
                            rail(subs, selectedId: subId) { subId = $0 }
                        }
                    }
                }
            }
        }
    }

    private func sectionRow(_ s: BoardSection) -> some View {
        let selected = section == s
        return Button {
            guard section != s else { return }
            section = s
            // Coming home restores the tile's real folder; another column
            // starts blank so the parent picks a real destination.
            let home = placementHome(board, categoryId: s == homeSection ? homeCategoryId : nil)
            rootId = home.root
            subId  = home.sub
        } label: {
            HStack(spacing: 10) {
                Image(systemName: glyph(s))
                    .font(.system(size: 18))
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text(placementSectionTitle(s))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color(hex: "#333"))
                    Text(subtitle(s))
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
    private func rail(_ folders: [Category], selectedId: Int?, pick: @escaping (Int) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(folders) { f in
                    FolderChip(category: f, selected: f.id == selectedId) { pick(f.id) }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color(hex: "#999"))
    }

    private func subtitle(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "Core words — always visible along the bottom"
        case .people: return "People"
        case .nouns:  return "Gestalts, nouns & adjectives"
        case .verbs:  return "Verbs"
        }
    }

    private func glyph(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "rectangle.bottomthird.inset.filled"
        case .people: return "rectangle.lefthalf.inset.filled"
        case .nouns:  return "rectangle.center.inset.filled"
        case .verbs:  return "rectangle.righthalf.inset.filled"
        }
    }
}


/// Drag/zoom the picture inside a tile-shaped square and bake EXACTLY that
/// square — the native twin of the web board's "Adjust framing" overlay. The
/// math anchors on one scale factor (photo pt → stage pt), so the saved
/// square is precisely what the frame showed; min zoom = cover, so the tile
/// is always filled. Lives in this already-tracked file so it builds without
/// re-running xcodegen.
private struct FramingSheet: View {
    let source: UIImage
    let onUse: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    private let stage: CGFloat = 300
    @State private var zoom: CGFloat = 1
    @State private var ox: CGFloat = 0     // photo top-left relative to the frame (always ≤ 0)
    @State private var oy: CGFloat = 0
    @State private var dragStart: CGPoint?

    private var base: CGFloat { stage / max(1, min(source.size.width, source.size.height)) }

    private func clamp() {
        let dw = source.size.width * base * zoom
        let dh = source.size.height * base * zoom
        ox = min(0, max(stage - dw, ox))
        oy = min(0, max(stage - dh, oy))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("Drag the photo to choose what shows on the tile; zoom to get closer. The old picture stays in the album.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal, 24)
                ZStack(alignment: .topLeading) {
                    Image(uiImage: source)
                        .resizable()
                        .frame(width: source.size.width * base * zoom,
                               height: source.size.height * base * zoom)
                        .offset(x: ox, y: oy)
                }
                .frame(width: stage, height: stage, alignment: .topLeading)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: "#ff1493").opacity(0.7), lineWidth: 2))
                .contentShape(Rectangle())
                .gesture(
                    DragGesture()
                        .onChanged { v in
                            if dragStart == nil { dragStart = CGPoint(x: ox, y: oy) }
                            ox = (dragStart?.x ?? 0) + v.translation.width
                            oy = (dragStart?.y ?? 0) + v.translation.height
                            clamp()
                        }
                        .onEnded { _ in dragStart = nil }
                )
                HStack(spacing: 10) {
                    Image(systemName: "minus.magnifyingglass").foregroundStyle(.secondary)
                    Slider(value: Binding(
                        get: { zoom },
                        set: { z in
                            // Keep the frame's center pointing at the same spot.
                            let cx = (stage / 2 - ox) / (base * zoom)
                            let cy = (stage / 2 - oy) / (base * zoom)
                            zoom = min(3, max(1, z))
                            ox = stage / 2 - cx * base * zoom
                            oy = stage / 2 - cy * base * zoom
                            clamp()
                        }), in: 1...3)
                    Image(systemName: "plus.magnifyingglass").foregroundStyle(.secondary)
                }
                .padding(.horizontal, 28)
                Spacer()
            }
            .padding(.top, 18)
            .navigationTitle("Adjust framing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use this framing") { onUse(baked()); dismiss() }
                }
            }
            .onAppear {
                ox = (stage - source.size.width * base) / 2   // start centered — what cover shows today
                oy = (stage - source.size.height * base) / 2
                clamp()
            }
        }
    }

    /// Render exactly the framed square. scale maps photo pt → stage pt; the
    /// crop rect is the stage square seen through that scale.
    private func baked() -> UIImage {
        let scale = base * zoom
        let side = stage / scale
        let out = max(256, min(1024, side.rounded()))
        let k = out / side
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: out, height: out), format: fmt)
        return renderer.image { _ in
            source.draw(in: CGRect(x: ox / scale * k, y: oy / scale * k,
                                   width: source.size.width * k,
                                   height: source.size.height * k))
        }
    }
}

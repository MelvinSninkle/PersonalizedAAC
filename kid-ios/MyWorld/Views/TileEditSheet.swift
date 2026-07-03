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
    @State private var categoryId: Int?

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
                        Picker("Section", selection: $section) {
                            ForEach([BoardSection.needs, .people, .nouns, .verbs]) { s in
                                Text(sectionLabel(s)).tag(s)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: section) { _, _ in categoryId = nil }

                        let folders = folderRows(board, section)
                        if !folders.isEmpty {
                            Picker("Folder", selection: $categoryId) {
                                Text("Top level").tag(Int?.none)
                                ForEach(folders) { c in
                                    Text(c.label).tag(Int?.some(c.id))
                                }
                            }
                            .pickerStyle(.menu)
                        }

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
                label      = job.label
                section    = job.section
                categoryId = job.categoryId
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
                                             category: .set(categoryId),
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
                                                    categoryId: categoryId,
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
            job.categoryId = categoryId
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

    private func sectionLabel(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "Needs"
        case .people: return "People"
        case .nouns:  return "Nouns"
        case .verbs:  return "Verbs"
        }
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
    @State private var categoryId: Int?
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
    @State private var style: ArtStyle = .threeD
    @State private var model: ImageModel = .nanoBanana
    @State private var bg: TileBackground = .pink
    @State private var generating = false

    // Voice staging — a re-recorded clip to upload on save.
    @State private var stagedSound: Data?

    @State private var currentImage: UIImage?
    @State private var showCamera = false
    @State private var showLibrary = false
    @State private var redrawing = false
    @State private var redrawNote: String?
    @State private var libraryItem: PhotosPickerItem?
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
            .frame(maxWidth: .infinity)
            .frame(height: 200)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.black.opacity(0.08)))

            if newPhoto != nil {
                // A new photo is waiting — pick how to turn it into the tile.
                artControls
                HStack(spacing: 10) {
                    Button { Task { await generateArt() } } label: {
                        pill(generating ? "Generating…" : "Generate art", filled: true)
                    }
                    .buttonStyle(.plain).disabled(generating)
                    Button { usePhotoAsIs() } label: {
                        pill("Use photo as-is", filled: false)
                    }
                    .buttonStyle(.plain).disabled(generating)
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
                        Button { Task { await redrawTile() } } label: {
                            pill(redrawing ? "Redrawing…" : "Redraw picture", filled: false, icon: "wand.and.stars")
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

            Toggle("Keep original ratio (don't crop)", isOn: $keepAspect)
                .font(.system(size: 14))
                .tint(Color(hex: "#ff1493"))
        }
    }

    private var artControls: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                Menu { ForEach(ArtStyle.allCases) { s in Button(s.label) { style = s } } }
                    label: { chip("paintpalette", style.label) }
                Menu { ForEach(ImageModel.allCases) { m in Button(m.label) { model = m } } }
                    label: { chip("wand.and.stars", model.label) }
                Menu { ForEach(TileBackground.allCases) { c in Button(c.label) { bg = c } } }
                    label: { chip("paintbrush.pointed", bg.label) }
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
                } label: { chip("waveform", emotion.capitalized) }
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
            Picker("Section", selection: $section) {
                ForEach([BoardSection.needs, .people, .nouns, .verbs]) { s in
                    Text(sectionLabel(s)).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: section) { _, _ in categoryId = nil }

            let folders = folderRows(board, section)
            if !folders.isEmpty {
                Picker("Folder", selection: $categoryId) {
                    Text("Top level").tag(Int?.none)
                    ForEach(folders) { c in
                        Text(c.label).tag(Int?.some(c.id))
                    }
                }
                .pickerStyle(.menu)
            }
        }
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
                .font(.system(size: 15, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
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
        categoryId     = tile.categoryId
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
            let png = try await api.generateImage(photoJPEG: photo,
                                                  label: label.trimmingCharacters(in: .whitespaces),
                                                  style: style.prompt,
                                                  model: model.apiValue,
                                                  bg: bg.rawValue,
                                                  childId: auth.childSlug)
            stagedImage = png; stagedImageExt = "png"; stagedImageCT = "image/png"
            newPhoto = nil
        } catch {
            errorText = friendly(error)
        }
    }

    private func usePhotoAsIs() {
        guard let photo = newPhoto else { return }
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
            let category: APIClient.CategoryUpdate =
                (sectionChanged || categoryId != tile.categoryId) ? .set(categoryId) : .unchanged
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
    private func redrawTile() async {
        redrawing = true; errorText = nil; redrawNote = nil
        defer { redrawing = false }
        do {
            let r = try await api.storeRetry(childId: auth.childSlug, itemId: tile.id)
            redrawNote = (r.freeRetry == true)
                ? "Redrawing now (free) — the new picture lands on the board in a minute or two."
                : "Redrawing now (⭐\(r.charged)) — the new picture lands on the board in a minute or two."
        } catch {
            errorText = friendly(error)
        }
    }

    // MARK: Helpers

    private func field(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color(hex: "#999"))
    }

    private func chip(_ icon: String, _ text: String) -> some View {
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

    private func sectionLabel(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "Needs"
        case .people: return "People"
        case .nouns:  return "Nouns"
        case .verbs:  return "Verbs"
        }
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


// MARK: -- Folder picker rows

/// Rows for the placement Folder pickers: top-level categories PLUS their
/// subcategories (indented). Tiles usually live IN a subcategory (the board
/// build places them there), so a roots-only picker had no tag matching the
/// tile's categoryId — Xcode's "selection Optional(N) is invalid" warning,
/// with undefined selection behavior (and a save could silently re-file the
/// tile). Including the subs makes every real categoryId a valid tag.
private struct FolderRow: Identifiable {
    let id: Int
    let label: String
}

private func folderRows(_ board: BoardStore, _ section: BoardSection) -> [FolderRow] {
    var out: [FolderRow] = []
    for root in board.roots(in: section) {
        out.append(FolderRow(id: root.id, label: root.label))
        for sub in board.children(of: root) {
            out.append(FolderRow(id: sub.id, label: "— " + sub.label))
        }
    }
    return out
}

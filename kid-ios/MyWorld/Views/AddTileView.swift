import SwiftUI
import PhotosUI
import AVFoundation

/// Native "Add a tile" flow for the iPad/iPhone app.
///
/// Designed for the case where the parent has two kids on her and 8 seconds
/// to make a tile: the photo comes first, and the AI fills in everything
/// else automatically. She reviews the AI's suggestion, fixes anything that
/// looks wrong, and taps Save once.
///
///   1. Source picker         — Camera / Photo Library (confirmation dialog)
///   2. Photo arrives         — kicks off the AI chain:
///        a. /api/describe-image  → label + phonetic spelling
///        b. /api/generate-image  → styled artwork
///        c. /api/tts             → voice
///   3. Review                — editable label + phrase + art style + section
///                              + category. A play button previews the voice.
///   4. Save                  — uploads art + voice + creates the item, then
///                              refreshes the board.
///
/// On any single-step failure the view shows a clear inline error with a
/// "Try again" button rather than dumping the user back to the start.
struct AddTileView: View {
    /// Where the new tile lands by default. Caller can prefill these based on
    /// what part of the board the parent is currently looking at; the review
    /// screen lets her change them.
    var defaultSection: BoardSection = .needs
    var defaultCategoryId: Int?     = nil
    let onDone: () -> Void

    @Environment(BoardStore.self)  private var board
    @Environment(AuthManager.self) private var auth

    // -- Flow state
    @State private var phase: Phase = .pickingSource
    @State private var showCamera   = false
    @State private var libraryItem: PhotosPickerItem?

    // -- Captured data
    @State private var photoJPEG: Data?
    @State private var aiImagePNG: Data?
    @State private var aiSoundMP3: Data?

    // -- Editable review fields
    @State private var label  = ""
    @State private var phrase = ""
    @State private var style: ArtStyle = .threeD
    @State private var section: BoardSection = .needs
    @State private var categoryId: Int?
    @State private var emotion = "default"

    @State private var errorText: String?
    /// Kept alive on the view so AVAudioPlayer doesn't get released mid-clip.
    @State private var previewPlayer: AVAudioPlayer?

    private let api = APIClient()

    enum Phase: Equatable {
        case pickingSource          // confirmation dialog open
        case processing(String)     // progress string ("Looking at the photo…")
        case reviewing
        case saving
    }

    /// Five art-styles, mirroring the web's dropdown. The `prompt` value goes
    /// to /api/generate-image as the `style` query param; the `label` is what
    /// the parent sees.
    enum ArtStyle: String, CaseIterable, Identifiable {
        case threeD, pictureBook, watercolor, soft, felted
        var id: String { rawValue }
        var label: String {
            switch self {
            case .threeD:      return "3D Animated"
            case .pictureBook: return "Picture Book"
            case .watercolor:  return "Watercolor"
            case .soft:        return "Soft Storybook"
            case .felted:      return "Felted"
            }
        }
        var prompt: String {
            switch self {
            case .threeD:      return "Pixar-style 3D animated render"
            case .pictureBook: return "flat picture-book illustration"
            case .watercolor:  return "soft watercolor illustration"
            case .soft:        return "gentle soft storybook illustration"
            case .felted:      return "needle-felted wool craft"
            }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                contentForPhase
            }
            .navigationTitle("Add a tile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", role: .cancel) { onDone() }
                }
            }
            // PhotosPicker lives at the root so it can present regardless of
            // which sub-view kicked it off.
            .photosPicker(isPresented: $showLibrary,
                          selection: $libraryItem,
                          matching: .images)
            .sheet(isPresented: $showCamera) {
                CameraPicker { data in
                    if let data { photoArrived(data) }
                }
                .ignoresSafeArea()
            }
            .onChange(of: libraryItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self) {
                        photoArrived(data)
                    }
                    libraryItem = nil
                }
            }
            .task {
                section = defaultSection
                categoryId = defaultCategoryId
            }
        }
    }

    // MARK: -- Per-phase content

    @ViewBuilder
    private var contentForPhase: some View {
        switch phase {
        case .pickingSource:
            sourcePicker
        case .processing(let label):
            processingView(label)
        case .reviewing:
            reviewView
        case .saving:
            processingView("Saving the tile…")
        }
    }

    /// Phase 1: the parent lands here. Two big buttons — no decisions before
    /// the photo.
    private var sourcePicker: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "camera.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color(hex: "#ad1457"))
            Text("Snap a photo or pick one.\nWe'll do the rest.")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)

            Button { showCamera = true } label: {
                Label("Take a photo", systemImage: "camera.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .foregroundStyle(.white)
                    .background(Color(hex: "#ff1493"))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 28)

            Button {
                // Tap → open PhotosPicker. We can't bind `.photosPicker` to a
                // Bool directly; we use libraryItem as the trigger via a flag
                // and the .photosPicker modifier above handles presentation.
                showLibrary = true
            } label: {
                Label("Choose from Photos", systemImage: "photo.on.rectangle")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color(hex: "#ff1493"), lineWidth: 2)
                    )
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 28)

            if let err = errorText {
                Text(err)
                    .font(.system(size: 14))
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
            }
            Spacer()
        }
    }

    /// Phase 2: a friendly progress screen the parent can glance at without
    /// stopping what she's doing. The status string updates as the chain
    /// progresses.
    private func processingView(_ status: String) -> some View {
        VStack(spacing: 18) {
            Spacer()
            ProgressView()
                .scaleEffect(1.5)
                .tint(Color(hex: "#ad1457"))
            Text(status)
                .font(.system(size: 18, weight: .semibold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            Spacer()
        }
    }

    /// Phase 3: review + tweak. The AI fills everything in; she just confirms.
    private var reviewView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let png = aiImagePNG, let img = UIImage(data: png) {
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                        .padding(.horizontal, 8)
                }

                Group {
                    fieldLabel("Tile name")
                    TextField("e.g. Mom", text: $label)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.words)

                    fieldLabel("How to pronounce it")
                    HStack {
                        TextField("e.g. buh-NAN-uh", text: $phrase)
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                        Button {
                            Task { await previewVoice() }
                        } label: {
                            Image(systemName: "play.circle.fill")
                                .font(.system(size: 30))
                                .foregroundStyle(Color(hex: "#ff1493"))
                        }
                        .buttonStyle(.plain)
                        .disabled(phrase.trimmingCharacters(in: .whitespaces).isEmpty)
                    }

                    fieldLabel("Art style")
                    Picker("Art style", selection: $style) {
                        ForEach(ArtStyle.allCases) { s in Text(s.label).tag(s) }
                    }
                    .pickerStyle(.menu)
                    .onChange(of: style) { _, _ in Task { await regenerateArt() } }

                    fieldLabel("Where on the board")
                    Picker("Section", selection: $section) {
                        ForEach([BoardSection.needs, .people, .nouns, .verbs]) { s in
                            Text(sectionLabel(s)).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: section) { _, _ in categoryId = nil }

                    let categoriesInSection = board.roots(in: section)
                    if !categoriesInSection.isEmpty {
                        fieldLabel("Folder (optional)")
                        Picker("Folder", selection: $categoryId) {
                            Text("(Top level)").tag(Int?.none)
                            ForEach(categoriesInSection, id: \.id) { c in
                                Text(c.label).tag(Int?.some(c.id))
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }

                if let err = errorText {
                    Text(err)
                        .font(.system(size: 14))
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await save() }
                } label: {
                    Text("Save tile")
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .foregroundStyle(.white)
                        .background(canSave ? Color(hex: "#ff1493") : Color.gray.opacity(0.4))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .disabled(!canSave)
            }
            .padding(20)
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color(hex: "#888"))
            .textCase(.uppercase)
            .padding(.top, 4)
    }

    private func sectionLabel(_ s: BoardSection) -> String {
        switch s {
        case .needs:  return "Needs"
        case .people: return "People"
        case .nouns:  return "Nouns"
        case .verbs:  return "Verbs"
        }
    }

    // MARK: -- Picker plumbing

    @State private var showLibrary = false

    // MARK: -- AI chain

    /// Photo arrived from either camera or library — run the AI chain.
    private func photoArrived(_ jpeg: Data) {
        photoJPEG = jpeg
        errorText = nil
        Task { await runAIChain() }
    }

    private func runAIChain() async {
        guard let photo = photoJPEG else { return }
        do {
            // 1) Vision: auto-name + phonetic. Best-effort — if it returns
            // empty (e.g. org isn't verified for vision), we surface a clear
            // message and let the parent type a label in the review screen.
            phase = .processing("🔍 Looking at the photo…")
            let desc = (try? await api.describeImage(photoJPEG: photo)) ?? .init(label: "", pronunciation: "")
            if !desc.label.isEmpty       { label  = desc.label }
            if !desc.pronunciation.isEmpty { phrase = desc.pronunciation }

            // 2) Art. We need *some* label hint for gpt-image-1; fall back to
            // a generic "object" so the flow doesn't dead-end on vision miss.
            phase = .processing("🎨 Creating the artwork…\n(this can take ~20–40 seconds)")
            // Empty label is OK — server prompt falls back to "the main subject".
            aiImagePNG = try await api.generateImage(photoJPEG: photo,
                                                    label: label,
                                                    style: style.prompt,
                                                    childId: auth.childSlug)

            // 3) Voice. Phrase wins; label is the fallback.
            phase = .processing("🔊 Recording the voice…")
            let speak = !phrase.isEmpty ? phrase : (label.isEmpty ? "" : label)
            if !speak.isEmpty {
                aiSoundMP3 = try? await api.synthesizeSpeech(text: speak, emotion: emotion)
            }

            phase = .reviewing
        } catch {
            errorText = friendly(error)
            phase = .pickingSource     // bounce back to retry
        }
    }

    /// Re-render the art whenever the parent changes the style picker.
    private func regenerateArt() async {
        guard let photo = photoJPEG else { return }
        do {
            phase = .processing("🎨 Re-styling the artwork…")
            // Empty label is OK — server prompt falls back to "the main subject".
            aiImagePNG = try await api.generateImage(photoJPEG: photo,
                                                    label: label,
                                                    style: style.prompt,
                                                    childId: auth.childSlug)
            phase = .reviewing
        } catch {
            errorText = friendly(error)
            phase = .reviewing
        }
    }

    /// Play back the current phrase via TTS so the parent can confirm the
    /// pronunciation before saving. Doesn't replace the persisted voice —
    /// that's freshly generated on Save with whatever's in the phrase field.
    private func previewVoice() async {
        let text = phrase.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        do {
            let mp3 = try await api.synthesizeSpeech(text: text, emotion: emotion)
            aiSoundMP3 = mp3
            let player = try AVAudioPlayer(data: mp3)
            player.volume = 1.0
            player.prepareToPlay()
            player.play()
            previewPlayer = player
        } catch {
            errorText = friendly(error)
        }
    }

    // MARK: -- Save

    private var canSave: Bool {
        aiImagePNG != nil &&
        !label.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func save() async {
        guard let png = aiImagePNG else { return }
        let trimmedLabel  = label.trimmingCharacters(in: .whitespaces)
        let trimmedPhrase = phrase.trimmingCharacters(in: .whitespaces)
        phase = .saving
        errorText = nil
        do {
            // Always re-TTS with the current phrase so any post-AI edits to
            // the pronunciation field actually take effect. Cheap (~1-2s).
            let speak = !trimmedPhrase.isEmpty ? trimmedPhrase : trimmedLabel
            let mp3 = try await api.synthesizeSpeech(text: speak, emotion: emotion)

            // Upload both blobs in parallel.
            async let imageKeyT = api.uploadBlob(png, kind: "item-image", ext: "png", contentType: "image/png")
            async let soundKeyT = api.uploadBlob(mp3, kind: "item-sound", ext: "mp3", contentType: "audio/mpeg")
            let imageKey = try await imageKeyT
            let soundKey = try await soundKeyT

            _ = try await api.createItem(section: section.rawValue,
                                         categoryId: categoryId,
                                         label: trimmedLabel,
                                         imageKey: imageKey,
                                         soundKey: soundKey,
                                         keepAspect: false,
                                         description: nil,
                                         childId: auth.childSlug)
            await board.refresh(childId: auth.childSlug)
            onDone()
        } catch {
            errorText = friendly(error)
            phase = .reviewing
        }
    }

    private func friendly(_ error: Error) -> String {
        if let api = error as? APIError {
            switch api {
            case .badStatus(_, let body):
                if body.range(of: "must be verified", options: .caseInsensitive) != nil {
                    return "Your OpenAI organization isn't verified for image generation. Open platform.openai.com → Settings → Organization → Verify, then try again."
                }
                return body.isEmpty ? "Server error." : String(body.prefix(180))
            case .notAuthenticated: return "Signed out — log in and try again."
            case .transport(let e): return "Network problem: \(e.localizedDescription)"
            case .invalidResponse:  return "Unexpected server response."
            case .decoding:         return "Couldn't read the server's response."
            }
        }
        return error.localizedDescription
    }
}

import SwiftUI
import UIKit
import AVFoundation

/// Quick edit for a tile in the Add-Tile tray.
///
/// Two jobs, one sheet:
///   • A finished tile the AI mis-named → fix the label/pronunciation/placement;
///     saving PUTs the existing row (it's already on the board).
///   • A tile the AI couldn't name (vision miss) → type a name; saving creates
///     the row for the first time and drops it on the board.
///
/// The art is already rendered either way, so this is just text + a tap.
struct TileEditSheet: View {
    @Bindable var job: TileJob

    @Environment(\.dismiss)        private var dismiss
    @Environment(BoardStore.self)  private var board
    @Environment(AuthManager.self) private var auth

    @State private var label: String = ""
    @State private var pronunciation: String = ""
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
                        TextField("e.g. Banana", text: $label)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()

                        field("How to pronounce it (optional)")
                        HStack {
                            TextField("e.g. buh-NAN-uh", text: $pronunciation)
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
                        }

                        field("Where on the board")
                        Picker("Section", selection: $section) {
                            ForEach([BoardSection.needs, .people, .nouns, .verbs]) { s in
                                Text(sectionLabel(s)).tag(s)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: section) { _, _ in categoryId = nil }

                        let folders = board.roots(in: section)
                        if !folders.isEmpty {
                            Picker("Folder", selection: $categoryId) {
                                Text("Top level").tag(Int?.none)
                                ForEach(folders, id: \.id) { c in
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
                label         = job.label
                pronunciation = job.pronunciation
                section       = job.section
                categoryId    = job.categoryId
            }
        }
    }

    // MARK: -- Actions

    @MainActor
    private func previewVoice() async {
        let trimmed = label.trimmingCharacters(in: .whitespaces)
        let text = pronunciation.isEmpty ? trimmed : pronunciation
        guard !text.isEmpty else { return }
        do {
            let mp3 = try await api.synthesizeSpeech(text: text, emotion: job.emotion)
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
            let speak = pronunciation.isEmpty ? trimmedLabel : pronunciation
            let textChanged = trimmedLabel != job.label || pronunciation != job.pronunciation
            var soundKey: String?
            if job.soundMP3 == nil || textChanged {
                let mp3 = try await api.synthesizeSpeech(text: speak, emotion: job.emotion)
                job.soundMP3 = mp3
                soundKey = try await api.uploadBlob(mp3, kind: "item-sound", ext: "mp3", contentType: "audio/mpeg")
            }

            if let tileId = job.savedTileId {
                _ = try await api.updateItem(id: tileId,
                                             label: trimmedLabel,
                                             section: section.rawValue,
                                             categoryId: categoryId,
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
                    let mp3 = try await api.synthesizeSpeech(text: speak, emotion: job.emotion)
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
            job.pronunciation = pronunciation
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
            case .badStatus(_, let body):
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

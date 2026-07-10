import SwiftUI
import UIKit
import AVFoundation

/// Review queue for bulk-imported tiles. Every tile flagged `needsReview` (it's
/// already live on the board) shows here with its AI art, a play button for its
/// AI voice, and an editable name. The parent fixes anything the AI got wrong
/// and taps "Save & confirm" once; that re-records the voice for any she
/// renamed and clears the review flag on all of them.
///
/// TTS speaks straight from the title (phonetic-pronunciation generation was
/// removed — PRD "selection over generation"): a name that sounds wrong gets
/// retyped the way it should sound. Her typed name always supersedes the AI's.
struct BatchReviewView: View {
    let onDone: () -> Void

    @Environment(BoardStore.self)  private var board
    @Environment(AuthManager.self) private var auth

    /// One editable line, seeded once from the board so typing isn't clobbered
    /// when the board refreshes underneath us.
    struct Row: Identifiable {
        let id: Int                 // tile id
        let imageKey: String?
        let soundKey: String?
        let originalLabel: String
        var label: String
    }

    @State private var rows: [Row] = []
    @State private var seeded = false
    @State private var saving = false
    @State private var progress = ""
    @State private var errorText: String?

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                if rows.isEmpty {
                    allCaughtUp
                } else {
                    ScrollView {
                        VStack(spacing: 14) {
                            Text("Tap ▶ to hear each voice. Fix any name the AI got wrong — what you type wins.")
                                .font(.system(size: 13))
                                .foregroundStyle(Color(hex: "#888"))
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 8)
                            ForEach($rows) { $row in
                                ReviewRow(row: $row, onRemove: { remove(row) })
                            }
                            if let errorText {
                                Text(errorText).font(.system(size: 14)).foregroundStyle(.red)
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle("Review new tiles")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Later") { onDone() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if saving {
                        HStack(spacing: 6) { ProgressView(); Text(progress).font(.system(size: 12)) }
                    } else if !rows.isEmpty {
                        Button("Save & confirm") { Task { await saveAll() } }
                            .font(.system(size: 16, weight: .bold))
                    }
                }
            }
            .task {
                guard !seeded else { return }
                seeded = true
                rows = board.tiles
                    .filter { $0.needsReview }
                    .sorted { $0.id > $1.id }
                    .map { Row(id: $0.id, imageKey: $0.imageKey, soundKey: $0.soundKey,
                               originalLabel: $0.label, label: $0.label) }
            }
        }
    }

    private var allCaughtUp: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 56)).foregroundStyle(.green)
            Text("All caught up!")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
            Text("Every new tile has been reviewed.")
                .font(.system(size: 15)).foregroundStyle(Color(hex: "#888"))
            Button("Done") { onDone() }
                .font(.system(size: 16, weight: .semibold))
                .padding(.horizontal, 24).padding(.vertical, 10)
                .background(Color(hex: "#ff1493")).foregroundStyle(.white)
                .clipShape(Capsule())
                .padding(.top, 8)
        }
    }

    // MARK: -- Actions

    private func remove(_ row: Row) {
        rows.removeAll { $0.id == row.id }
        Task {
            try? await api.deleteItem(id: row.id)
            await board.refresh(childId: auth.childSlug)
        }
    }

    @MainActor
    private func saveAll() async {
        saving = true
        errorText = nil
        defer { saving = false; progress = "" }
        do {
            for (i, row) in rows.enumerated() {
                progress = "\(i + 1)/\(rows.count)"
                let newLabel = row.label.trimmingCharacters(in: .whitespaces)
                let nameChanged = newLabel != row.originalLabel && !newLabel.isEmpty

                // Re-record the voice only when she renamed it — otherwise keep
                // the AI voice we already made. TTS speaks from the title.
                var soundKey: String?
                if nameChanged {
                    let mp3 = try await api.synthesizeSpeech(text: newLabel, emotion: "default", childId: auth.childSlug)
                    soundKey = try await api.uploadBlob(mp3, kind: "item-sound", ext: "mp3", contentType: "audio/mpeg")
                }
                _ = try await api.updateItem(id: row.id,
                                             label: nameChanged ? newLabel : nil,
                                             soundKey: soundKey,
                                             needsReview: false,
                                             childId: auth.childSlug)
            }
            await board.refresh(childId: auth.childSlug)
            onDone()
        } catch {
            errorText = "Couldn't save: \(error.localizedDescription)"
        }
    }
}

// MARK: -- One review row

private struct ReviewRow: View {
    @Binding var row: BatchReviewView.Row
    let onRemove: () -> Void

    @State private var image: UIImage?
    @State private var player: AVAudioPlayer?
    @State private var loadingAudio = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                artwork
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Name", text: $row.label)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .font(.system(size: 16, weight: .semibold))
                    Text("Spelled how it should sound — that's what's spoken.")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(hex: "#999"))
                }
            }
            HStack(spacing: 16) {
                Button { Task { await playVoice() } } label: {
                    Label(loadingAudio ? "Loading…" : "Hear voice", systemImage: "play.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color(hex: "#ff1493"))
                }
                .buttonStyle(.plain)
                .disabled(loadingAudio)
                Spacer()
                Button(role: .destructive, action: onRemove) {
                    Label("Remove", systemImage: "trash")
                        .font(.system(size: 14))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 5, y: 2)
        .task {
            if let key = row.imageKey { image = await MediaCache.shared.image(for: key, maxPixel: 640) }
        }
    }

    private var artwork: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                Color(hex: "#fce4ef")
                    .overlay(ProgressView())
            }
        }
        .frame(width: 72, height: 72)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func playVoice() async {
        guard let key = row.soundKey, !key.isEmpty else { return }
        loadingAudio = true
        defer { loadingAudio = false }
        do {
            let url = try await MediaCache.shared.audioFileURL(for: key)
            let p = try AVAudioPlayer(contentsOf: url)
            p.prepareToPlay(); p.play()
            player = p
        } catch {
            // Non-fatal — a failed preview shouldn't block the review.
        }
    }
}

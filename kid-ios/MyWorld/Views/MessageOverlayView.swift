import SwiftUI
import AVFoundation

/// Full-screen overlay that renders a "message to the board" (PRD §4.7) as a
/// sequence of tiles: shows each tile's picture for ~holdMs, plays its
/// recorded voice (TTS for words the board doesn't have), then advances. Tap
/// the close pill to skip. Suppressed during games / scheduled prompts so the
/// modal never lands mid-activity.
struct MessageOverlayView: View {
    let tokens: [MessageToken]
    let childId: String
    let onDone: () -> Void

    @State private var index = 0
    @State private var imageData: Data?
    @State private var audioPlayer: AVAudioPlayer?
    @State private var advanceTask: Task<Void, Never>?

    private let api = APIClient()

    var body: some View {
        ZStack {
            Color(hex: "#ad1457").opacity(0.55).ignoresSafeArea()

            VStack(spacing: 18) {
                Spacer()
                if currentToken?.imageKey != nil, let data = imageData, let ui = UIImage(data: data) {
                    Image(uiImage: ui)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: 420, maxHeight: 420)
                        .aspectRatio(1, contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .shadow(color: .black.opacity(0.25), radius: 16, y: 6)
                } else {
                    // Word with no tile → render the word itself big.
                    Text(currentToken?.word ?? "")
                        .font(.system(size: 84, weight: .heavy, design: .rounded))
                        .foregroundStyle(Color(hex: "#ad1457"))
                        .frame(maxWidth: 420, minHeight: 200)
                        .padding()
                        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .shadow(color: .black.opacity(0.18), radius: 14, y: 4)
                }

                Text(currentToken?.word ?? "")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text("\(index + 1) of \(tokens.count)")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.85))

                Spacer()
                Button {
                    finish()
                } label: {
                    Text("Tap to skip")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 10)
                        .background(.white.opacity(0.22), in: Capsule())
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 24)
        }
        .task(id: index) { await playCurrent() }
        .onDisappear {
            advanceTask?.cancel()
            audioPlayer?.stop()
        }
    }

    private var currentToken: MessageToken? {
        guard index >= 0, index < tokens.count else { return nil }
        return tokens[index]
    }

    private func playCurrent() async {
        guard let t = currentToken else { finish(); return }
        imageData = nil
        if let key = t.imageKey {
            imageData = try? await MediaCache.shared.data(for: key)
        }
        // Recorded tile audio first; TTS fallback for text tokens / missing
        // sound files. Failures don't block — the visual still holds the beat.
        var played = false
        if let key = t.soundKey, let data = try? await MediaCache.shared.data(for: key) {
            played = play(data)
        }
        if !played, !t.word.isEmpty {
            if let data = await api.tts(text: t.word) { played = play(data) }
        }
        // Hold the tile for max(audio length, holdMs floor of 600ms).
        let holdMs = max(600.0, t.holdMs ?? 1400.0)
        let audioMs = played ? (audioPlayer?.duration ?? 0) * 1000 : 0
        let total = max(holdMs, audioMs + 250)
        advanceTask?.cancel()
        advanceTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(total * 1_000_000))
            await MainActor.run {
                if index + 1 < tokens.count { index += 1 } else { finish() }
            }
        }
    }

    @discardableResult
    private func play(_ data: Data) -> Bool {
        do {
            let p = try AVAudioPlayer(data: data)
            p.prepareToPlay()
            p.play()
            audioPlayer = p
            return true
        } catch {
            return false
        }
    }

    private func finish() {
        advanceTask?.cancel()
        audioPlayer?.stop()
        onDone()
    }
}

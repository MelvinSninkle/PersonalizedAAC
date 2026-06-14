import SwiftUI
import AVFoundation

/// "Message to the board" (PRD §4.7), rendered as a SENTENCE STRIP — every
/// tile in the message is on screen at once, left-to-right like a sentence
/// the child can read. The tile currently speaking scales up and the strip
/// auto-scrolls to keep it centered, so a long message stays followable while
/// still reading as one continuous thought.
///
/// Tap anywhere to skip.
struct MessageOverlayView: View {
    let tokens: [MessageToken]
    let childId: String
    let onDone: () -> Void

    @State private var index = -1                            // -1 before the first beat
    @State private var audioPlayer: AVAudioPlayer?
    @State private var advanceTask: Task<Void, Never>?

    private let api = APIClient()

    var body: some View {
        ZStack {
            Color(hex: "#ad1457").opacity(0.6).ignoresSafeArea()

            VStack(spacing: 18) {
                Spacer()
                // The sentence strip — auto-scrolls to whichever token is
                // currently speaking so it stays in view on long messages.
                // A GeometryReader gives us the available screen width so the
                // inner HStack can be center-aligned within at-least-screen-
                // width: short messages sit dead center, long ones scroll.
                GeometryReader { geo in
                    ScrollViewReader { proxy in
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .center, spacing: 14) {
                                ForEach(Array(tokens.enumerated()), id: \.offset) { i, t in
                                    tokenView(token: t, active: i == index, position: i)
                                        .id(i)
                                }
                            }
                            .padding(.horizontal, 24)
                            .padding(.vertical, 18)
                            .frame(minWidth: geo.size.width, alignment: .center)
                        }
                        .onChange(of: index) { _, new in
                            guard new >= 0 else { return }
                            withAnimation(.easeInOut(duration: 0.35)) {
                                proxy.scrollTo(new, anchor: .center)
                            }
                        }
                    }
                }
                .frame(maxHeight: 280)

                // Whole-sentence caption so a reading parent can also see the
                // message, with the current word emphasized.
                Text(captionAttributed)
                    .font(.system(size: 20, weight: .medium, design: .rounded))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)

                Spacer()
                Text("Tap to skip")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(.bottom, 30)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { finish() }
        .task { await runSequence() }
        .onDisappear {
            advanceTask?.cancel()
            audioPlayer?.stop()
        }
    }

    private var captionAttributed: AttributedString {
        var out = AttributedString()
        for (i, t) in tokens.enumerated() {
            if i > 0 { out.append(AttributedString(" ")) }
            var piece = AttributedString(t.word)
            if i == index {
                piece.font = .system(size: 22, weight: .bold, design: .rounded)
                piece.foregroundColor = .white
            } else {
                piece.foregroundColor = .white.opacity(0.55)
            }
            out.append(piece)
        }
        return out
    }

    @ViewBuilder
    private func tokenView(token: MessageToken, active: Bool, position: Int) -> some View {
        let size: CGFloat = active ? 200 : 140
        VStack(spacing: 8) {
            Group {
                if let key = token.imageKey {
                    MediaImage(blobKey: key)
                        .aspectRatio(1, contentMode: .fill)
                } else {
                    Text(token.word)
                        .font(.system(size: active ? 36 : 28, weight: .heavy, design: .rounded))
                        .foregroundStyle(Color(hex: "#ad1457"))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(8)
                        .background(Color(hex: "#fce4ec"))
                }
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(active ? Color.white : Color.white.opacity(0.4),
                            lineWidth: active ? 4 : 2)
            )
            .shadow(color: .black.opacity(active ? 0.35 : 0.18),
                    radius: active ? 18 : 8, y: active ? 8 : 3)
            .scaleEffect(active ? 1.0 : 0.92)
            .animation(.spring(response: 0.35, dampingFraction: 0.7), value: active)

            Text(token.word)
                .font(.system(size: active ? 18 : 14, weight: active ? .bold : .semibold,
                              design: .rounded))
                .foregroundStyle(.white.opacity(active ? 1 : 0.7))
                .multilineTextAlignment(.center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: size)
        }
    }

    /// Walk the sentence: highlight each token in turn, play its audio, hold
    /// for max(audio length, holdMs floor). The full strip stays visible the
    /// entire time — only the active tile pulses.
    private func runSequence() async {
        for i in tokens.indices {
            if Task.isCancelled { return }
            await MainActor.run { index = i }
            await playToken(tokens[i])
        }
        // Brief pause on the last word, then dismiss.
        try? await Task.sleep(nanoseconds: 700_000_000)
        finish()
    }

    private func playToken(_ t: MessageToken) async {
        var played = false
        if let key = t.soundKey, let data = try? await MediaCache.shared.data(for: key) {
            played = play(data)
        }
        if !played, !t.word.isEmpty, let data = await api.tts(text: t.word) {
            played = play(data)
        }
        let holdMs = max(700.0, t.holdMs ?? 1400.0)
        let audioMs = played ? (audioPlayer?.duration ?? 0) * 1000 : 0
        let total = max(holdMs, audioMs + 200)
        try? await Task.sleep(nanoseconds: UInt64(total * 1_000_000))
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

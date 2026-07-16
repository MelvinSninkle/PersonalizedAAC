import SwiftUI

/// PRD §4.7 — type a message TO the board: the child sees it as a sequence of
/// their own tiles (and hears it in the board's voice). The server tokenizes
/// against the board greedy-longest ("I love you" = one tile when one exists)
/// and pushes the sequence through the live channel; the response doubles as
/// the preview. Listening mode (the other direction) is its own home card
/// again — ListeningModeView below.
struct MessageBoardView: View {
    @Environment(AuthManager.self) private var auth

    @State private var text = ""
    @State private var sending = false
    @State private var result: APIClient.MessageResult?
    @State private var errorText: String?
    @FocusState private var focused: Bool

    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Your words show up on the board as \(childPossessive(auth.user?.slug)) own tiles, spoken in their tile voices. Words the board doesn't have appear as text.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                TextField("e.g. I love you — see you after lunch", text: $text, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.plain)
                    .padding(12)
                    .background(.white, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
                    .focused($focused)

                Button {
                    Task { await send() }
                } label: {
                    HStack {
                        if sending { ProgressView().tint(.white) }
                        Text(sending ? "Sending…" : "Send to the board")
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color(hex: "#ff1493"), in: RoundedRectangle(cornerRadius: 999))
                    .foregroundStyle(.white)
                }
                .disabled(sending || text.trimmingCharacters(in: .whitespaces).isEmpty)

                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                }

                if let r = result {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Sent — this is how it will play:", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color(hex: "#16a34a"))
                        tokenStrip(r.tokens)
                        Text("\(r.matched) of \(r.total) words matched a tile.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(14)
                    .background(.white, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding(16)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle("Message the board")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { focused = true }
    }

    private func tokenStrip(_ tokens: [APIClient.MessageToken]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(tokens.enumerated()), id: \.offset) { _, t in
                    VStack(spacing: 4) {
                        if let key = t.imageKey {
                            MediaImage(blobKey: key)
                                .frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        } else {
                            Text(t.word)
                                .font(.system(size: 13, weight: .bold, design: .rounded))
                                .frame(width: 64, height: 64)
                                .background(Color(hex: "#fce4ec"), in: RoundedRectangle(cornerRadius: 10))
                        }
                        Text(t.word)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .frame(width: 68)
                }
            }
        }
    }

    private func send() async {
        sending = true
        errorText = nil
        defer { sending = false }
        do {
            result = try await api.sendMessageToBoard(childId: auth.childSlug,
                                                      text: text.trimmingCharacters(in: .whitespaces))
        } catch {
            errorText = "Could not send: \(error.localizedDescription)"
        }
    }
}

/// Listening mode — its own home card (it lived inside Message the board for a
/// while; separate screens read clearer). Sends the remote live command; the
/// board flips its header into the live word-strip and auto-stops after 2 min
/// of silence. Lives in this file so no xcodegen re-run is needed.
struct ListeningModeView: View {
    @Environment(AuthManager.self) private var auth

    @State private var listeningOn = false
    @State private var listenBusy = false

    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Label("Listening mode", systemImage: listeningOn ? "waveform.circle.fill" : "mic.circle.fill")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: listeningOn ? "#ef4444" : "#ad1457"))
                Text(listeningOn
                     ? "The board is captioning live — everything said near the tablet shows as tiles."
                     : "Turn the board into a live word-strip: speech near the tablet becomes tiles as it's said. Audio is processed for live transcription only — no recording is kept — and it stops itself after 2 minutes of quiet. Make sure everyone in the room is okay with it.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button {
                    Task { await toggleListening() }
                } label: {
                    HStack {
                        if listenBusy { ProgressView().tint(.white) }
                        Text(listeningOn ? "Stop listening" : "Start listening on the tablet")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color(hex: listeningOn ? "#ef4444" : "#ad1457"), in: RoundedRectangle(cornerRadius: 999))
                    .foregroundStyle(.white)
                }
                .disabled(listenBusy)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
            .padding(16)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle("Listening mode")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func toggleListening() async {
        guard !listenBusy else { return }
        listenBusy = true
        defer { listenBusy = false }
        let next = !listeningOn
        let ok = await api.sendLiveCommand(childId: auth.childSlug,
                                           action: next ? "listen-start" : "listen-stop")
        if ok { listeningOn = next }
    }
}

/// Tiny async image backed by the shared MediaCache (same cache the board
/// uses, so message previews are usually instant).
///
/// ALWAYS decodes downsampled: a full-res 1024² tile costs ~4 MB of RAM
/// decoded, and screens that show many MediaImages (the Album) jetsammed
/// the app (EXC_RESOURCE high-watermark). Default fits thumbnails/rows;
/// pass a bigger maxPixel for full-screen looks.
struct MediaImage: View {
    let blobKey: String
    var maxPixel: Int = 512
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Color(hex: "#fce4ec")
            }
        }
        .task(id: blobKey) {
            image = await MediaCache.shared.image(for: blobKey, maxPixel: maxPixel)
        }
    }
}

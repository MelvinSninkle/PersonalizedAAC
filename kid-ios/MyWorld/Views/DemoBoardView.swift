import SwiftUI
import AVFoundation

/// #14: the admin/demo test board. Reached by signing in with the literal
/// user ID "admin" plus the server's admin token (validated in
/// api/auth/login.js — the token never ships in this client, and no session
/// cookie exists in this mode). Renders the same public starter-board
/// projection the web practice page uses (GET /api/demo) and swaps art
/// styles live from the header, so a demoer can show one board in every
/// offered style without leaving it. All art and audio serve through the
/// public media prefixes; nothing child-owned is reachable, which is what
/// makes this safe to hand to a therapist.
struct DemoBoardView: View {
    @Environment(AuthManager.self) private var auth

    struct Payload: Decodable {
        struct DemoTile: Decodable {
            let label: String
            let section: String
            let category: String?
            let subcategory: String?
            let imageKey: String?
        }
        struct StyleOpt: Decodable, Hashable { let id: Int; let label: String }
        struct KidOpt: Decodable, Hashable { let id: Int; let label: String }
        struct VoiceOpt: Decodable, Hashable { let id: String; let name: String }
        let tiles: [DemoTile]
        let styles: [StyleOpt]?
        let kids: [KidOpt]?
        let voices: [VoiceOpt]?
    }

    @State private var payload: Payload?
    @State private var styleId: Int?          // nil = Classic (generic default art)
    @State private var kidId: Int?            // nil = the style's main demo kid
    @State private var voiceId: String?
    @State private var loading = true
    @State private var errorText: String?
    @State private var player: AVAudioPlayer?

    private let api = APIClient()

    var body: some View {
        VStack(spacing: 0) {
            header
            if loading && payload == nil {
                Spacer()
                ProgressView("Loading the demo board…")
                Spacer()
            } else if let err = errorText, payload == nil {
                Spacer()
                Text(err).foregroundStyle(.red).padding()
                Button("Try again") { Task { await load() } }
                Spacer()
            } else if let p = payload {
                boardBody(p)
            }
        }
        .background(Color(hex: "#fff7fb"))
        .task(id: "\(styleId ?? 0)|\(kidId ?? 0)") { await load() }
    }

    // MARK: - Header (title, style/kid/voice switchers, exit)

    private var header: some View {
        HStack(spacing: 12) {
            Text("🎨 Demo board")
                .font(.headline)
                .foregroundStyle(.white)
            if let styles = payload?.styles, !styles.isEmpty {
                Menu {
                    Button("Classic") { kidId = nil; styleId = nil }
                    ForEach(styles, id: \.id) { s in
                        Button(s.label) { kidId = nil; styleId = s.id }
                    }
                } label: {
                    pill(label: "Style: \(currentStyleLabel)")
                }
            }
            if let kids = payload?.kids, !kids.isEmpty, styleId != nil {
                Menu {
                    Button("Main kid") { kidId = nil }
                    ForEach(kids, id: \.id) { k in
                        Button(k.label) { kidId = k.id }
                    }
                } label: {
                    pill(label: "Kid: \(currentKidLabel)")
                }
            }
            if let voices = payload?.voices, voices.count > 1 {
                Menu {
                    ForEach(voices, id: \.id) { v in
                        Button(v.name) { voiceId = v.id }
                    }
                } label: {
                    pill(label: "Voice: \(currentVoiceName)")
                }
            }
            if loading && payload != nil {
                ProgressView().tint(.white)
            }
            Spacer()
            Button {
                auth.exitDemo()
            } label: {
                Text("Exit demo")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(Color(hex: "#6a1b4d"), in: Capsule())
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(Color(hex: "#ff1493"))
    }

    private func pill(label: String) -> some View {
        Text(label)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Color(hex: "#ad1457"), in: Capsule())
    }

    private var currentStyleLabel: String {
        guard let id = styleId else { return "Classic" }
        return payload?.styles?.first { $0.id == id }?.label ?? "Classic"
    }
    private var currentKidLabel: String {
        guard let id = kidId else { return "Main kid" }
        return payload?.kids?.first { $0.id == id }?.label ?? "Main kid"
    }
    private var currentVoiceName: String {
        payload?.voices?.first { $0.id == effectiveVoiceId }?.name ?? "Default"
    }
    private var effectiveVoiceId: String? {
        voiceId ?? payload?.voices?.first?.id
    }

    // MARK: - Board (three section columns + needs strip, like the child board)

    private func boardBody(_ p: Payload) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                sectionColumn(title: "People", tiles: tiles(p, in: "people"), tint: Color(hex: "#ffffff"))
                sectionColumn(title: "Nouns", tiles: tiles(p, in: "nouns"), tint: Color(hex: "#ffffff"))
                sectionColumn(title: "Verbs", tiles: tiles(p, in: "verbs"), tint: Color(hex: "#ffffff"))
            }
            .frame(maxHeight: .infinity)
            needsStrip(tiles(p, in: "needs"))
        }
    }

    private func tiles(_ p: Payload, in section: String) -> [Payload.DemoTile] {
        p.tiles.filter { $0.section == section }
    }

    private func sectionColumn(title: String, tiles: [Payload.DemoTile], tint: Color) -> some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.system(.headline, design: .rounded).weight(.bold))
                .foregroundStyle(Color(hex: "#ad1457"))
                .padding(.vertical, 6)
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(Array(tiles.enumerated()), id: \.offset) { _, t in
                        demoTile(t)
                    }
                }
                .padding(8)
            }
        }
        .frame(maxWidth: .infinity)
        .background(tint)
        .overlay(Rectangle().frame(width: 1).foregroundStyle(Color.black.opacity(0.06)), alignment: .trailing)
    }

    private func needsStrip(_ tiles: [Payload.DemoTile]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(tiles.enumerated()), id: \.offset) { _, t in
                    demoTile(t)
                        .frame(width: 110)
                }
            }
            .padding(8)
        }
        .background(Color(hex: "#ffd400"))
    }

    private func demoTile(_ t: Payload.DemoTile) -> some View {
        Button {
            speak(t.label)
        } label: {
            VStack(spacing: 4) {
                DemoTileImage(imageKey: t.imageKey)
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                Text(t.label)
                    .font(.system(.footnote, design: .rounded).weight(.semibold))
                    .foregroundStyle(Color(hex: "#374151"))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(6)
            .background(.white, in: RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data + audio

    private func load() async {
        loading = true
        errorText = nil
        defer { loading = false }
        var path = "/api/demo"
        var q: [String] = []
        if let styleId { q.append("style=\(styleId)") }
        if let kidId { q.append("kid=\(kidId)") }
        if !q.isEmpty { path += "?" + q.joined(separator: "&") }
        do {
            let (data, _) = try await api.request(method: "GET", path: path, body: nil)
            payload = try JSONDecoder().decode(Payload.self, from: data)
        } catch {
            errorText = "Couldn't load the demo board. Check the connection and try again."
        }
    }

    /// Plays the pre-rendered demo clip for a label — the same deterministic
    /// key the web practice page uses (demo-audio/<voiceId>/<slug>.mp3).
    /// Deliberately NO device-TTS fallback: a demo must sound like the
    /// product's voices or stay silent (same rule as the practice board).
    private func speak(_ label: String) {
        guard let vid = effectiveVoiceId else { return }
        let key = "demo-audio/\(vid)/\(Self.demoSlug(label)).mp3"
        Task {
            guard let data = try? await MediaCache.shared.data(for: key) else { return }
            await MainActor.run {
                player = try? AVAudioPlayer(data: data)
                player?.play()
            }
        }
    }

    /// Mirror of the practice page's clip slug: lowercase, runs of
    /// non-alphanumerics collapse to "-", trimmed at both ends.
    static func demoSlug(_ s: String) -> String {
        let lowered = s.lowercased()
        var out = ""
        var lastDash = true
        for ch in lowered {
            if ch.isLetter || ch.isNumber, ch.isASCII {
                out.append(ch)
                lastDash = false
            } else if !lastDash {
                out.append("-")
                lastDash = true
            }
        }
        if out.hasSuffix("-") { out.removeLast() }
        return out
    }
}

/// Async tile art loader bound to the shared MediaCache (C7: decoded at
/// display size, never full-res).
private struct DemoTileImage: View {
    let imageKey: String?
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color(hex: "#fce4ec"))
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            }
        }
        .task(id: imageKey) {
            guard let key = imageKey, !key.isEmpty else { image = nil; return }
            image = await MediaCache.shared.image(for: key, maxPixel: 256)
        }
    }
}

import SwiftUI

/// One matched piece of the rolling caption: a board tile, or a plain word the
/// board doesn't have. `id` is the id of its FIRST source word, so it stays
/// stable as older words drop off the front (smooth scroll + fade).
struct ListenToken: Identifiable {
    let id: Int
    let word: String
    let tile: Tile?
    let at: Date
}

/// Greedy-longest tokenizer — the SAME rule as `api/message-to-board.js`: try the
/// longest phrase as one tile, shrink to single words; unmatched words stay text.
/// Runs locally against the board's own tiles so it's instant and offline.
enum ListenTokenizer {
    static func normalize(_ s: String) -> String {
        s.lowercased()
            .replacingOccurrences(of: "[.,!?;:\"()\\[\\]{}]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    static func lexicon(from tiles: [Tile]) -> [String: Tile] {
        var map: [String: Tile] = [:]
        for t in tiles {
            let key = normalize(t.label)
            if !key.isEmpty, map[key] == nil { map[key] = t }
        }
        return map
    }

    static func tokenize(_ words: [TimedWord], lexicon: [String: Tile]) -> [ListenToken] {
        var out: [ListenToken] = []
        var i = 0
        while i < words.count {
            var matched: Tile?
            var used = 1
            var w = min(6, words.count - i)
            while w >= 1 {
                let phrase = normalize(words[i..<(i + w)].map { $0.text }.joined(separator: " "))
                if let tile = lexicon[phrase] { matched = tile; used = w; break }
                w -= 1
            }
            let src = Array(words[i..<(i + used)])
            let id = src.first?.id ?? i
            let at = src.map { $0.at }.max() ?? Date()
            out.append(ListenToken(id: id, word: matched?.label ?? normalize(words[i].text), tile: matched, at: at))
            i += used
        }
        return out
    }
}

/// The live, one-tile-high rolling strip that takes over the branding while
/// listening. Words stream in, scroll to the newest, and fade off the front
/// after ~10s (or once the bar fills) — a continuous class-captioning aid.
struct ListenStripView: View {
    let speech: SpeechListener
    @Environment(BoardStore.self) private var board

    private var tokens: [ListenToken] {
        ListenTokenizer.tokenize(speech.words, lexicon: ListenTokenizer.lexicon(from: board.tiles))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Color(hex: "#dc2626"))
                        .symbolEffect(.pulse, options: .repeating)
                        .padding(.leading, 4)

                    if tokens.isEmpty && speech.liveTail.isEmpty {
                        Text(speech.status.isEmpty ? "Listening… say a word" : speech.status)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        ForEach(tokens) { tok in
                            chip(tok)
                                .id(tok.id)
                                .transition(.opacity.combined(with: .scale(scale: 0.9)))
                        }
                        // The word still being spoken, shown faint at the end.
                        if !speech.liveTail.isEmpty {
                            Text(speech.liveTail)
                                .font(.system(size: 18, weight: .semibold, design: .rounded))
                                .foregroundStyle(Color(hex: "#ad1457").opacity(0.5))
                                .padding(.horizontal, 8)
                                .frame(height: 76)
                                .id("live-tail")
                        }
                    }
                }
                .padding(.horizontal, 8)
                .animation(.easeInOut(duration: 0.25), value: speech.words)
            }
            .onChange(of: speech.words.count) { _, _ in
                guard let last = tokens.last?.id else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last, anchor: .trailing) }
            }
            .onChange(of: speech.liveTail) { _, tail in
                guard !tail.isEmpty else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("live-tail", anchor: .trailing) }
            }
        }
        .frame(height: 92)
    }

    @ViewBuilder
    private func chip(_ tok: ListenToken) -> some View {
        if let tile = tok.tile {
            ListenTileChip(tile: tile)
        } else {
            Text(tok.word)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
                .padding(.horizontal, 12)
                .frame(height: 76)
                .background(Color(hex: "#fce4ec"), in: RoundedRectangle(cornerRadius: 14))
        }
    }
}

/// A single tile thumbnail in the strip; tap to speak it (recorded voice / TTS).
private struct ListenTileChip: View {
    let tile: Tile
    @State private var image: UIImage?

    var body: some View {
        Button {
            Task { await TilePlayer.shared.play(tile) }
        } label: {
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Color(hex: "#fff7fb")
                }
            }
            .frame(width: 76, height: 76)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.black.opacity(0.06)))
        }
        .buttonStyle(.plain)
        .task(id: tile.imageKey) {
            if let key = tile.imageKey { image = await MediaCache.shared.image(for: key) }
        }
    }
}

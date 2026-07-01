import SwiftUI

/// One matched piece of the spoken sentence: a board tile, or a plain word the
/// board doesn't have (rendered as text).
struct ListenToken: Identifiable {
    let id: Int
    let word: String
    let tile: Tile?
}

/// Greedy-longest tokenizer — the SAME rule as `api/message-to-board.js`: try the
/// longest phrase as one tile, shrink to single words; unmatched words stay text.
/// Runs locally against the board's own tiles so it's instant and works offline.
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

    static func tokenize(_ text: String, lexicon: [String: Tile]) -> [ListenToken] {
        let words = text.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init)
        var out: [ListenToken] = []
        var i = 0
        var nextId = 0
        let maxWindow = 6
        while i < words.count && out.count < 40 {
            var matched: Tile?
            var used = 1
            var w = min(maxWindow, words.count - i)
            while w >= 1 {
                let phrase = normalize(words[i..<(i + w)].joined(separator: " "))
                if let tile = lexicon[phrase] { matched = tile; used = w; break }
                w -= 1
            }
            if let tile = matched {
                out.append(ListenToken(id: nextId, word: tile.label, tile: tile))
            } else {
                out.append(ListenToken(id: nextId, word: normalize(words[i]), tile: nil))
            }
            nextId += 1
            i += used
        }
        return out
    }
}

/// The live, one-tile-high strip that takes over the branding while listening.
/// Observes the SpeechListener transcript, tokenizes against the board, and
/// renders matched tiles + text chips, keeping the newest word in view.
struct ListenStripView: View {
    let speech: SpeechListener
    @Environment(BoardStore.self) private var board

    private var tokens: [ListenToken] {
        ListenTokenizer.tokenize(speech.transcript,
                                 lexicon: ListenTokenizer.lexicon(from: board.tiles))
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
                    if tokens.isEmpty {
                        // Surfaces why nothing is showing yet: "Listening…", or a
                        // concrete reason (permission / model / network) if the
                        // recognizer couldn't start.
                        Text(speech.status.isEmpty ? "Listening… say a word" : speech.status)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        ForEach(tokens) { tok in
                            chip(tok).id(tok.id)
                        }
                    }
                }
                .padding(.horizontal, 8)
            }
            .onChange(of: tokens.count) { _, _ in
                if let last = tokens.last {
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last.id, anchor: .trailing) }
                }
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

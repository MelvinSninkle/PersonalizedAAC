import SwiftUI

/// One matched piece of the rolling caption: a board tile, or a plain word the
/// board doesn't have. `id` is the id of its FIRST source word, so it stays
/// stable as older words drop off the front (smooth scroll + fade).
struct ListenToken: Identifiable {
    let id: Int
    let word: String
    let tile: Tile?
    let at: Date
    /// Display filter (E8): a blocklisted word, shown as the pill "Bad Word".
    var masked = false
    /// What was actually SAID when a variant/synonym matched the tile —
    /// "hi" borrowing hello's picture keeps its own caption. nil when the
    /// spoken word IS the tile's label.
    var spoken: String? = nil
}

/// Greedy-longest tokenizer — the SAME rule as `api/message-to-board.js`: try the
/// longest phrase as one tile, shrink to single words; unmatched words stay text.
/// Runs locally against the board's own tiles so it's instant and offline.
enum ListenTokenizer {
    /// The recognizer emits digits ("12") while tile labels are usually spelled
    /// ("twelve") — canonicalize both sides token-by-token so they meet.
    private static let numberWords: [String: String] = [
        "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
        "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
        "10": "ten", "11": "eleven", "12": "twelve", "13": "thirteen",
        "14": "fourteen", "15": "fifteen", "16": "sixteen", "17": "seventeen",
        "18": "eighteen", "19": "nineteen", "20": "twenty",
    ]

    static func normalize(_ s: String) -> String {
        let cleaned = s.lowercased()
            .replacingOccurrences(of: "[.,!?;:\"()\\[\\]{}]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        // Token-level digit → word ("12 o'clock" → "twelve o'clock").
        return cleaned.split(separator: " ")
            .map { numberWords[String($0)] ?? String($0) }
            .joined(separator: " ")
    }

    static func lexicon(from tiles: [Tile]) -> [String: Tile] {
        var map: [String: Tile] = [:]
        // Labels first — a real "loves" tile beats "love"'s variant — then the
        // server-expanded matchTerms (inflections + curated synonyms).
        for t in tiles {
            let key = normalize(t.label)
            if !key.isEmpty, map[key] == nil { map[key] = t }
        }
        for t in tiles {
            for v in t.matchTerms ?? [] {
                let key = normalize(v)
                if !key.isEmpty, map[key] == nil { map[key] = t }
            }
        }
        return map
    }

    /// Contractions expand to the words their tiles exist for — "he's" →
    /// "he is", "don't" → "do not" — ONLY after the contraction itself
    /// matched no tile or synonym (a real "don't" tile always wins), so
    /// possessives ("mom's ball") are never touched: only these exact
    /// pronoun/wh/negation forms expand. Applies to every board (family +
    /// practice) — keep in lockstep with app.html + practice.html.
    static let contractions: [String: [String]] = [
        "i'm": ["i", "am"], "i've": ["i", "have"], "i'll": ["i", "will"], "i'd": ["i", "would"],
        "you're": ["you", "are"], "you've": ["you", "have"], "you'll": ["you", "will"], "you'd": ["you", "would"],
        "he's": ["he", "is"], "he'll": ["he", "will"], "he'd": ["he", "would"],
        "she's": ["she", "is"], "she'll": ["she", "will"], "she'd": ["she", "would"],
        "it's": ["it", "is"], "it'll": ["it", "will"],
        "we're": ["we", "are"], "we've": ["we", "have"], "we'll": ["we", "will"], "we'd": ["we", "would"],
        "they're": ["they", "are"], "they've": ["they", "have"], "they'll": ["they", "will"], "they'd": ["they", "would"],
        "that's": ["that", "is"], "that'll": ["that", "will"],
        "there's": ["there", "is"], "here's": ["here", "is"], "where's": ["where", "is"],
        "what's": ["what", "is"], "who's": ["who", "is"], "how's": ["how", "is"], "when's": ["when", "is"],
        "let's": ["let", "us"],
        "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"], "weren't": ["were", "not"],
        "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"],
        "can't": ["can", "not"], "cannot": ["can", "not"], "couldn't": ["could", "not"],
        "won't": ["will", "not"], "wouldn't": ["would", "not"], "shouldn't": ["should", "not"], "mustn't": ["must", "not"],
        "haven't": ["have", "not"], "hasn't": ["has", "not"], "hadn't": ["had", "not"],
        "ain't": ["is", "not"],
        "gonna": ["going", "to"], "wanna": ["want", "to"], "gotta": ["got", "to"],
    ]

    static func tokenize(_ words: [TimedWord], lexicon: [String: Tile],
                         censor: Bool = true, tilesOnly: Bool = false,
                         blocklist: Set<String> = [],
                         captions: Bool = false) -> [ListenToken] {
        var words = words
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
            // Unmatched contraction → splice its expansion in and re-match
            // from the same spot ("he's" becomes "he" "is", each finding its
            // own tile). Curly apostrophes (the recognizer's favorite)
            // normalize to straight before lookup. Derived ids are negative
            // so they can never collide with the recognizer's own word ids —
            // and stay stable across transcript re-emits.
            if matched == nil {
                let key = normalize(words[i].text).replacingOccurrences(of: "\u{2019}", with: "'")
                if let parts = Self.contractions[key] {
                    let src = words[i]
                    let repl = parts.enumerated().map { k, p in
                        TimedWord(id: -(src.id * 8 + k + 1), text: p, at: src.at)
                    }
                    words.replaceSubrange(i...i, with: repl)
                    continue
                }
            }
            let src = Array(words[i..<(i + used)])
            let id = src.first?.id ?? i
            let at = src.map { $0.at }.max() ?? Date()
            if let matched {
                // A synonym/variant match borrows the tile's image but the
                // transcript stays honest: keep what was said as the caption.
                // `captions` is the server-shipped dark-launch flag.
                let said = src.map { $0.text }.joined(separator: " ")
                let differs = normalize(said) != normalize(matched.label)
                out.append(ListenToken(id: id, word: matched.label, tile: matched, at: at,
                                       spoken: (captions && differs) ? said : nil))
            } else if !tilesOnly {
                // Display filter (E8): a blocklisted word never renders as
                // itself; tilesOnly hides every non-tile word outright.
                let norm = normalize(words[i].text)
                if censor && blocklist.contains(norm) {
                    out.append(ListenToken(id: id, word: "Bad Word", tile: nil, at: at, masked: true))
                } else {
                    out.append(ListenToken(id: id, word: norm, tile: nil, at: at))
                }
            }
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
    /// Practice/demo board only: render the strip at a fixed larger scale
    /// (roomier chips for screen recordings). nil — every real board — uses
    /// the device's low-vision listenScale, exactly as before.
    var scaleOverride: Double? = nil
    @Environment(BoardStore.self) private var board
    @Environment(AccessPrefs.self) private var access
    @Environment(DisplayPrefs.self) private var prefs

    private var stripScale: Double { scaleOverride ?? prefs.listenScale }

    private var tokens: [ListenToken] {
        ListenTokenizer.tokenize(speech.words, lexicon: ListenTokenizer.lexicon(from: board.tiles),
                                 censor: access.listenCensor, tilesOnly: access.listenTilesOnly,
                                 blocklist: board.listenBlocklist,
                                 captions: board.listenCaptions)
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
                        // A denial can only be undone in iOS Settings — hand
                        // the parent a one-tap way there instead of a dead
                        // strip (bites after every uninstall/reinstall that
                        // re-prompts and catches a stray "Don't Allow").
                        if speech.permissionDenied {
                            Button {
                                if let url = URL(string: UIApplication.openSettingsURLString) {
                                    UIApplication.shared.open(url)
                                }
                            } label: {
                                Text("Open Settings")
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(Capsule().fill(Color(hex: "#ad1457")))
                            }
                            .buttonStyle(.plain)
                        }
                    } else {
                        ForEach(tokens) { tok in
                            chip(tok)
                                .id(tok.id)
                                .transition(.opacity.combined(with: .scale(scale: 0.9)))
                        }
                        // The word still being spoken, shown faint at the end.
                        if !speech.liveTail.isEmpty {
                            Text(speech.liveTail)
                                .font(.system(size: 18 * stripScale, weight: .semibold, design: .rounded))
                                .foregroundStyle(Color(hex: "#ad1457").opacity(0.5))
                                .padding(.horizontal, 8)
                                .frame(height: 76 * stripScale)
                                .id("live-tail")
                        }
                    }
                }
                .padding(.horizontal, 8)
                .animation(.easeInOut(duration: 0.25), value: speech.words)
            }
            .onChange(of: speech.words.count) { _, _ in
                // Repeat-navigate ("say it twice → show me") moved to
                // BoardNav.repeatNavigate, driven by the board views — it must
                // keep firing when this strip is unmounted (background
                // listening while the sentence bar owns the header).
                guard let last = tokens.last?.id else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last, anchor: .trailing) }
            }
            .onChange(of: speech.liveTail) { _, tail in
                guard !tail.isEmpty else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("live-tail", anchor: .trailing) }
            }
        }
        // #15 low-vision enlargement: the strip and its chips scale together
        // (HeaderBar grows its tall frame by the same factor).
        .frame(height: 92 * stripScale)
    }

    @ViewBuilder
    private func chip(_ tok: ListenToken) -> some View {
        if let tile = tok.tile {
            ListenTileChip(tile: tile, scale: stripScale, spoken: tok.spoken)
        } else {
            Text(tok.word)
                .font(.system(size: 20 * stripScale, weight: .bold, design: .rounded))
                .italic(tok.masked)
                .foregroundStyle(Color(hex: "#ad1457").opacity(tok.masked ? 0.7 : 1))
                .padding(.horizontal, 12)
                .frame(height: 76 * stripScale)
                .background(Color(hex: "#fce4ec"), in: RoundedRectangle(cornerRadius: 14))
        }
    }
}

/// A single tile thumbnail in the strip; tap to speak it (recorded voice / TTS).
private struct ListenTileChip: View {
    let tile: Tile
    var scale: Double = 1
    /// A synonym match borrows this tile's image; the caption shows what was
    /// actually SAID ("hi" under hello's picture). nil = no caption.
    var spoken: String? = nil
    /// Practice board only (nil on real boards): every chip carries its label
    /// as a band across the image bottom, like the board tiles.
    @Environment(PracticeChrome.self) private var practiceChrome: PracticeChrome?
    @State private var image: UIImage?

    /// Band text: the honest spoken caption when a synonym matched; on the
    /// practice board, the tile's label otherwise (real boards: caption only).
    private var bandText: String? {
        if let spoken, !spoken.isEmpty { return spoken }
        return practiceChrome != nil ? tile.display : nil
    }

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
            .frame(width: 76 * scale, height: 76 * scale)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(alignment: .bottom) {
                if let bandText {
                    Text(bandText)
                        .font(.system(size: 12 * scale, weight: .bold, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .foregroundStyle(Color(hex: "#1f2937"))
                        .frame(maxWidth: .infinity)
                        // Asymmetric padding: the rounded-corner clip below
                        // was shaving descenders (g/y/p) off the caption.
                        .padding(.top, 1)
                        .padding(.bottom, 3)
                        .background(.white.opacity(0.92))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.black.opacity(0.06)))
        }
        .buttonStyle(.plain)
        .task(id: tile.imageKey) {
            // Enlarged chips (#15) decode a step sharper; still bounded (C7).
            if let key = tile.imageKey { image = await MediaCache.shared.image(for: key, maxPixel: scale > 1 ? 512 : 256) }
        }
    }
}

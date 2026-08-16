import Foundation

/// Listening-driven vocabulary intelligence — the iOS side of two features:
///
///   GAP A (#10, canonical suggestions): a word the TAXONOMY knows but the
///   board lacks → batched to the server as (slug, +1) under the existing
///   `suggestFromListening` consent; the parent dashboard offers it.
///
///   GAP B (gap-fill ledger): a word NOBODY knows → counted in an on-device
///   frequency ledger under the separate `gapFillListen` consent. Candidates
///   that clear the threshold surface to the PARENT (settings sheet + a
///   render-only chip in the listening strip); requesting one sends that one
///   word to the vendor — the tap IS the share, never automatic.
///
/// PRIVACY (GF-2/GF-4, load-bearing — do not "improve" this into a log):
///   • The ledger stores word → day → count. No word order, no utterance
///     timestamps, no speaker, no context. Sequence is destroyed at write
///     time — an utterance cannot be reconstructed from this structure.
///   • Ledger data never leaves the device. The only network writes are
///     (a) canonical SLUG matches under consent A, and (b) a single word the
///     parent explicitly requested.
///   • Gap-B counting additionally requires RECOGNITION to be on-device
///     (SpeechListener.onDevice) — if the recognizer fell back to the
///     network, we still navigate/caption but we do not count.
///   • Words are counted at most once per listening SESSION (the recognizer
///     re-sends the rolling transcript on every partial — session dedupe is
///     also what keeps counts honest).
///
/// Candidate rules (GF-10..15): total ≥ 5 across ≥ 3 distinct days inside a
/// rolling 30-day window; stopwords, blocklist words, board words, taxonomy
/// words, dismissed-forever words, and already-requested words never
/// surface; top 30 by count (ties alphabetical, so order is stable).
@MainActor
@Observable
final class ListenVocab {
    static let shared = ListenVocab()

    // ── Gates (set by configure(); server re-enforces every write) ──────────
    var captureConsent = false      // suggestFromListening — Gap A
    var ledgerConsent = false       // gapFillListen — Gap B
    var gapFillAllowed = true       // Plus/Pro entitlement (GF-22)

    /// A candidate word the strip may show as a render-only ✨ chip right
    /// after it was heard. Cleared on session end.
    private(set) var liveCandidate: String? = nil

    private(set) var candidates: [Candidate] = []
    private(set) var requested: [String: String] = [:]   // word → request status

    struct Candidate: Identifiable {
        let word: String
        let hits: Int
        let days: Int
        var id: String { word }
    }

    // ── Internals ───────────────────────────────────────────────────────────
    private let api = APIClient()
    private var childId = ""
    private var boardTerms: Set<String> = []
    private var stopwords: Set<String> = []
    private var blocklist: Set<String> = []
    private var canonTerms: [String: String] = [:]   // normalized term → slug
    private var canonMaxWords = 1
    private var canonLoadedAt: Date? = nil

    private var sessionSlugs: Set<String> = []
    private var sessionWords: Set<String> = []
    private var pendingSlugs: Set<String> = []
    private var flushTask: Task<Void, Never>? = nil

    private struct Ledger: Codable {
        // word → "yyyy-MM-dd" → sessions heard that day (GF-2: order-free).
        var counts: [String: [String: Int]] = [:]
        var dismissedForever: [String] = []
    }
    private var ledger = Ledger()

    // MARK: -- Configuration

    /// Called whenever the board (re)loads. Reads consents from child
    /// settings, terms from the board, and refreshes the canonical lexicon
    /// (daily) + this child's request states.
    func configure(childId: String, board: BoardStore) {
        self.childId = childId
        self.gapFillAllowed = board.gapFillAllowed
        self.stopwords = board.listenStopwords
        self.blocklist = board.listenBlocklist
        var terms = Set<String>()
        for t in board.tiles {
            terms.insert(Self.norm(t.label))
            for m in t.matchTerms ?? [] { terms.insert(Self.norm(m)) }
        }
        self.boardTerms = terms
        loadLedger()
        recomputeCandidates()
        Task {
            let (s, _) = await ChildSettingsStore.shared.load(childId: childId)
            self.captureConsent = (s["suggestFromListening"] as? Bool) == true
            self.ledgerConsent = (s["gapFillListen"] as? Bool) == true
            await self.refreshLexiconIfStale()
            let reqs = await self.api.requestList(childId: childId)
            self.requested = Dictionary(uniqueKeysWithValues: reqs.map { ($0.word, $0.status) })
            self.recomputeCandidates()
        }
    }

    // MARK: -- Session lifecycle (driven by BoardView's listening toggle)

    func sessionBegan() {
        sessionSlugs.removeAll()
        sessionWords.removeAll()
        liveCandidate = nil
        flushTask?.cancel()
        flushTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 12_000_000_000)
                if Task.isCancelled { break }
                self.flushNow()
            }
        }
    }

    func sessionEnded() {
        flushTask?.cancel()
        flushTask = nil
        liveCandidate = nil
        flushNow()
        saveLedger()
        recomputeCandidates()
    }

    // MARK: -- Ingest (rolling transcript, every partial)

    /// `onDevice` is SpeechListener.onDevice at the moment of the partial —
    /// gap-B counting stops the instant recognition falls back online.
    func ingest(_ text: String, onDevice: Bool) {
        guard gapFillAllowed, captureConsent || ledgerConsent, !childId.isEmpty else { return }
        let words = Self.tokenize(text)
        guard !words.isEmpty else { return }

        var i = 0
        while i < words.count {
            // Greedy-longest canonical match first (multi-word taxonomy
            // labels like "dragon fruit" match as one unit here).
            var matchedLen = 0
            var matchedSlug: String? = nil
            if !canonTerms.isEmpty {
                let maxLen = min(canonMaxWords, words.count - i)
                if maxLen >= 1 {
                    for len in stride(from: maxLen, through: 1, by: -1) {
                        let phrase = words[i..<(i + len)].joined(separator: " ")
                        if let slug = canonTerms[phrase] { matchedLen = len; matchedSlug = slug; break }
                    }
                }
            }
            if let slug = matchedSlug {
                // Gap A: known word. Board words are NOT suggestions (the
                // board already has them) — boardTerms wins over the lexicon.
                let phrase = words[i..<(i + matchedLen)].joined(separator: " ")
                if captureConsent && !boardTerms.contains(phrase) && !sessionSlugs.contains(slug) {
                    sessionSlugs.insert(slug)
                    pendingSlugs.insert(slug)
                }
                i += matchedLen
                continue
            }

            // Gap B: unknown word — count it (once per session) if every gate
            // agrees. Short tokens and anything on a server-owned list never
            // enters the ledger.
            let w = words[i]
            i += 1
            guard ledgerConsent, onDevice,
                  w.count >= 3, w.count <= 30,
                  !stopwords.contains(w), !blocklist.contains(w),
                  !boardTerms.contains(w),
                  !ledger.dismissedForever.contains(w),
                  !sessionWords.contains(w) else { continue }
            sessionWords.insert(w)
            let day = Self.dayKey()
            var days = ledger.counts[w] ?? [:]
            days[day] = (days[day] ?? 0) + 1
            ledger.counts[w] = days
            if candidates.contains(where: { $0.word == w }) {
                liveCandidate = w
            }
        }
    }

    // MARK: -- Candidate actions (parent settings sheet)

    /// The parent explicitly asks for this word — one word, one tap, the tap
    /// is the share. Returns the resulting status for the row.
    func request(_ word: String) async -> String {
        let hits = totalHits(word)
        guard let r = await api.requestWord(childId: childId, word: word, hits: hits) else {
            return "error"
        }
        let status = (r.inTaxonomy == true) ? "suggested" : (r.status ?? "requested")
        requested[word] = status
        recomputeCandidates()
        return status
    }

    func dismissForever(_ word: String) {
        if !ledger.dismissedForever.contains(word) { ledger.dismissedForever.append(word) }
        ledger.counts.removeValue(forKey: word)
        saveLedger()
        recomputeCandidates()
    }

    /// Revoking the gap-fill consent clears the ledger (GF-33) — the counts
    /// existed only to serve a feature the family just turned off.
    func consentRevoked() {
        ledgerConsent = false
        ledger = Ledger()
        saveLedger()
        candidates = []
        liveCandidate = nil
    }

    // MARK: -- Evaluation

    private func recomputeCandidates() {
        pruneOldDays()
        let minHits = 5, minDays = 3
        var out: [Candidate] = []
        for (word, days) in ledger.counts {
            let total = days.values.reduce(0, +)
            guard total >= minHits, days.count >= minDays else { continue }
            guard requested[word] == nil else { continue }
            guard !boardTerms.contains(word), canonTerms[word] == nil else { continue }
            out.append(Candidate(word: word, hits: total, days: days.count))
        }
        // Stable order (GF-14): count desc, then alphabetical.
        out.sort { $0.hits != $1.hits ? $0.hits > $1.hits : $0.word < $1.word }
        candidates = Array(out.prefix(30))
    }

    private func totalHits(_ word: String) -> Int {
        (ledger.counts[word] ?? [:]).values.reduce(0, +)
    }

    /// Rolling 30-day window (GF-3): buckets older than 30 days fall off, so
    /// the ranking reflects what the child cares about NOW.
    private func pruneOldDays() {
        guard let cutoff = Calendar.current.date(byAdding: .day, value: -30, to: Date()) else { return }
        let cutKey = Self.dayKey(cutoff)
        for (word, days) in ledger.counts {
            let kept = days.filter { $0.key >= cutKey }
            if kept.isEmpty { ledger.counts.removeValue(forKey: word) }
            else if kept.count != days.count { ledger.counts[word] = kept }
        }
    }

    // MARK: -- Canonical lexicon (cache on disk, refresh daily)

    private struct LexCache: Codable {
        let loadedAt: Date
        let entries: [APIClient.LexiconEntry]
    }

    private func refreshLexiconIfStale() async {
        if canonLoadedAt == nil, let cached = try? JSONDecoder().decode(
            LexCache.self, from: Data(contentsOf: Self.lexiconURL)) {
            adoptLexicon(cached.entries, at: cached.loadedAt)
        }
        if let at = canonLoadedAt, Date().timeIntervalSince(at) < 24 * 3600 { return }
        let entries = await api.suggestLexicon()
        guard !entries.isEmpty else { return }
        adoptLexicon(entries, at: Date())
        if let data = try? JSONEncoder().encode(LexCache(loadedAt: Date(), entries: entries)) {
            try? data.write(to: Self.lexiconURL, options: .atomic)
        }
    }

    private func adoptLexicon(_ entries: [APIClient.LexiconEntry], at: Date) {
        var terms: [String: String] = [:]
        var maxWords = 1
        for e in entries {
            for raw in [e.label] + e.terms {
                let t = Self.norm(raw)
                guard !t.isEmpty else { continue }
                if terms[t] == nil { terms[t] = e.slug }
                let n = t.split(separator: " ").count
                if n > maxWords { maxWords = n }
            }
        }
        canonTerms = terms
        canonMaxWords = min(maxWords, 4)
        canonLoadedAt = at
    }

    // MARK: -- Flush + persistence

    private func flushNow() {
        saveLedger()
        guard !pendingSlugs.isEmpty else { return }
        let slugs = Array(pendingSlugs)
        pendingSlugs.removeAll()
        let cid = childId
        Task { await api.suggestRecord(childId: cid, slugs: slugs) }
    }

    private var ledgerURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("word-ledger-\(childId).json")
    }
    private static var lexiconURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("canon-lexicon.json")
    }

    private func loadLedger() {
        guard !childId.isEmpty,
              let data = try? Data(contentsOf: ledgerURL),
              let l = try? JSONDecoder().decode(Ledger.self, from: data) else {
            ledger = Ledger()
            return
        }
        ledger = l
    }

    private func saveLedger() {
        guard !childId.isEmpty, let data = try? JSONEncoder().encode(ledger) else { return }
        try? data.write(to: ledgerURL, options: .atomic)
    }

    // MARK: -- Text helpers

    static func norm(_ s: String) -> String {
        s.lowercased()
            .replacingOccurrences(of: "’", with: "'")
            .components(separatedBy: CharacterSet.letters.union(CharacterSet(charactersIn: "' -")).inverted)
            .joined()
            .replacingOccurrences(of: "-", with: " ")
            .split(separator: " ").joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
    }

    static func tokenize(_ text: String) -> [String] {
        text.lowercased()
            .replacingOccurrences(of: "’", with: "'")
            .components(separatedBy: CharacterSet.letters.union(CharacterSet(charactersIn: "'")).inverted)
            .filter { !$0.isEmpty }
            .prefix(60)
            .map(String.init)
    }

    private static func dayKey(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone.current
        return f.string(from: date)
    }
}

import SwiftUI
import Observation

// Access experiments (admin dark-launch) — the native port of the web board's
// accessibility features. This holder is READ-ONLY: the kid app honors
// whatever is stored for this child (admin keys are server-enforced in
// api/child-settings.js; the parent-set keys are written from the parent
// Settings screen via APIClient.updateChildSettings, then refresh() here
// picks them up). Keys live at the settings ROOT (not
// under kidDisplay), so this holder reads the raw child-settings blob rather
// than riding DisplayPrefs (whose didSet save-back would echo writes).

/// Touch controls (parent-set, NOT admin-gated — ordinary board settings).
/// Static so TilePlayer (a singleton with no view context) can read them.
///   interrupt      — a new tap cuts off audio that's still playing. OFF by
///                    default: a child stimming on one button hears each
///                    word complete instead of machine-gun restarts.
///   doubleTapTeach — the SAME tile tapped again within the window speaks
///                    its teaching facts (descriptive clues, up to three).
enum TouchConfig {
    @MainActor static var interrupt = false
    @MainActor static var doubleTapTeach = false
    /// Tap-to-learn rapid-tap window (parent slider, 0.5–5s, default 2s):
    /// re-taps inside this window walk facts 1 → 2 → 3, then the word again.
    @MainActor static var teachTapMs = 2000
    // Safety controls (synced, for older/capable kids):
    //   easyClose  — game ✕ closes on a quick tap instead of the hold.
    //   exitHoldMs — the ✕ hold length when easyClose is off (parent slider).
    //   easyUnlock — the lock opens edit mode without the unlock sheet.
    @MainActor static var easyClose = false
    @MainActor static var exitHoldMs = 1200
    @MainActor static var easyUnlock = false

    /// Clamp a settings value into a sane slider range (bad/absent → default).
    static func clampMs(_ v: Any?, _ lo: Int, _ hi: Int, _ dflt: Int) -> Int {
        guard let n = (v as? Int) ?? (v as? Double).map(Int.init), n > 0 else { return dflt }
        return min(hi, max(lo, n))
    }
}

/// The five access keys, defaulted to the shipped behavior.
@Observable
final class AccessPrefs {
    var navMode: String = "scroll"            // "scroll" | "buttons"
    var sentenceBuilder: Bool = false
    var sentenceIdleMin: Int = 1              // 1–10 minutes
    var sentenceLift: String = "longpress"    // legacy — the pencil replaced lift gestures
    var listenRepeatNav: Bool = true
    /// #12: how many times IN A ROW a word must be heard to jump to its tile.
    /// 0 = off, 2 or 3. Absent on older settings blobs → derived from the
    /// legacy listenRepeatNav boolean (true = 2). Parent-writable.
    var listenRepeatCount: Int = 2
    // Header tools, parent-configurable for every family (default ON).
    var toolListen = true
    var toolTeach = true
    var toolPlay = true
    var toolSentence = true
    /// Drag-to-bar staging (the ORIGINAL sentence gesture, parent-enabled;
    /// native apps only — web keeps the pencil).
    var sentenceDrag = false
    /// Listening display filter (E8, parent-set). censor defaults ON: words
    /// on the synced blocklist render as the pill "Bad Word". tilesOnly
    /// hides every spoken word that has no tile on the board.
    var listenCensor = true
    var listenTilesOnly = false
    /// Background listening while the sentence constructor is engaged
    /// (pencil mode or a staged bar): the mic runs with no strip takeover so
    /// the parent can say a word twice, watch the tile flash, and drag it up.
    /// Parent-writable, default ON. Meaningless when listenRepeatCount == 0.
    var sentenceListen = true

    var buttonsNav: Bool { navMode == "buttons" }

    @ObservationIgnored private var childId: String?

    func attach(childId: String) {
        guard self.childId != childId else { return }
        self.childId = childId
        refresh()
    }

    /// Re-read settings (board .refreshable / relaunch pick changes up).
    /// Reads THROUGH ChildSettingsStore, not the network directly: offline
    /// flips apply to the live board immediately (cache + pending overlay),
    /// and every refresh doubles as a flush attempt for queued changes.
    func refresh() {
        guard let childId else { return }
        Task { @MainActor in
            let (s, _) = await ChildSettingsStore.shared.load(childId: childId)
            navMode = (s["navMode"] as? String) == "buttons" ? "buttons" : "scroll"
            sentenceBuilder = (s["sentenceBuilder"] as? Bool) ?? false
            let m = (s["sentenceIdleMin"] as? Int) ?? Int(s["sentenceIdleMin"] as? Double ?? 1)
            sentenceIdleMin = (1...10).contains(m) ? m : 1
            sentenceLift = (s["sentenceLift"] as? String) == "drag" ? "drag" : "longpress"
            listenRepeatNav = (s["listenRepeatNav"] as? Bool) ?? true
            let rc = (s["listenRepeatCount"] as? Int) ?? Int(s["listenRepeatCount"] as? Double ?? -1)
            listenRepeatCount = [0, 2, 3].contains(rc) ? rc : (listenRepeatNav ? 2 : 0)
            toolListen = (s["toolListen"] as? Bool) ?? true
            toolTeach = (s["toolTeach"] as? Bool) ?? true
            toolPlay = (s["toolPlay"] as? Bool) ?? true
            toolSentence = (s["toolSentence"] as? Bool) ?? true
            sentenceDrag = (s["sentenceDrag"] as? Bool) ?? false
            listenCensor = (s["listenCensor"] as? Bool) ?? true
            listenTilesOnly = (s["listenTilesOnly"] as? Bool) ?? false
            sentenceListen = (s["sentenceListen"] as? Bool) ?? true
            // Touch + safety controls ride the same settings fetch (root keys too).
            TouchConfig.interrupt = (s["tapInterrupt"] as? Bool) ?? false
            TouchConfig.doubleTapTeach = (s["doubleTapTeach"] as? Bool) ?? false
            TouchConfig.teachTapMs = TouchConfig.clampMs(s["teachTapMs"], 500, 5000, 2000)
            TouchConfig.easyClose = (s["easyClose"] as? Bool) ?? false
            TouchConfig.exitHoldMs = TouchConfig.clampMs(s["exitHoldMs"], 300, 3000, 1200)
            TouchConfig.easyUnlock = (s["easyUnlock"] as? Bool) ?? false
        }
    }
}

/// Hoisted board selection — SectionColumn's chip selection lives here (it was
/// local @State) so listening mode's repeat-navigate can drive the board from
/// the header. Also carries the transient "found it" tile highlight.
@Observable
final class BoardNav {
    struct Highlight: Equatable { let tileId: Int; let section: BoardSection }

    private var cat: [BoardSection: Int] = [:]
    private var sub: [BoardSection: Int] = [:]
    var highlight: Highlight?
    @ObservationIgnored private var highlightClear: Task<Void, Never>?
    @ObservationIgnored private var lastNavKey = ""
    @ObservationIgnored private var lastNavAt = Date.distantPast
    /// The synonym that located a tile via repeat-nav ("sparkle sparkle" →
    /// the star tile): staging that tile shortly after carries the SPOKEN
    /// word onto the sentence chip and into ▶ playback. nil when the child
    /// said the tile's own label.
    struct SpokenHit { let tileId: Int; let word: String; let at: Date }
    @ObservationIgnored private var lastSpokenHit: SpokenHit?

    /// The spoken synonym to attach when staging `tileId` — valid for 30s
    /// after the navigation that remembered it.
    func spokenWord(for tileId: Int) -> String? {
        guard let h = lastSpokenHit, h.tileId == tileId,
              Date().timeIntervalSince(h.at) < 30 else { return nil }
        return h.word
    }

    func category(_ s: BoardSection) -> Int? { cat[s] }
    func subcategory(_ s: BoardSection) -> Int? { sub[s] }
    func setCategory(_ s: BoardSection, _ id: Int?) { cat[s] = id }
    func setSubcategory(_ s: BoardSection, _ id: Int?) { sub[s] = id }

    /// "Say a word N times in a row → show me its tile", hoisted OUT of
    /// ListenStripView so it keeps firing while the sentence strip owns the
    /// header (background listening while building a sentence). Driven by
    /// BoardView / PracticeBoardView on every recognized word — the strip is
    /// now a pure display. A repeat = N consecutive tokens resolving to the
    /// same tile id; keyed by the run's last stable source-word id so
    /// re-emitted partial transcripts don't re-trigger, PLUS the web's 15s
    /// same-key cooldown — the mic hears the board's own audio, and a played
    /// sentence containing a repeated word must not yank the category out
    /// from under the parent.
    /// @MainActor: SpeechListener is MainActor-isolated (its `words` can't be
    /// read from a nonisolated context) — and every caller is a SwiftUI
    /// onChange closure, which already runs on the main actor.
    @MainActor
    func repeatNavigate(speech: SpeechListener, board: BoardStore, access: AccessPrefs) {
        let n = access.listenRepeatCount
        guard n >= 2 else { return }
        let toks = ListenTokenizer.tokenize(speech.words, lexicon: ListenTokenizer.lexicon(from: board.tiles),
                                            censor: access.listenCensor, tilesOnly: access.listenTilesOnly,
                                            blocklist: board.listenBlocklist,
                                            captions: board.listenCaptions)
        guard let last = toks.last, !last.masked else { return }
        let w = ListenTokenizer.normalize(last.word)
        guard !w.isEmpty else { return }
        // The trailing run of the SAME SPOKEN WORD (not the same tile): the
        // word is what the child is repeating, and it's what lets homophones
        // cycle — with threshold 3, "star star star" shows the first star
        // tile, a 4th "star" the next one, a 5th wraps back around.
        var runLen = 0
        var i = toks.count - 1
        while i >= 0, ListenTokenizer.normalize(toks[i].word) == w { runLen += 1; i -= 1 }
        guard runLen >= n else { return }
        // Every tile the word can mean — its own label or a synonym/inflection
        // (matchTerms) — in stable id order so the cycle is deterministic.
        var candidates = board.tiles.filter { t in
            ListenTokenizer.normalize(t.label) == w
                || (t.matchTerms ?? []).contains { ListenTokenizer.normalize($0) == w }
        }.sorted { $0.id < $1.id }
        if candidates.isEmpty, let t = last.tile { candidates = [t] }
        guard !candidates.isEmpty else { return }
        let target = candidates[(runLen - n) % candidates.count]
        // Keyed by word + run length + the run's last stable source-word id:
        // re-emitted partial transcripts re-produce the same key (suppressed),
        // while each ADDITIONAL repeat extends the run and navigates anew.
        let key = "\(w)#\(runLen)@\(last.id)"
        if key == lastNavKey, Date().timeIntervalSince(lastNavAt) < 15 { return }
        lastNavKey = key
        lastNavAt = Date()
        // A synonym locating the tile is remembered so staging carries the
        // spoken word ("the label has the synonym and the synonym is uttered").
        if ListenTokenizer.normalize(target.label) != w {
            lastSpokenHit = SpokenHit(tileId: target.id, word: last.spoken ?? last.word, at: Date())
        } else {
            lastSpokenHit = nil
        }
        navigate(to: target, board: board)
    }

    /// Listening repeat-navigate: open the tile's category/subcategory and
    /// flash it. Mirrors the web's navigateToTile.
    func navigate(to tile: Tile, board: BoardStore) {
        if let catId = tile.categoryId {
            // Climb to the root chip; the first-level child on the way down is
            // the subcategory chip (SectionColumn's model: root + one level).
            var chain: [Category] = []
            var cur = board.categories.first { $0.id == catId }
            while let c = cur {
                chain.append(c)
                cur = c.parentId.flatMap { pid in board.categories.first { $0.id == pid } }
            }
            if let root = chain.last {
                setCategory(tile.section, root.id)
                setSubcategory(tile.section, chain.count >= 2 ? chain[chain.count - 2].id : nil)
            }
        }
        highlight = Highlight(tileId: tile.id, section: tile.section)
        highlightClear?.cancel()
        highlightClear = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if !Task.isCancelled { highlight = nil }
        }
    }
}

/// Sentence constructor state: staged tiles, the in-flight lift/drag, and the
/// idle timer that clears the strip. The header shows SentenceStripView while
/// `active`; the original tiles never leave the board (staging copies).
@Observable
final class SentenceBar {
    struct Drag { var tile: Tile; var point: CGPoint; var overHeader: Bool }

    /// One staged word. `spoken` is the synonym that located the tile via
    /// repeat-nav ("sparkle" on the star tile): the chip labels it and ▶
    /// utters it (TTS — recorded clips cover tile labels only). The own-UUID
    /// identity also lets the same tile be staged twice and removed precisely.
    struct StagedWord: Identifiable {
        let id = UUID()
        let tile: Tile
        var spoken: String? = nil
        var display: String { spoken ?? tile.display }
    }

    var staged: [StagedWord] = []
    var drag: Drag?
    var active: Bool { !staged.isEmpty }
    /// Sentence MODE — owned by the header pencil. While on, the board runs
    /// button navigation (nothing to fight) and a TAP stages its tile. Turns
    /// itself off after 60s if no sentence gets started.
    var mode = false

    @ObservationIgnored private var idleTask: Task<Void, Never>?
    @ObservationIgnored private var modeTask: Task<Void, Never>?

    func setMode(_ on: Bool) {
        mode = on
        if !on { clear() }
        armModeTimer()
    }

    /// The 60-second "nothing started" window: runs whenever the mode is on
    /// with an empty bar; staging cancels it, clearing re-arms it.
    func armModeTimer() {
        modeTask?.cancel(); modeTask = nil
        guard mode, staged.isEmpty else { return }
        modeTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 60_000_000_000)
            if !Task.isCancelled, mode, staged.isEmpty { setMode(false) }
        }
    }

    /// Header drop zone in the "board" coordinate space: the bar itself (104pt
    /// when composing / 48 idle) plus slack so a child needn't be pixel-exact.
    static let dropZoneMaxY: CGFloat = 140

    /// Watchdog on the floating lift. Two real failure modes leave the ghost
    /// stranded mid-screen without it: a ScrollView stealing the gesture
    /// CANCELS it (SwiftUI then calls neither onChanged nor onEnded, so
    /// nothing ever clears `drag`), and a child who lifts a tile halfway and
    /// just… stops. Every dragUpdate re-arms it; ~2s of silence dismisses the
    /// ghost. Resuming movement simply lifts again.
    @ObservationIgnored private var dragWatchdog: Task<Void, Never>?
    private func armDragWatchdog() {
        dragWatchdog?.cancel()
        dragWatchdog = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            if !Task.isCancelled { drag = nil }
        }
    }

    func dragUpdate(_ tile: Tile, at point: CGPoint) {
        drag = Drag(tile: tile, point: point, overHeader: point.y <= Self.dropZoneMaxY)
        armDragWatchdog()
    }

    /// Ends the drag; returns true when the tile landed on the bar.
    func dragEnd(at point: CGPoint) -> Bool {
        dragWatchdog?.cancel(); dragWatchdog = nil
        let hit = point.y <= Self.dropZoneMaxY
        drag = nil
        return hit
    }

    func dragCancel() {
        dragWatchdog?.cancel(); dragWatchdog = nil
        drag = nil
    }

    static let maxWords = 25   // a sentence, not a filibuster

    func stage(_ tile: Tile, spoken: String? = nil, idleMinutes: Int) {
        guard staged.count < Self.maxWords else { return }
        staged.append(StagedWord(tile: tile, spoken: spoken))
        resetIdle(idleMinutes: idleMinutes)
        armModeTimer()
    }

    func remove(_ entry: StagedWord, idleMinutes: Int) {
        if let i = staged.firstIndex(where: { $0.id == entry.id }) { staged.remove(at: i) }
        if staged.isEmpty { clear() } else { resetIdle(idleMinutes: idleMinutes) }
    }

    func clear() {
        stopPlayback()   // ✕ mid-sentence must stop the audio too
        idleTask?.cancel(); idleTask = nil
        staged = []
        drag = nil
        armModeTimer()
    }

    /// Abort ▶ playback: cancel the loop and cut the clip in flight. A second
    /// ▶ also lands here first, so loops can never stack.
    func stopPlayback() {
        playTask?.cancel(); playTask = nil
        GameAudio.shared.stopSpeech()
    }

    func resetIdle(idleMinutes: Int) {
        idleTask?.cancel()
        let mins = max(1, min(10, idleMinutes))
        idleTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(mins) * 60_000_000_000)
            if !Task.isCancelled { clear() }
        }
    }

    /// Play every staged word in order — the tile's recorded clip (the voice
    /// the parent picked) first, TTS fallback. Sequential, like the web ▶.
    @ObservationIgnored private var playTask: Task<Void, Never>?

    /// Mirror of the server's clip slug (demoSlug in _lab-demo-audio.js) —
    /// must stay in lockstep with it and the practice board's copy.
    static func termSlug(_ s: String) -> String {
        let lowered = s.lowercased()
        var out = ""
        var lastDash = true
        for ch in lowered {
            if (ch.isLetter || ch.isNumber), ch.isASCII {
                out.append(ch); lastDash = false
            } else if !lastDash {
                out.append("-"); lastDash = true
            }
        }
        if out.hasSuffix("-") { out.removeLast() }
        return out
    }

    func playAll(childId: String, idleMinutes: Int, voiceClipPrefix: String? = nil, voiceClipExt: String = ".mp3") {
        guard !staged.isEmpty else { return }
        stopPlayback()   // restart semantics — never two loops at once
        resetIdle(idleMinutes: idleMinutes)
        let list = staged
        // Log the spoken sentence (fire-and-forget) — Sentence activity panel.
        // display = the synonym when one located the tile: the log stays honest.
        Task { await APIClient().logSentence(childId: childId, words: list.map(\.display)) }
        playTask = Task { @MainActor in
            for entry in list {
                if Task.isCancelled { return }
                if let spoken = entry.spoken {
                    // A synonym is UTTERED as said. Prefer the pre-rendered
                    // clip in the child's OWN voice (voice-terms/<voiceId>/,
                    // built in the Voice library) — offline, instant, and
                    // unmetered; a miss falls through to the TTS path.
                    if let prefix = voiceClipPrefix,
                       let url = try? await MediaCache.shared.audioFileURL(for: prefix + Self.termSlug(spoken) + voiceClipExt) {
                        await GameAudio.shared.playFileAwait(url)
                    } else {
                        await GameAudio.shared.speakAwait(spoken, childId: childId)
                    }
                    continue
                }
                if let key = entry.tile.soundKey, !key.isEmpty,
                   let url = try? await MediaCache.shared.audioFileURL(for: key) {
                    await GameAudio.shared.playFileAwait(url)
                } else {
                    await GameAudio.shared.speakAwait(entry.display, childId: childId)
                }
            }
        }
    }
}

/// The header's sentence strip: staged chips (tap to take one back out) and
/// the ▶ that plays the whole sentence. Replaces ALL other header content
/// while composing — the bar goes back to normal when the strip empties.
struct SentenceStripView: View {
    @Environment(SentenceBar.self) private var sentence
    @Environment(AccessPrefs.self) private var access
    @Environment(AuthManager.self) private var auth
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(BoardStore.self) private var board

    var body: some View {
        // #15 parity: the sentence chips follow the LISTENING tile size — the
        // header already grows by listenScale while the bar is active, so
        // fixed-size chips looked tiny inside the enlarged bar.
        let scale = prefs.listenScale
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(sentence.staged) { entry in
                        SentenceChip(tile: entry.tile, scale: scale, spoken: entry.spoken) {
                            sentence.remove(entry, idleMinutes: access.sentenceIdleMin)
                        }
                    }
                }
                .padding(.leading, 10)
            }
            // Quick clear — a mis-tap costs one rebuild; a stuck sentence
            // would cost the whole feature. Deliberately a short tap.
            Button {
                sentence.clear()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 60, height: 60)
                    .background(Circle().fill(Color.white.opacity(0.22)))
            }
            .buttonStyle(.plain)
            Button {
                sentence.playAll(childId: auth.childSlug, idleMinutes: access.sentenceIdleMin,
                                 voiceClipPrefix: board.voiceClipPrefix, voiceClipExt: board.voiceClipExt)
            } label: {
                Image(systemName: "play.fill")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 60, height: 60)
                    .background(Circle().fill(Color(hex: "#2e7d32")))
            }
            .buttonStyle(.plain)
            .padding(.trailing, 12)
        }
        .frame(height: 92 * scale)
    }
}

private struct SentenceChip: View {
    let tile: Tile
    var scale: Double = 1
    /// The synonym that located this tile ("sparkle" on the star tile) —
    /// shown as the chip's band on EVERY board, since the word being said
    /// is the word the child chose. nil = the tile's own label.
    var spoken: String? = nil
    let onRemove: () -> Void
    @State private var image: UIImage?
    /// Practice board only (nil on real boards): staged chips carry the label
    /// as a band across the image bottom, same as the board tiles and the
    /// listening chips — practice art bakes no text, so a bare picture loses
    /// its word the moment it's staged.
    @Environment(PracticeChrome.self) private var practiceChrome: PracticeChrome?

    private var bandText: String? {
        if let spoken, !spoken.isEmpty { return spoken }
        return practiceChrome != nil ? tile.display : nil
    }

    var body: some View {
        Button(action: onRemove) {
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Text(spoken ?? tile.display)
                        .font(.system(size: 16 * scale, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: "#ad1457"))
                        .lineLimit(2)
                        .minimumScaleFactor(0.5)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                        // Bottom inset so the rounded-corner clip below can't
                        // shave the last line's descenders (g/y/p) — the same
                        // fix ListenTileChip's band got.
                        .padding(.bottom, 3)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(hex: "#fce4ec"))
                }
            }
            .frame(width: 76 * scale, height: 76 * scale)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(alignment: .bottom) {
                if image != nil, let bandText {
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
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.black.opacity(0.08)))
        }
        .buttonStyle(.plain)
        .task(id: tile.imageKey) {
            if let key = tile.imageKey, !key.isEmpty {
                // Enlarged chips decode a step sharper; still bounded (C7).
                image = await MediaCache.shared.image(for: key, maxPixel: scale > 1 ? 512 : 256)
            }
        }
    }
}

/// The floating copy of the tile that follows the finger during a lift —
/// rendered by BoardView's overlay in the shared "board" coordinate space.
struct SentenceDragGhost: View {
    let tile: Tile
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(tile.display)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .lineLimit(2)
                    .minimumScaleFactor(0.5)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 6)
                    .padding(.bottom, 3)  // rounded clip must not shave descenders
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(hex: "#fce4ec"))
            }
        }
        .frame(width: 88, height: 88)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.3), radius: 12, y: 6)
        .opacity(0.92)
        .allowsHitTesting(false)
        .task(id: tile.imageKey) {
            if let key = tile.imageKey, !key.isEmpty {
                image = await MediaCache.shared.image(for: key, maxPixel: 256)
            }
        }
    }
}

/// Big paddle buttons for button-navigation mode — replaces scrolling for
/// eye-tracker / switch users. Shared by the strips (◀ ▶) and grids (▲ ▼).
struct PagerBar: View {
    let vertical: Bool
    let page: Int
    let pageCount: Int
    let onPrev: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            paddle(vertical ? "chevron.up" : "chevron.left",
                   disabled: page <= 0, action: onPrev)
            paddle(vertical ? "chevron.down" : "chevron.right",
                   disabled: page >= pageCount - 1, action: onNext)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
    }

    private func paddle(_ icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Color(hex: "#2b3a55"))
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(RoundedRectangle(cornerRadius: 12).fill(.white))
                .overlay(RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(hex: "#c9d5e8"), lineWidth: 2))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.25 : 1)
    }
}

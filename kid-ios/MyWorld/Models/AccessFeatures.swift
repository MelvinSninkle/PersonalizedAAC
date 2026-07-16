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
    // Safety controls (synced, for older/capable kids):
    //   easyClose  — game ✕ closes on a quick tap instead of the 0.7s hold.
    //   easyUnlock — the lock opens edit mode without the unlock sheet.
    @MainActor static var easyClose = false
    @MainActor static var easyUnlock = false
}

/// The five access keys, defaulted to the shipped behavior.
@Observable
final class AccessPrefs {
    var navMode: String = "scroll"            // "scroll" | "buttons"
    var sentenceBuilder: Bool = false
    var sentenceIdleMin: Int = 1              // 1–10 minutes
    var sentenceLift: String = "longpress"    // legacy — the pencil replaced lift gestures
    var listenRepeatNav: Bool = true
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

    var buttonsNav: Bool { navMode == "buttons" }

    @ObservationIgnored private var childId: String?

    func attach(childId: String) {
        guard self.childId != childId else { return }
        self.childId = childId
        refresh()
    }

    /// Re-read from the server (board .refreshable / relaunch pick changes up).
    func refresh() {
        guard let childId else { return }
        Task { @MainActor in
            let s = await APIClient().childSettings(childId: childId)
            navMode = (s["navMode"] as? String) == "buttons" ? "buttons" : "scroll"
            sentenceBuilder = (s["sentenceBuilder"] as? Bool) ?? false
            let m = (s["sentenceIdleMin"] as? Int) ?? Int(s["sentenceIdleMin"] as? Double ?? 1)
            sentenceIdleMin = (1...10).contains(m) ? m : 1
            sentenceLift = (s["sentenceLift"] as? String) == "drag" ? "drag" : "longpress"
            listenRepeatNav = (s["listenRepeatNav"] as? Bool) ?? true
            toolListen = (s["toolListen"] as? Bool) ?? true
            toolTeach = (s["toolTeach"] as? Bool) ?? true
            toolPlay = (s["toolPlay"] as? Bool) ?? true
            toolSentence = (s["toolSentence"] as? Bool) ?? true
            sentenceDrag = (s["sentenceDrag"] as? Bool) ?? false
            listenCensor = (s["listenCensor"] as? Bool) ?? true
            listenTilesOnly = (s["listenTilesOnly"] as? Bool) ?? false
            // Touch + safety controls ride the same settings fetch (root keys too).
            TouchConfig.interrupt = (s["tapInterrupt"] as? Bool) ?? false
            TouchConfig.doubleTapTeach = (s["doubleTapTeach"] as? Bool) ?? false
            TouchConfig.easyClose = (s["easyClose"] as? Bool) ?? false
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

    func category(_ s: BoardSection) -> Int? { cat[s] }
    func subcategory(_ s: BoardSection) -> Int? { sub[s] }
    func setCategory(_ s: BoardSection, _ id: Int?) { cat[s] = id }
    func setSubcategory(_ s: BoardSection, _ id: Int?) { sub[s] = id }

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

    var staged: [Tile] = []
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

    func dragUpdate(_ tile: Tile, at point: CGPoint) {
        drag = Drag(tile: tile, point: point, overHeader: point.y <= Self.dropZoneMaxY)
    }

    /// Ends the drag; returns true when the tile landed on the bar.
    func dragEnd(at point: CGPoint) -> Bool {
        let hit = point.y <= Self.dropZoneMaxY
        drag = nil
        return hit
    }

    func dragCancel() { drag = nil }

    static let maxWords = 25   // a sentence, not a filibuster

    func stage(_ tile: Tile, idleMinutes: Int) {
        guard staged.count < Self.maxWords else { return }
        staged.append(tile)
        resetIdle(idleMinutes: idleMinutes)
        armModeTimer()
    }

    func remove(_ tile: Tile, idleMinutes: Int) {
        if let i = staged.firstIndex(where: { $0.id == tile.id }) { staged.remove(at: i) }
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

    func playAll(childId: String, idleMinutes: Int) {
        guard !staged.isEmpty else { return }
        stopPlayback()   // restart semantics — never two loops at once
        resetIdle(idleMinutes: idleMinutes)
        let list = staged
        playTask = Task { @MainActor in
            for tile in list {
                if Task.isCancelled { return }
                if let key = tile.soundKey, !key.isEmpty,
                   let url = try? await MediaCache.shared.audioFileURL(for: key) {
                    await GameAudio.shared.playFileAwait(url)
                } else {
                    await GameAudio.shared.speakAwait(tile.display, childId: childId)
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

    var body: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(sentence.staged.enumerated()), id: \.offset) { _, tile in
                        SentenceChip(tile: tile) {
                            sentence.remove(tile, idleMinutes: access.sentenceIdleMin)
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
                sentence.playAll(childId: auth.childSlug, idleMinutes: access.sentenceIdleMin)
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
        .frame(height: 92)
    }
}

private struct SentenceChip: View {
    let tile: Tile
    let onRemove: () -> Void
    @State private var image: UIImage?

    var body: some View {
        Button(action: onRemove) {
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Text(tile.display)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: "#ad1457"))
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(hex: "#fce4ec"))
                }
            }
            .frame(width: 76, height: 76)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.black.opacity(0.08)))
        }
        .buttonStyle(.plain)
        .task(id: tile.imageKey) {
            if let key = tile.imageKey, !key.isEmpty {
                image = await MediaCache.shared.image(for: key, maxPixel: 256)
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

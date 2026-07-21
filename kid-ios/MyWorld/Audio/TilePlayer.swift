import Foundation
import AVFoundation

/// Plays a tile's audio. Three-level fallback:
///   1. If the tile has a cached/cacheable `soundKey`, play that file via
///      AVAudioPlayer (fastest, exact audio the parent picked).
///   2. If no `soundKey`, speak the label via AVSpeechSynthesizer.
///   3. If even speech is unavailable, no-op (we never block UI).
///
/// Audio is configured in `MyWorldApp.setupAudioSession()` to play even with
/// the iPad's silent switch on — same behavior parents expect from kids' apps.
@MainActor
final class TilePlayer {
    static let shared = TilePlayer()

    private var player: AVAudioPlayer?
    private let speech = AVSpeechSynthesizer()

    // Tap-to-learn bookkeeping (mirrors the web board's tapSpeak): the fact
    // index walks 0→1→2 across rapid re-taps; the window comes from the
    // parent's TouchConfig.teachTapMs slider. While a fact is speaking ALL
    // board taps are ignored (facts are deliberately not interruptible —
    // without this, queued play() Tasks talked over each other), and the
    // re-tap window restarts when the fact ENDS, so the next tap continues
    // the cycle at the listener's pace instead of racing the clock.
    private var lastTapTileId: Int?
    private var lastTapAt: Date = .distantPast
    private var teachIdx = 0
    private var clueSpeaking = false

    /// Plays a tile's audio AND (when `childId` is provided) logs the tap.
    ///
    /// FREE-TAP CALLERS on the board MUST pass `childId`, otherwise nothing
    /// lands in the events table — Top Words / Use / Word History / mastery
    /// all silently empty out. This was the entire cause of "we stopped
    /// collecting board taps when the SwiftUI app shipped": the original
    /// implementation called this without childId AND sent a bare event
    /// (not the `{ events: [{...}] }` shape the server requires), so every
    /// tap was either rejected as 400 or fell back to the literal 'fletcher'
    /// child_id default.
    ///
    /// GAME/SLIDESHOW CALLERS deliberately omit childId — they log richer
    /// game_attempts via /api/game-log; we don't want to double-count.
    func play(_ tile: Tile,
              childId: String? = nil,
              categoryName: String? = nil,
              subcategoryName: String? = nil) async {
        // Touch controls apply only to logged board taps (childId present) —
        // game/slideshow playback is never gated. Mirrors web tapSpeak:
        // the double-tap-teach check runs BEFORE the interrupt gate, so a
        // second tap teaches even while the first word is still playing.
        if let childId, !childId.isEmpty {
            // A teaching fact mid-speech is not interruptible — the tap is
            // simply ignored (not logged; nothing happened for the child).
            if clueSpeaking { return }
            let now = Date()
            // Tap-to-learn: each re-tap speaks the NEXT fact — tap 2 =
            // fact 1 … tap 4 = fact 3 — then the next tap wraps back to
            // the word itself. Window is the parent's teachTapMs slider,
            // counted from the end of the previous speech.
            if TouchConfig.doubleTapTeach, tile.id == lastTapTileId,
               now.timeIntervalSince(lastTapAt) < Double(TouchConfig.teachTapMs) / 1000.0,
               tile.displayLabel == nil,   // clues are English taxonomy prose
               let clues = tile.descriptiveClues?.prefix(3), !clues.isEmpty {
                if teachIdx < clues.count {
                    let clue = Array(clues)[teachIdx]
                    teachIdx += 1
                    logTap(tile, childId: childId, categoryName: categoryName, subcategoryName: subcategoryName)
                    player?.stop()
                    speech.stopSpeaking(at: .immediate)
                    clueSpeaking = true
                    await GameAudio.shared.speakAwait(clue, childId: childId)
                    clueSpeaking = false
                    lastTapAt = Date()      // window restarts when the fact ENDS
                    return
                }
                // every fact heard → fall through: the word, chain restarts
            }
            lastTapTileId = tile.id
            lastTapAt = now
            teachIdx = 0
            let busy = (player?.isPlaying == true) || speech.isSpeaking
            if busy && !TouchConfig.interrupt { return }   // not logged — the tap was ignored
        }

        // Log the tap (fire-and-forget — UI never waits on analytics).
        if let childId, !childId.isEmpty {
            logTap(tile, childId: childId, categoryName: categoryName, subcategoryName: subcategoryName)
        }

        // 1) Cached audio file.
        if let key = tile.soundKey, !key.isEmpty {
            do {
                let url = try await MediaCache.shared.audioFileURL(for: key)
                try playFile(at: url)
                return
            } catch {
                // fall through to TTS
            }
        }
        // 2) Live TTS via AVSpeechSynthesizer (no network needed).
        speak(tile.label)
    }

    /// Log a board interaction without playing anything — the sentence bar
    /// stages silently (▶ does the talking) but milestones still see combos.
    func logOnly(_ tile: Tile, childId: String?,
                 categoryName: String? = nil, subcategoryName: String? = nil) {
        guard let childId, !childId.isEmpty else { return }
        logTap(tile, childId: childId, categoryName: categoryName, subcategoryName: subcategoryName)
    }

    /// The server expects { events: [{ ... }] }; sending a bare event
    /// object hits the 400 'events array required' branch silently.
    private func logTap(_ tile: Tile, childId: String,
                        categoryName: String?, subcategoryName: String?) {
        let event: [String: Any] = [
            "role":            "student",
            "itemId":          tile.id,
            "section":         tile.section.rawValue,
            "label":           tile.label,
            "categoryName":    categoryName    as Any,
            "subcategoryName": subcategoryName as Any,
            "occurredAt":      ISO8601DateFormatter().string(from: Date()),
        ]
        Task.detached(priority: .background) {
            await APIClient().logEvent([
                "childId": childId,
                "events":  [event],
            ])
        }
    }

    private func playFile(at url: URL) throws {
        // Tear down any in-flight player so rapid taps don't pile up.
        player?.stop()
        let p = try AVAudioPlayer(contentsOf: url)
        p.prepareToPlay()
        p.play()
        player = p
    }

    private func speak(_ text: String) {
        speech.stopSpeaking(at: .immediate)
        let utter = AVSpeechUtterance(string: text)
        // A friendly default — Samantha (en-US) is the iOS default voice.
        utter.voice = AVSpeechSynthesisVoice(language: "en-US")
        utter.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        speech.speak(utter)
    }
}

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

    // Double-tap-teach bookkeeping (mirrors the web board's tapSpeak).
    private var lastTapTileId: Int?
    private var lastTapAt: Date = .distantPast
    private static let doubleTapWindow: TimeInterval = 2.5

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
            let now = Date()
            if TouchConfig.doubleTapTeach, tile.id == lastTapTileId,
               now.timeIntervalSince(lastTapAt) < Self.doubleTapWindow,
               tile.displayLabel == nil,   // clues are English taxonomy prose
               let clues = tile.descriptiveClues?.prefix(3), !clues.isEmpty {
                lastTapTileId = nil
                logTap(tile, childId: childId, categoryName: categoryName, subcategoryName: subcategoryName)
                player?.stop()
                speech.stopSpeaking(at: .immediate)
                for clue in clues { await GameAudio.shared.speakAwait(clue, childId: childId) }
                return
            }
            lastTapTileId = tile.id
            lastTapAt = now
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

import Foundation
import AVFoundation

/// Game-mode audio, mirroring the web app:
///   - Background music loops quietly during a game (from the parent's reward
///     settings; default /audio/color-tap-learn.mp3).
///   - A vocalized cheer plays on completion (a random phrase from the parent's
///     reward phrases, spoken via /api/tts in the app's ElevenLabs voice).
///
/// All three (music + the matching word + the cheer) mix together because the
/// audio session is .playback. Players are retained as properties so they keep
/// playing; dropping the reference would cut the sound.
///
/// Not @MainActor: the view calls these from nonisolated helpers (game-advance
/// closures). AVAudioPlayer is safe to create/control off the main thread, and
/// only one game runs at a time so the player properties aren't contended.
final class GameAudio {
    static let shared = GameAudio()

    private var musicPlayer: AVAudioPlayer?
    private var cheerPlayer: AVAudioPlayer?
    private var musicCache: [String: Data] = [:]
    private let api = APIClient()

    /// Default cheers if the parent hasn't set any in the rewards panel.
    private static let defaultPhrases = [
        "Hooray! I'm so proud of you!",
        "You did it!",
        "Way to go!",
    ]
    private static let defaultMusic = "/audio/color-tap-learn.mp3"

    // MARK: -- Music

    /// Start looping music. `override` (from a launcher command) wins over the
    /// parent's saved rewards music when provided.
    func startMusic(childId: String, override: String? = nil) {
        Task {
            let chosen: String?
            if let override { chosen = override }
            else { chosen = await api.fetchRewards(childId: childId).music }

            // An explicit empty-string music choice means "No music".
            guard chosen != "" else { return }
            let path = (chosen?.isEmpty == false) ? chosen! : Self.defaultMusic

            let data: Data?
            if let cached = musicCache[path] {
                data = cached
            } else {
                data = await api.fetchAudioData(path: path)
                if let d = data { musicCache[path] = d }
            }
            guard let d = data else { return }
            do {
                let p = try AVAudioPlayer(data: d)
                p.numberOfLoops = -1          // loop until stopped
                p.volume = 0.45
                p.prepareToPlay()
                p.play()
                musicPlayer = p
            } catch {
                // Non-fatal — game just runs without music.
            }
        }
    }

    func stopMusic() {
        musicPlayer?.stop()
        musicPlayer = nil
    }

    // MARK: -- Cheer

    /// Speak an arbitrary phrase in the app voice (used by scheduled prompts /
    /// reminder toasts). Same /api/tts path as the cheers — different player so
    /// it won't clobber the cheer mid-celebration.
    private var speakPlayer: AVAudioPlayer?
    func speak(_ text: String, childId: String) {
        Task {
            guard let data = await api.tts(text: text, emotion: "default") else { return }
            do {
                let p = try AVAudioPlayer(data: data)
                p.volume = 1.0
                p.prepareToPlay()
                p.play()
                speakPlayer = p
            } catch { }
        }
    }

    /// Pick a random cheer phrase and speak it (plays over the music, which the
    /// caller stops a moment later — same as the web's celebration).
    func playCheer(childId: String) {
        Task {
            let rewards = await api.fetchRewards(childId: childId)
            let phrases = rewards.phrases.isEmpty ? Self.defaultPhrases : rewards.phrases
            let phrase = phrases.randomElement() ?? "Hooray!"
            guard let data = await api.tts(text: phrase, emotion: "excited") else { return }
            do {
                let p = try AVAudioPlayer(data: data)
                p.volume = 1.0
                p.prepareToPlay()
                p.play()
                cheerPlayer = p
            } catch {
                // Non-fatal.
            }
        }
    }
}

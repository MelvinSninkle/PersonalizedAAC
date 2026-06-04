import Foundation
import Observation

/// Translates incoming LiveCommands into a runnable game session. The UI
/// observes `current` (which game is on screen) and `inGameCommand` (mark /
/// next / skip directives the running game should act on).
@Observable
final class GameController {
    enum Mode: String { case slideshow, matching, celebration }

    struct Session: Identifiable, Equatable {
        let id = UUID()
        let mode: Mode
        let scope: String?          // "all" | "people"/"nouns"/"verbs" | "cat:<id>"
        let choices: Int?           // matching only
        let from: Int?              // optional range slice (e.g. Numbers 1–20)
        let to: Int?
    }

    /// The active game session — non-nil means the kid sees a full-screen game.
    var current: Session?

    /// Latest mid-game directive (mark / next / skip) for the running view to
    /// consume. Carries the command's seq so the view can dedupe.
    var inGameCommand: LiveCommand?

    /// Apply a freshly-received LiveCommand.
    ///   - "start": opens the right game. The therapist console sends matching
    ///     WITHOUT a `mode` field, so a missing/unknown mode defaults to
    ///     matching (that's the only thing that console drives).
    ///   - "end": closes whatever was running.
    ///   - everything else (mark/next/skip): handed to the running view.
    func apply(_ cmd: LiveCommand) {
        switch cmd.action {
        case "start":
            guard current == nil else { return }   // ignore re-starts mid-game
            let mode = cmd.mode.flatMap(Mode.init(rawValue:)) ?? .matching
            current = Session(
                mode: mode,
                scope: cmd.scope,
                choices: cmd.choices,
                from: cmd.from.map { Int($0) },
                to: cmd.to.map { Int($0) }
            )
        case "end":
            current = nil
            inGameCommand = nil
        default:
            inGameCommand = cmd
        }
    }

    /// Locally start a mode without an incoming live command (e.g. a future
    /// on-tablet "Play" button).
    func startLocal(_ mode: Mode, scope: String? = nil, choices: Int? = nil) {
        current = Session(mode: mode, scope: scope, choices: choices, from: nil, to: nil)
    }

    func consumeInGameCommand() { inGameCommand = nil }
    func stop() { current = nil; inGameCommand = nil }
}

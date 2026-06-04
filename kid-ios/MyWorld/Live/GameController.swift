import Foundation
import Observation

/// Translates incoming LiveCommands into a runnable game session. The UI
/// observes `current` and presents whichever mode it represents.
@Observable
final class GameController {
    enum Mode: String { case slideshow, matching, celebration }

    struct Session: Identifiable, Equatable {
        let id = UUID()
        let mode: Mode
        let scope: String?         // category id (web sends slug-like strings) or "all"
        let choices: Int?           // matching only
        let secondsPerImage: Double?
        let labelStyle: String?
        let limitMin: Double?
    }

    /// The active game session — non-nil means the kid sees a full-screen game.
    var current: Session?

    /// Apply a freshly-received LiveCommand. "start" launches the right mode;
    /// "end" closes whatever was running.
    func apply(_ cmd: LiveCommand) {
        switch cmd.action {
        case "start":
            guard let mode = cmd.mode.flatMap(Mode.init(rawValue:)) else {
                // Unknown mode — bail silently; the iPad doesn't lock up.
                return
            }
            current = Session(
                mode: mode,
                scope: cmd.scope,
                choices: cmd.choices,
                secondsPerImage: cmd.secondsPerImage,
                labelStyle: cmd.labelStyle,
                limitMin: cmd.limitMin
            )
        case "end":
            current = nil
        default:
            // "next" / "mark" handled inside the running mode's own view.
            break
        }
    }

    /// Locally start a mode without an incoming live command (e.g. from the
    /// parent-mode "Play" pill on the iPad itself).
    func startLocal(_ mode: Mode, scope: String? = nil, choices: Int? = nil) {
        current = Session(mode: mode, scope: scope, choices: choices,
                          secondsPerImage: nil, labelStyle: nil, limitMin: nil)
    }

    func stop() { current = nil }
}

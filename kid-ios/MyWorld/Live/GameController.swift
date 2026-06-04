import Foundation
import Observation

/// Translates incoming LiveCommands into a runnable game session. The UI
/// observes `current` (which mode is on screen) and `inGameCommand` (mark /
/// next / skip directives the running view should act on).
@Observable
final class GameController {
    enum Mode: Equatable {
        case matching
        case slideshow(firstPerson: Bool)   // Learn (plain) vs Exposure (first-person)
        case celebration
    }

    struct Session: Identifiable, Equatable {
        let id = UUID()
        let mode: Mode
        let scope: String?          // "all" | "people"/"nouns"/"verbs" | "cat:<id>"
        let choices: Int?           // matching only
        let from: Int?
        let to: Int?
        let sample: Int?
        let limitMin: Double?
        let secondsPerImage: Double?   // slideshow pacing (default applied in the view)
        let music: String?             // optional music override
    }

    var current: Session?
    var inGameCommand: LiveCommand?

    /// Map the web app's mode vocabulary to our native modes:
    ///   self_paced / facilitated / matching / (nil) → matching
    ///   learn_slideshow                              → slideshow (plain labels)
    ///   exposure_slideshow                           → slideshow (first-person)
    ///   slideshow                                    → slideshow (plain)
    ///   celebration                                  → celebration
    private func resolveMode(_ raw: String?) -> Mode {
        switch raw {
        case "learn_slideshow", "slideshow":  return .slideshow(firstPerson: false)
        case "exposure_slideshow":            return .slideshow(firstPerson: true)
        case "celebration":                   return .celebration
        default:                              return .matching   // self_paced/facilitated/nil
        }
    }

    func apply(_ cmd: LiveCommand) {
        switch cmd.action {
        case "start":
            guard current == nil else { return }
            // The labelStyle field also distinguishes plain vs first-person when
            // the mode is a bare "slideshow".
            var mode = resolveMode(cmd.mode)
            if case .slideshow = mode, cmd.labelStyle == "first_person" {
                mode = .slideshow(firstPerson: true)
            }
            current = Session(
                mode: mode,
                scope: cmd.scope,
                choices: cmd.choices,
                from: cmd.from.map { Int($0) },
                to: cmd.to.map { Int($0) },
                sample: cmd.sample.map { Int($0) },
                limitMin: cmd.limitMin,
                secondsPerImage: cmd.secondsPerImage,
                music: cmd.music
            )
        case "end":
            current = nil
            inGameCommand = nil
        default:
            inGameCommand = cmd
        }
    }

    func startLocal(_ mode: Mode, scope: String? = nil, choices: Int? = nil) {
        current = Session(mode: mode, scope: scope, choices: choices,
                          from: nil, to: nil, sample: nil, limitMin: nil,
                          secondsPerImage: nil, music: nil)
    }

    func consumeInGameCommand() { inGameCommand = nil }
    func stop() { current = nil; inGameCommand = nil }
}

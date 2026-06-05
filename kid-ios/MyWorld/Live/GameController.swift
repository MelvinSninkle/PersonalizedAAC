import Foundation
import Observation

/// Translates incoming LiveCommands into a runnable game session. The UI
/// observes `current` (which mode is on screen) and `inGameCommand` (mark /
/// next / skip directives the running view should act on).
@Observable
final class GameController {
    enum Mode: Equatable {
        case matching
        /// PRD §5 "Auditory comprehension" — hear a description, pick the picture.
        /// Same lifecycle as matching; differs only in the prompt source (the
        /// item's description text via TTS, not the recorded label audio).
        case auditoryComprehension
        /// PRD §5 "Expressive naming" — image shown alone, no audio prompt;
        /// child speaks/gestures the answer unaided. Facilitator marks via the
        /// live-session bridge with method = verbal / gesture / object.
        case expressiveNaming
        case slideshow(firstPerson: Bool)
        case celebration
    }

    struct Session: Identifiable, Equatable {
        let id = UUID()
        let mode: Mode
        let scope: String?
        let choices: Int?
        let from: Int?
        let to: Int?
        let sample: Int?
        let limitMin: Double?
        let secondsPerImage: Double?
        let music: String?
    }

    var current: Session?
    var inGameCommand: LiveCommand?

    /// When a routine is running, the queued steps + cursor. Each step builds a
    /// Session that runs to completion, then we auto-advance to the next.
    /// `runRoutine(_:)` kicks one off; the view's onExit handler nudges along.
    private var routineSteps: [RoutineStep] = []
    private var routineIndex = 0
    var isRoutineActive: Bool { !routineSteps.isEmpty && routineIndex < routineSteps.count }

    private func resolveMode(_ raw: String?) -> Mode {
        switch raw {
        case "learn_slideshow", "slideshow":  return .slideshow(firstPerson: false)
        case "exposure_slideshow":            return .slideshow(firstPerson: true)
        case "celebration":                   return .celebration
        case "auditory_comprehension":        return .auditoryComprehension
        case "expressive_naming":             return .expressiveNaming
        default:                              return .matching
        }
    }

    func apply(_ cmd: LiveCommand) {
        switch cmd.action {
        case "start":
            guard current == nil, !isRoutineActive else { return }
            // A `start` with `steps` is a routine, not a single session.
            if let steps = cmd.steps, !steps.isEmpty {
                runRoutine(steps); return
            }
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
            abortRoutine()
        default:
            inGameCommand = cmd
        }
    }

    func startLocal(_ mode: Mode, scope: String? = nil, choices: Int? = nil) {
        current = Session(mode: mode, scope: scope, choices: choices,
                          from: nil, to: nil, sample: nil, limitMin: nil,
                          secondsPerImage: nil, music: nil)
    }

    /// Run a saved routine — a chain of slideshow/game/celebration steps.
    func runRoutine(_ steps: [RoutineStep]) {
        guard current == nil else { return }
        routineSteps = Array(steps.prefix(12))
        routineIndex = 0
        startCurrentRoutineStep()
    }

    /// Called by BoardView when a session ends — advances the routine if any.
    /// Returns true if the routine handled the end (caller should NOT clear
    /// live standby until the routine is done).
    @discardableResult
    func sessionDidEnd() -> Bool {
        current = nil
        guard isRoutineActive else { return false }
        routineIndex += 1
        if routineIndex >= routineSteps.count {
            abortRoutine()
            return false
        }
        // Tiny gap so the SwiftUI cover dismiss animation finishes before the
        // next mode pushes (otherwise the cover ignores the new item).
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            self.startCurrentRoutineStep()
        }
        return true
    }

    func abortRoutine() {
        routineSteps = []
        routineIndex = 0
    }

    func consumeInGameCommand() { inGameCommand = nil }

    func stop() {
        current = nil
        inGameCommand = nil
        abortRoutine()
    }

    private func startCurrentRoutineStep() {
        guard routineIndex < routineSteps.count else { abortRoutine(); return }
        let step = routineSteps[routineIndex]
        var mode = resolveMode(step.mode)
        // Slideshow steps in a routine NEED a time limit so we can auto-advance.
        // Web defaults to 3 minutes when missing — match that.
        var limit = step.limitMin
        if case .slideshow = mode, (limit ?? 0) <= 0 { limit = 3 }
        if case .slideshow = mode {} else { /* no extra handling */ }
        // labelStyle isn't a step field, so we use mode alone (slideshow/exposure)
        current = Session(
            mode: mode,
            scope: step.scope,
            choices: step.choices,
            from: step.from.map { Int($0) },
            to: step.to.map { Int($0) },
            sample: step.sample.map { Int($0) },
            limitMin: limit,
            secondsPerImage: step.secondsPerImage,
            music: step.music
        )
    }
}

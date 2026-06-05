import Foundation

/// One scheduled prompt — a reminder toast, an interactive question, or a game
/// nudge the parent set up in the web Schedules panel. Stored under
/// `child_settings.schedules` (same shape as the web reads), so the iPad and
/// the web share the exact same list.
struct Schedule: Identifiable, Codable, Equatable {
    enum Kind: String, Codable { case reminder, question, game }
    enum Timing: String, Codable { case times, interval }

    var id: String
    var type: Kind
    var enabled: Bool
    var prompt: String?
    var imageKey: String?
    var days: [Int]?          // 0..6 (Sun..Sat); empty / nil = every day
    var start: String?        // "HH:MM"
    var end: String?          // "HH:MM"
    var timing: Timing
    var times: [String]?      // "HH:MM" list when timing == .times
    var intervalMin: Double?  // when timing == .interval
    // type == .question
    var responses: [Response]?
    var durationSec: Double?
    // type == .game
    var scope: String?
    var scopes: [String]?

    struct Response: Codable, Equatable {
        var label: String
        var imageKey: String?
    }

    /// Lenient decode: child_settings.schedules can have missing fields from
    /// the web side; everything optional except id/type/timing.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        type = (try c.decodeIfPresent(String.self, forKey: .type)).flatMap(Kind.init(rawValue:)) ?? .reminder
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        prompt = try c.decodeIfPresent(String.self, forKey: .prompt)
        imageKey = try c.decodeIfPresent(String.self, forKey: .imageKey)
        days = try c.decodeIfPresent([Int].self, forKey: .days)
        start = try c.decodeIfPresent(String.self, forKey: .start)
        end = try c.decodeIfPresent(String.self, forKey: .end)
        timing = (try c.decodeIfPresent(String.self, forKey: .timing)).flatMap(Timing.init(rawValue:)) ?? .interval
        times = try c.decodeIfPresent([String].self, forKey: .times)
        intervalMin = try c.decodeIfPresent(Double.self, forKey: .intervalMin)
        responses = try c.decodeIfPresent([Response].self, forKey: .responses)
        durationSec = try c.decodeIfPresent(Double.self, forKey: .durationSec)
        scope = try c.decodeIfPresent(String.self, forKey: .scope)
        scopes = try c.decodeIfPresent([String].self, forKey: .scopes)
    }

    var defaultPromptText: String {
        if let p = prompt?.trimmingCharacters(in: .whitespaces), !p.isEmpty { return p }
        switch type {
        case .game:     return "Let's do a game!"
        case .question: return "A quick question."
        case .reminder: return "Time for a check-in."
        }
    }
}

/// One step in a saved routine — a chain of slideshow/game/celebration runs.
/// Stored under `child_settings.routines[*].steps` (web format) AND sent as
/// the `steps` array on a live `start` command.
struct RoutineStep: Codable, Equatable {
    var mode: String?               // self_paced / facilitated / learn_slideshow / exposure_slideshow / celebration
    var scope: String?              // "all" | "people"/"nouns"/"verbs" | "cat:<id>"
    var choices: Int?
    var limitMin: Double?
    var secondsPerImage: Double?
    var music: String?
    var from: Double?
    var to: Double?
    var sample: Double?
}

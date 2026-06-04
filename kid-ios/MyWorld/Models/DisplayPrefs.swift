import Foundation
import Observation

/// Per-device display preferences — colors, tile-density, what's visible.
/// Persisted to UserDefaults so every device remembers its own layout
/// (same model as the web app's localStorage "device preferences" panel).
@Observable
final class DisplayPrefs {
    var hideLabels: Bool { didSet { save() } }

    var showPeople: Bool { didSet { save() } }
    var showNouns:  Bool { didSet { save() } }
    var showVerbs:  Bool { didSet { save() } }
    var showNeeds:  Bool { didSet { save() } }

    /// Tiles per row inside each section's grid.
    var acrossPeople: Int { didSet { save() } }
    var acrossNouns:  Int { didSet { save() } }
    var acrossVerbs:  Int { didSet { save() } }

    /// Section band background colors (hex). Defaults match the web palette.
    var colorPeople: String { didSet { save() } }
    var colorNouns:  String { didSet { save() } }
    var colorVerbs:  String { didSet { save() } }
    var colorNeeds:  String { didSet { save() } }

    /// Header strip colors (hex).
    var colorHeaderBg:   String { didSet { save() } }
    var colorHeaderText: String { didSet { save() } }

    // MARK: -- Defaults

    static let defaultPeople     = "#fde7ef"
    static let defaultNouns      = "#fff4cc"
    static let defaultVerbs      = "#dcefe2"
    static let defaultNeeds      = "#fff7e6"
    static let defaultHeaderBg   = "#ff1493"
    static let defaultHeaderText = "#ffffff"

    init() {
        let d = UserDefaults.standard
        // bool defaults: missing keys read as `false`; we want most to start true
        self.hideLabels    = d.object(forKey: "pref.hideLabels") as? Bool ?? false
        self.showPeople    = d.object(forKey: "pref.showPeople") as? Bool ?? true
        self.showNouns     = d.object(forKey: "pref.showNouns")  as? Bool ?? true
        self.showVerbs     = d.object(forKey: "pref.showVerbs")  as? Bool ?? true
        self.showNeeds     = d.object(forKey: "pref.showNeeds")  as? Bool ?? true
        self.acrossPeople  = d.object(forKey: "pref.acrossPeople") as? Int ?? 2
        self.acrossNouns   = d.object(forKey: "pref.acrossNouns")  as? Int ?? 4
        self.acrossVerbs   = d.object(forKey: "pref.acrossVerbs")  as? Int ?? 2
        self.colorPeople   = d.string(forKey: "pref.colorPeople") ?? Self.defaultPeople
        self.colorNouns    = d.string(forKey: "pref.colorNouns")  ?? Self.defaultNouns
        self.colorVerbs    = d.string(forKey: "pref.colorVerbs")  ?? Self.defaultVerbs
        self.colorNeeds    = d.string(forKey: "pref.colorNeeds")  ?? Self.defaultNeeds
        self.colorHeaderBg   = d.string(forKey: "pref.colorHeaderBg")   ?? Self.defaultHeaderBg
        self.colorHeaderText = d.string(forKey: "pref.colorHeaderText") ?? Self.defaultHeaderText
    }

    func resetToDefaults() {
        hideLabels = false
        showPeople = true; showNouns = true; showVerbs = true; showNeeds = true
        acrossPeople = 2; acrossNouns = 4; acrossVerbs = 2
        colorPeople = Self.defaultPeople
        colorNouns  = Self.defaultNouns
        colorVerbs  = Self.defaultVerbs
        colorNeeds  = Self.defaultNeeds
        colorHeaderBg   = Self.defaultHeaderBg
        colorHeaderText = Self.defaultHeaderText
    }

    // MARK: -- Per-section accessors

    func across(_ section: BoardSection) -> Int {
        switch section {
        case .people: return acrossPeople
        case .nouns:  return acrossNouns
        case .verbs:  return acrossVerbs
        case .needs:  return 1   // unused; needs renders as a single horizontal row
        }
    }

    func color(_ section: BoardSection) -> String {
        switch section {
        case .people: return colorPeople
        case .nouns:  return colorNouns
        case .verbs:  return colorVerbs
        case .needs:  return colorNeeds
        }
    }

    func show(_ section: BoardSection) -> Bool {
        switch section {
        case .people: return showPeople
        case .nouns:  return showNouns
        case .verbs:  return showVerbs
        case .needs:  return showNeeds
        }
    }

    // MARK: -- Persistence

    private func save() {
        let d = UserDefaults.standard
        d.set(hideLabels,   forKey: "pref.hideLabels")
        d.set(showPeople,   forKey: "pref.showPeople")
        d.set(showNouns,    forKey: "pref.showNouns")
        d.set(showVerbs,    forKey: "pref.showVerbs")
        d.set(showNeeds,    forKey: "pref.showNeeds")
        d.set(acrossPeople, forKey: "pref.acrossPeople")
        d.set(acrossNouns,  forKey: "pref.acrossNouns")
        d.set(acrossVerbs,  forKey: "pref.acrossVerbs")
        d.set(colorPeople,  forKey: "pref.colorPeople")
        d.set(colorNouns,   forKey: "pref.colorNouns")
        d.set(colorVerbs,   forKey: "pref.colorVerbs")
        d.set(colorNeeds,   forKey: "pref.colorNeeds")
        d.set(colorHeaderBg,   forKey: "pref.colorHeaderBg")
        d.set(colorHeaderText, forKey: "pref.colorHeaderText")
    }
}

/// "fletcherpeterson" → "Fletcher" — same helper the web app uses to build
/// "{Name}'s World" in the header.
func prettyChildName(_ slug: String?) -> String {
    guard let slug, !slug.isEmpty else { return "" }
    var name = slug
    if name.lowercased().hasSuffix("peterson") {
        name = String(name.dropLast("peterson".count))
    }
    guard let first = name.first else { return slug }
    return String(first).uppercased() + name.dropFirst()
}

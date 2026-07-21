import Foundation
import Observation

/// Codable snapshot of every display preference — the wire format for both
/// UserDefaults backup and the server (stored under `settings.kidDisplay` in
/// child_settings, so all of a child's devices share the same look).
struct DisplayPrefsData: Codable, Equatable {
    var hideLabels: Bool
    var showPeople: Bool, showNouns: Bool, showVerbs: Bool, showNeeds: Bool
    var acrossPeople: Int, acrossNouns: Int, acrossVerbs: Int
    var colorPeople: String, colorNouns: String, colorVerbs: String, colorNeeds: String
    var colorHeaderBg: String, colorHeaderText: String
}

/// Display preferences — colors, tile-density, what's visible. Persisted both
/// to UserDefaults (instant cold-launch) AND to the server via child_settings
/// (so a parent sets the look once and every device for that child matches).
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

    /// #15 low-vision enlargement, steps 0 = normal / 1 = +50% / 2 = +100%.
    /// Deliberately PER-DEVICE (screen sizes differ, same decision as the
    /// web board), so these are excluded from the synced snapshot below.
    var listenTileSize: Int { didSet { save() } }
    var topButtonSize:  Int { didSet { save() } }
    var listenScale: Double { [1.0, 1.5, 2.0][max(0, min(2, listenTileSize))] }
    var topButtonScale: Double { [1.0, 1.5, 2.0][max(0, min(2, topButtonSize))] }

    // MARK: -- Defaults

    // Columns start WHITE so the family picks their own palette (the header
    // color is chosen at signup); only the needs strip keeps a tint.
    static let defaultPeople     = "#ffffff"
    static let defaultNouns      = "#ffffff"
    static let defaultVerbs      = "#ffffff"
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
        self.acrossNouns   = d.object(forKey: "pref.acrossNouns")  as? Int ?? 5
        self.acrossVerbs   = d.object(forKey: "pref.acrossVerbs")  as? Int ?? 2
        self.colorPeople   = d.string(forKey: "pref.colorPeople") ?? Self.defaultPeople
        self.colorNouns    = d.string(forKey: "pref.colorNouns")  ?? Self.defaultNouns
        self.colorVerbs    = d.string(forKey: "pref.colorVerbs")  ?? Self.defaultVerbs
        self.colorNeeds    = d.string(forKey: "pref.colorNeeds")  ?? Self.defaultNeeds
        self.colorHeaderBg   = d.string(forKey: "pref.colorHeaderBg")   ?? Self.defaultHeaderBg
        self.colorHeaderText = d.string(forKey: "pref.colorHeaderText") ?? Self.defaultHeaderText
        self.listenTileSize  = d.object(forKey: "pref.listenTileSize") as? Int ?? 0
        self.topButtonSize   = d.object(forKey: "pref.topButtonSize")  as? Int ?? 0
    }

    func resetToDefaults() {
        hideLabels = false
        showPeople = true; showNouns = true; showVerbs = true; showNeeds = true
        acrossPeople = 2; acrossNouns = 5; acrossVerbs = 2
        colorPeople = Self.defaultPeople
        colorNouns  = Self.defaultNouns
        colorVerbs  = Self.defaultVerbs
        colorNeeds  = Self.defaultNeeds
        colorHeaderBg   = Self.defaultHeaderBg
        colorHeaderText = Self.defaultHeaderText
        listenTileSize  = 0
        topButtonSize   = 0
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

    // MARK: -- Snapshot / apply

    var snapshot: DisplayPrefsData {
        DisplayPrefsData(
            hideLabels: hideLabels,
            showPeople: showPeople, showNouns: showNouns, showVerbs: showVerbs, showNeeds: showNeeds,
            acrossPeople: acrossPeople, acrossNouns: acrossNouns, acrossVerbs: acrossVerbs,
            colorPeople: colorPeople, colorNouns: colorNouns, colorVerbs: colorVerbs, colorNeeds: colorNeeds,
            colorHeaderBg: colorHeaderBg, colorHeaderText: colorHeaderText
        )
    }

    /// Apply a snapshot (from the server) without echoing a save back out.
    func apply(_ d: DisplayPrefsData) {
        isApplying = true
        hideLabels = d.hideLabels
        showPeople = d.showPeople; showNouns = d.showNouns; showVerbs = d.showVerbs; showNeeds = d.showNeeds
        acrossPeople = d.acrossPeople; acrossNouns = d.acrossNouns; acrossVerbs = d.acrossVerbs
        colorPeople = d.colorPeople; colorNouns = d.colorNouns; colorVerbs = d.colorVerbs; colorNeeds = d.colorNeeds
        colorHeaderBg = d.colorHeaderBg; colorHeaderText = d.colorHeaderText
        isApplying = false
    }

    // MARK: -- Server sync

    @ObservationIgnored private var childId: String?
    @ObservationIgnored private var isApplying = false
    @ObservationIgnored private var serverLoaded = false
    @ObservationIgnored private var saveTask: Task<Void, Never>?

    /// Called once the signed-in child is known. Pulls the server copy and
    /// applies it over the local defaults, then enables write-back on change.
    func attach(childId: String) {
        guard self.childId != childId else { return }
        self.childId = childId
        Task { @MainActor in
            ChildNames.shared.refresh(childId)   // real name for the title
            if let data = await APIClient().fetchDisplayPrefs(childId: childId) {
                apply(data)
            }
            serverLoaded = true
        }
    }

    /// Re-pull the server copy on demand (the Display "Refresh board" button),
    /// so changes a parent made elsewhere show up without relaunching.
    func reloadFromServer() {
        guard let childId else { return }
        Task { @MainActor in
            if let data = await APIClient().fetchDisplayPrefs(childId: childId) {
                apply(data)
            }
        }
    }

    /// Debounced server write — coalesces a burst of slider/color edits into a
    /// single POST 0.8s after the last change.
    private func scheduleServerSave() {
        guard serverLoaded, !isApplying, let childId else { return }
        let data = snapshot
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled else { return }
            await APIClient().saveDisplayPrefs(childId: childId, data: data)
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
        d.set(listenTileSize,  forKey: "pref.listenTileSize")
        d.set(topButtonSize,   forKey: "pref.topButtonSize")
        scheduleServerSave()
    }
}

/// Live registry of children's REAL names (the persons roster's is_self row),
/// so titles read "Simon's World" — never a prettified slug like
/// "Simon-5ba4's World" (numbered slugs come from the duplicate-name rule at
/// signup). Cached in UserDefaults for instant cold-launch titles; refreshed
/// whenever the board or the parent home attaches. @Observable, so any view
/// whose body reads a name re-renders the moment the fetch lands.
@Observable
final class ChildNames {
    static let shared = ChildNames()
    private(set) var bySlug: [String: String] = [:]
    @ObservationIgnored private var inFlight: Set<String> = []

    func name(for slug: String?) -> String {
        guard let slug, !slug.isEmpty else { return "" }
        return bySlug[slug] ?? ""
    }

    @MainActor
    func refresh(_ slug: String?) {
        guard let slug, !slug.isEmpty else { return }
        if bySlug[slug] == nil,
           let cached = UserDefaults.standard.string(forKey: "childRealName:\(slug)"), !cached.isEmpty {
            bySlug[slug] = cached
        }
        guard !inFlight.contains(slug) else { return }
        inFlight.insert(slug)
        Task { @MainActor in
            defer { inFlight.remove(slug) }
            guard let persons = try? await APIClient().listPersons(childId: slug),
                  let me = persons.first(where: { $0.isSelf }) else { return }
            let raw = (me.givenName?.isEmpty == false) ? me.givenName! : me.displayName
            let first = raw.split(separator: " ").first.map(String.init) ?? raw
            guard !first.isEmpty else { return }
            bySlug[slug] = first
            UserDefaults.standard.set(first, forKey: "childRealName:\(slug)")
        }
    }
}

/// The child's display name: the REAL name from the persons roster when known,
/// else a prettified slug ("fletcherpeterson" → "Fletcher"; a numbered-dupe
/// suffix like "simon-5ba4"/"ella2" is dropped rather than shown).
func prettyChildName(_ slug: String?) -> String {
    let real = ChildNames.shared.name(for: slug)
    if !real.isEmpty { return real }
    guard let slug, !slug.isEmpty else { return "" }
    var name = slug
    if name.lowercased().hasSuffix("peterson") {
        name = String(name.dropLast("peterson".count))
    }
    if let r = name.range(of: "[-_][a-z0-9]{1,8}$", options: .regularExpression) {
        name.removeSubrange(r)
    }
    if let r = name.range(of: "[0-9]+$", options: .regularExpression) {
        name.removeSubrange(r)
    }
    guard let first = name.first else { return slug }
    return String(first).uppercased() + name.dropFirst()
}

/// The board / app title: "{Name}'s World", or a generic "My World" when no
/// child name is known yet (so an unset account never reads "Fletcher's World").
func worldTitle(_ slug: String?) -> String {
    let n = prettyChildName(slug)
    return n.isEmpty ? "My World" : "\(n)'s World"
}

/// Possessive for copy ("Fletcher's …"), with a generic fallback when unknown.
func childPossessive(_ slug: String?, fallback: String = "your child's") -> String {
    let n = prettyChildName(slug)
    return n.isEmpty ? fallback : "\(n)'s"
}

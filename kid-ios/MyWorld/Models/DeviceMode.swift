import Foundation
import Observation

/// Which experience this physical device renders. One app, two display modes
/// (PRD §1.2): the child's communication board (iPad in Guided Access) or the
/// parent app (usually a phone, occasionally a tablet). Chosen once on first
/// run, persisted in UserDefaults, switchable from either side's settings.
@Observable
final class DeviceMode {
    enum Role: String {
        case unset       // first run — show the picker
        case childBoard  // the board the child taps on
        case parent      // the parent home screen
    }

    var role: Role {
        didSet { UserDefaults.standard.set(role.rawValue, forKey: Self.key) }
    }

    private static let key = "deviceRole"

    init() {
        let raw = UserDefaults.standard.string(forKey: Self.key) ?? ""
        role = Role(rawValue: raw) ?? .unset
    }
}

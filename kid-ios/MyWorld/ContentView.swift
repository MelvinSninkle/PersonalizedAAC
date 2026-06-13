import SwiftUI

/// Root switch. One app, two display modes (PRD §1.2): after login, the
/// device renders either the child's board or the parent home screen based on
/// the role chosen on first run. Same account, same APIs, same stores — just
/// two faces of the same binary, so an iPhone parent and an iPad child are one
/// install with different roles.
struct ContentView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(DeviceMode.self)  private var mode

    var body: some View {
        if !auth.isSignedIn {
            LoginView()
        } else {
            switch mode.role {
            case .unset:      RolePickerView()
            case .childBoard: BoardView()
            case .parent:     ParentHomeView()
            }
        }
    }
}

// MARK: -- Color(hex:) — tiny helper so we can match the web app's exact palette.

extension Color {
    init(hex: String) {
        let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var int: UInt64 = 0
        Scanner(string: s).scanHexInt64(&int)
        let r, g, b, a: UInt64
        switch s.count {
        case 3:   (r, g, b, a) = ((int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17, 255)
        case 6:   (r, g, b, a) = (int >> 16, int >> 8 & 0xFF, int & 0xFF, 255)
        case 8:   (r, g, b, a) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:  (r, g, b, a) = (0, 0, 0, 255)
        }
        self = Color(.sRGB,
                     red: Double(r) / 255,
                     green: Double(g) / 255,
                     blue: Double(b) / 255,
                     opacity: Double(a) / 255)
    }
}

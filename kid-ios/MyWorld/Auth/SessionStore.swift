import Foundation

/// Bundles cookie persistence + the small "who is signed in" record we cache
/// locally so we can render the right child's board on cold launch without
/// blocking on a /api/auth/me round-trip.
///
/// The actual session cookie lives in `HTTPCookieStorage.shared`, which iOS
/// persists across launches in the app's container. We only store the
/// non-secret identifying info here.
struct SignedInUser: Codable, Equatable {
    let email: String
    let role: String
    let slug: String?     // the child this account is tied to (parent role)
}

enum SessionStore {
    private static let key = "myworld.signedInUser"

    static func save(_ user: SignedInUser?) {
        if let user, let data = try? JSONEncoder().encode(user) {
            UserDefaults.standard.set(data, forKey: key)
        } else {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }

    static func load() -> SignedInUser? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(SignedInUser.self, from: data)
    }
}

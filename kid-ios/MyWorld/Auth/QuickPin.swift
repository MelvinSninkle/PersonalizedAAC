import Foundation
import CryptoKit

/// #17 (native): per-device 4-digit quick-unlock PIN for the board's edit
/// gate. Mirrors the web implementation exactly: only a device-salted
/// SHA-256 hash is stored (never the digits), it never syncs, and it's a
/// convenience layer — the account password always works, and five wrong
/// tries fall back to it until a successful unlock resets the counter.
/// Setting, changing, or removing the PIN re-verifies the account password
/// first (see DisplaySettingsView).
enum QuickPin {
    private static let hashKey = "aacQuickPin"
    private static let failsKey = "aacQuickPinFails"

    static func hash(_ pin: String, childId: String) -> String {
        SHA256.hash(data: Data((pin + ":" + childId).utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    static var isSet: Bool {
        !(UserDefaults.standard.string(forKey: hashKey) ?? "").isEmpty
    }

    static var fails: Int { UserDefaults.standard.integer(forKey: failsKey) }
    static var lockedOut: Bool { fails >= 5 }

    static func set(_ pin: String, childId: String) {
        UserDefaults.standard.set(hash(pin, childId: childId), forKey: hashKey)
        resetFails()
    }

    static func remove() {
        UserDefaults.standard.removeObject(forKey: hashKey)
        resetFails()
    }

    /// Compare a candidate PIN; wrong guesses count toward the lockout.
    static func verify(_ pin: String, childId: String) -> Bool {
        guard let stored = UserDefaults.standard.string(forKey: hashKey), !stored.isEmpty else { return false }
        if stored == hash(pin, childId: childId) {
            resetFails()
            return true
        }
        UserDefaults.standard.set(fails + 1, forKey: failsKey)
        return false
    }

    /// Any successful unlock (PIN or password) clears the fail counter.
    static func resetFails() {
        UserDefaults.standard.set(0, forKey: failsKey)
    }
}

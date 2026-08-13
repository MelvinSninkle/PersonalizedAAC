import Foundation
import CryptoKit
import Security

/// #17 (native): per-device 4-digit quick-unlock PIN for the board's edit
/// gate. Mirrors the web implementation: only a salted SHA-256 hash is
/// stored (never the digits), and it's a convenience layer — the account
/// password always works, and five wrong tries fall back to it until a
/// successful unlock resets the counter. Setting, changing, or removing the
/// PIN re-verifies the account password first (see DisplaySettingsView).
///
/// STORAGE: the hash lives in the KEYCHAIN (ThisDeviceOnly), not
/// UserDefaults — keychain items survive app uninstall/reinstall, so a
/// reinstall no longer silently erases the family's PIN. It still never
/// syncs to the server ON PURPOSE: a 4-digit hash is offline-brute-forceable
/// (10,000 candidates), so the host must never hold one; ThisDeviceOnly also
/// keeps it out of iCloud Keychain and device-to-device restores.
enum QuickPin {
    private static let hashKey = "aacQuickPin"
    private static let failsKey = "aacQuickPinFails"
    private static let service = "com.myworldtaptotalk.quickpin"

    static func hash(_ pin: String, childId: String) -> String {
        SHA256.hash(data: Data((pin + ":" + childId).utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    static var isSet: Bool { !(storedHash ?? "").isEmpty }

    static var fails: Int { UserDefaults.standard.integer(forKey: failsKey) }
    static var lockedOut: Bool { fails >= 5 }

    static func set(_ pin: String, childId: String) {
        keychainWrite(hash(pin, childId: childId))
        resetFails()
    }

    static func remove() {
        keychainDelete()
        UserDefaults.standard.removeObject(forKey: hashKey)
        resetFails()
    }

    /// Compare a candidate PIN; wrong guesses count toward the lockout.
    static func verify(_ pin: String, childId: String) -> Bool {
        guard let stored = storedHash, !stored.isEmpty else { return false }
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

    // ── Keychain plumbing ────────────────────────────────────────────────

    /// Current hash: keychain first, with a one-time migration of any hash
    /// still sitting in the legacy UserDefaults slot (pre-keychain builds).
    private static var storedHash: String? {
        if let v = keychainRead(), !v.isEmpty { return v }
        if let legacy = UserDefaults.standard.string(forKey: hashKey), !legacy.isEmpty {
            keychainWrite(legacy)
            UserDefaults.standard.removeObject(forKey: hashKey)
            return legacy
        }
        return nil
    }

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: hashKey]
    }

    private static func keychainRead() -> String? {
        var q = baseQuery
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func keychainWrite(_ value: String) {
        var add = baseQuery
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecValueData as String] = Data(value.utf8)
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem {
            SecItemUpdate(baseQuery as CFDictionary,
                          [kSecValueData as String: Data(value.utf8)] as CFDictionary)
        }
    }

    private static func keychainDelete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

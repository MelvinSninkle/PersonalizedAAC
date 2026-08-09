import Foundation
import Observation

/// Tracks "am I signed in" + "which child board do I render". Lives at the
/// app root and is read by `ContentView` to flip between LoginView and
/// BoardView. iOS 17+ @Observable so SwiftUI re-renders on mutation.
@Observable
final class AuthManager {
    var user: SignedInUser?
    var childSlug: String

    /// #14: true after the "admin" + admin-token demo login. Renders the
    /// style-demo board instead of a family board. Deliberately NOT
    /// persisted — a relaunch returns to the normal sign-in flow, so a demo
    /// iPad never stays unlocked by accident.
    var demoMode = false

    /// Holds the last login error so the LoginView can show it inline.
    var lastError: String?

    private let api: APIClient

    /// Multi-child: the child this device is currently working with. The
    /// session slug names only the FIRST child; a parent who switched via the
    /// family picker keeps that choice across launches.
    private static let activeChildKey = "activeChildSlug"

    init(api: APIClient = APIClient()) {
        self.api = api
        let cached = SessionStore.load()
        self.user = cached
        // The child slug we render: the account's session slug, unless the
        // parent picked a different child from the family switcher (multi-
        // child accounts — the picker AuthManager always said we'd surface).
        self.childSlug = cached?.slug ?? ""
        if let over = UserDefaults.standard.string(forKey: Self.activeChildKey), !over.isEmpty {
            self.childSlug = over
        }
    }

    /// Family switcher: work with this child from now on (persisted).
    @MainActor
    func setActiveChild(_ slug: String) {
        guard !slug.isEmpty else { return }
        childSlug = slug
        UserDefaults.standard.set(slug, forKey: Self.activeChildKey)
    }

    var isSignedIn: Bool { user != nil }

    /// Try logging in. On success caches the user record locally; the cookie
    /// itself is stored by `URLSession` in `HTTPCookieStorage.shared`.
    @MainActor
    func signIn(email: String, password: String) async {
        do {
            let resp = try await api.login(email: email, password: password)
            if resp.demo == true {
                self.demoMode = true
                self.lastError = nil
                return
            }
            guard let ru = resp.user else {
                self.lastError = "Sign-in failed. Please try again."
                return
            }
            let u = SignedInUser(email: ru.email, role: ru.role, slug: ru.slug)
            SessionStore.save(u)
            self.user = u
            // A fresh sign-in may be a different account — the previous
            // family-switcher choice must not leak across accounts.
            UserDefaults.standard.removeObject(forKey: Self.activeChildKey)
            self.childSlug = u.slug ?? self.childSlug
            self.lastError = nil
        } catch {
            self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Leave the demo board and return to the sign-in flow.
    @MainActor
    func exitDemo() {
        demoMode = false
    }

    @MainActor
    func signOut() async {
        await api.logout()
        SessionStore.save(nil)
        UserDefaults.standard.removeObject(forKey: Self.activeChildKey)
        self.user = nil
        // A signed-out device lands on the anonymous practice board so a NEW
        // family can register from it: drop the slug (nothing keeps logging
        // events against the old child) and the persisted board cache (the
        // old family's tiles must never cold-paint for the next account —
        // the native side of the web's A1c cache-owner rule).
        self.childSlug = ""
        BoardStore.deleteDiskCache()
    }

    /// Re-reads /api/auth/me and caches the result locally. Used by external
    /// auth flows (Sign in with Apple, account creation) that set the session
    /// cookie out-of-band and need AuthManager to pick the user up.
    @MainActor
    func refreshFromServer() async {
        do {
            let me = try await api.me()
            if let u = me.user {
                let s = SignedInUser(email: u.email, role: u.role, slug: u.slug)
                SessionStore.save(s)
                self.user = s
                // Mid-session refresh: an active family-switcher choice wins
                // over the session's (first-child) slug.
                if UserDefaults.standard.string(forKey: Self.activeChildKey)?.isEmpty ?? true {
                    self.childSlug = u.slug ?? self.childSlug
                }
                self.lastError = nil
            }
        } catch { /* leave existing state alone on error */ }
    }
}

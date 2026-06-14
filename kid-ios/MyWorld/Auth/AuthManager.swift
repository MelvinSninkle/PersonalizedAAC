import Foundation
import Observation

/// Tracks "am I signed in" + "which child board do I render". Lives at the
/// app root and is read by `ContentView` to flip between LoginView and
/// BoardView. iOS 17+ @Observable so SwiftUI re-renders on mutation.
@Observable
final class AuthManager {
    var user: SignedInUser?
    var childSlug: String

    /// Holds the last login error so the LoginView can show it inline.
    var lastError: String?

    private let api: APIClient

    init(api: APIClient = APIClient()) {
        self.api = api
        let cached = SessionStore.load()
        self.user = cached
        // The child slug we render. Today every parent account is tied to
        // exactly one child via `user.slug`. If we ever support multi-child
        // parents we surface a picker; for now the slug is the user's slug.
        self.childSlug = cached?.slug ?? "fletcherpeterson"
    }

    var isSignedIn: Bool { user != nil }

    /// Try logging in. On success caches the user record locally; the cookie
    /// itself is stored by `URLSession` in `HTTPCookieStorage.shared`.
    @MainActor
    func signIn(email: String, password: String) async {
        do {
            let resp = try await api.login(email: email, password: password)
            let u = SignedInUser(email: resp.user.email, role: resp.user.role, slug: resp.user.slug)
            SessionStore.save(u)
            self.user = u
            self.childSlug = u.slug ?? self.childSlug
            self.lastError = nil
        } catch {
            self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    @MainActor
    func signOut() async {
        await api.logout()
        SessionStore.save(nil)
        self.user = nil
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
                self.childSlug = u.slug ?? self.childSlug
                self.lastError = nil
            }
        } catch { /* leave existing state alone on error */ }
    }
}

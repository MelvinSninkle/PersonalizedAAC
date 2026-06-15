import SwiftUI

/// The ordered onboarding steps the backend tracks. Names match the wire
/// values in api/_lib/onboarding.js so a payload comparison is trivial.
enum OnboardingStep: String, CaseIterable, Identifiable {
    case demo            // pre-account demo board
    case account         // Sign in with Apple, or email/password
    case child           // name + birthday + language + attention tier
    case childPhoto      // capture child → stylize → review → commit
    case parentPhoto     // capture grown-up → stylize → review → commit
    case seedCore        // queue the Core 12-18m batch
    case complete

    var id: String { rawValue }

    /// Wire value of the EQUIVALENT backend step (some UI steps live above
    /// the API contract — demo / account have no server cursor).
    var serverKey: String {
        switch self {
        case .demo, .account: return "account"
        case .child:          return "child"
        case .childPhoto:     return "child_photo"
        case .parentPhoto:    return "parent_photo"
        case .seedCore:       return "seed_core"
        case .complete:       return "complete"
        }
    }

    /// Reverse: the next UI step when the server says we're at `key`.
    static func fromServer(_ key: String) -> OnboardingStep {
        switch key {
        case "account":      return .account
        case "child":        return .child
        case "child_photo":  return .childPhoto
        case "parent_photo": return .parentPhoto
        case "seed_core":    return .seedCore
        case "complete":     return .complete
        default:             return .demo
        }
    }
}

/// Coordinates the onboarding navigation. Polls /api/onboarding/state at the
/// start so a parent who quit and reopened a different device picks up where
/// they left off.
@MainActor
@Observable
final class OnboardingCoordinator {
    var step: OnboardingStep = .demo

    /// Collected as the parent walks the flow. The server persists each step
    /// before we advance, so this is mainly UI state.
    var childName: String = ""
    var birthDate: Date = Calendar.current.date(byAdding: .year, value: -2, to: Date()) ?? Date()
    var language: String = "en"
    var tier: String = "under3"

    /// The art style (a style-guide image id) chosen on the Child step. Applies
    /// to BOTH the People portraits and the Core starter tiles so the whole board
    /// shares one look. nil → the server falls back to the first active guide.
    var styleGuideId: Int?
    var styleLabel: String = ""

    /// The two committed draft keys, for display on later steps.
    var childPortraitKey: String?
    var parentPortraitKey: String?
    var firstGrownupName: String = ""
    var firstGrownupRelationship: String = "mother"

    /// True once the parent has completed account creation — gates the rest.
    var isAuthenticated: Bool = false

    /// True ONLY while a brand-new parent is mid-onboarding. Drives ContentView
    /// to keep showing the flow even after the account is created (creating an
    /// account flips isSignedIn, which would otherwise abandon the flow). An
    /// EXISTING parent who just logs in leaves this false and lands on their
    /// board / parent home immediately.
    var needsOnboarding: Bool = false

    private let api = APIClient()

    func advance() { go(toServer: nextServerStep()) }

    func go(to step: OnboardingStep) { self.step = step }

    func go(toServer key: String) { self.step = OnboardingStep.fromServer(key) }

    private func nextServerStep() -> String {
        switch step {
        case .demo:        return "account"
        case .account:     return "child"
        case .child:       return "child_photo"
        case .childPhoto:  return "parent_photo"
        case .parentPhoto: return "seed_core"
        case .seedCore:    return "complete"
        case .complete:    return "complete"
        }
    }

    func resumeIfPossible() async {
        guard isAuthenticated else { return }
        do {
            let s = try await api.onboardingState()
            step = OnboardingStep.fromServer(s.step)
            if let n = s.data?["childName"]?.value as? String { childName = n }
            if let l = s.data?["language"]?.value as? String  { language = l }
            if let t = s.data?["tier"]?.value as? String      { tier = t }
            if let d = s.data?["birthDate"]?.value as? String {
                let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
                if let parsed = f.date(from: d) { birthDate = parsed }
            }
        } catch { /* first run — keep defaults */ }
    }
}

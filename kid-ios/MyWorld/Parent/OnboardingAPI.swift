import Foundation

/// Wire-shape for the /api/onboarding/* endpoints. Mirrors the JSON exactly so
/// the SwiftUI flow and the web onboard.html can target the same contract.
extension APIClient {

    // MARK: -- Sign in with Apple

    struct AppleSignInRequest {
        let identityToken: String
        let fullName: String?
        let email: String?
    }
    func signInWithApple(_ req: AppleSignInRequest) async throws -> LoginResponse {
        var body: [String: Any] = ["identityToken": req.identityToken]
        if let n = req.fullName, !n.isEmpty { body["fullName"] = n }
        if let e = req.email, !e.isEmpty { body["email"] = e }
        let data = try JSONSerialization.data(withJSONObject: body)
        let (respData, _) = try await request(method: "POST", path: "/api/auth/apple",
                                              body: data, contentType: "application/json")
        do { return try JSONDecoder().decode(LoginResponse.self, from: respData) }
        catch { throw APIError.decoding(error) }
    }

    // MARK: -- Onboarding state + step writes

    struct OnboardingState: Codable {
        let step: String
        let completed: [String]
        let childId: String?
        let data: [String: AnyCodable]?
    }
    /// Loose JSON value — we only need to surface a few keys back to the UI.
    struct AnyCodable: Codable {
        let value: Any?
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if c.decodeNil() { self.value = nil; return }
            if let v = try? c.decode(Bool.self)   { self.value = v; return }
            if let v = try? c.decode(Int.self)    { self.value = v; return }
            if let v = try? c.decode(Double.self) { self.value = v; return }
            if let v = try? c.decode(String.self) { self.value = v; return }
            self.value = nil
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch value {
            case let v as Bool:   try c.encode(v)
            case let v as Int:    try c.encode(v)
            case let v as Double: try c.encode(v)
            case let v as String: try c.encode(v)
            default: try c.encodeNil()
            }
        }
    }
    func onboardingState() async throws -> OnboardingState {
        let (data, _) = try await request(method: "GET", path: "/api/onboarding/state", body: nil)
        do { return try JSONDecoder().decode(OnboardingState.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    // MARK: -- Art style picker (style guides)

    struct OnboardingStyle: Codable, Identifiable, Hashable {
        let id: Int
        let label: String
        let description: String?
    }
    private struct OnboardingStylesResult: Codable { let styles: [OnboardingStyle] }

    /// The active style guides the parent can pick from — same set the admin Lab
    /// uses, exposed read-only for onboarding.
    func onboardingStyles() async throws -> [OnboardingStyle] {
        let (data, _) = try await request(method: "GET", path: "/api/onboarding/styles", body: nil)
        do { return try JSONDecoder().decode(OnboardingStylesResult.self, from: data).styles }
        catch { throw APIError.decoding(error) }
    }

    /// Preview image bytes for a style guide (auth-gated proxy).
    func onboardingStyleImage(id: Int) async throws -> Data {
        let (data, _) = try await request(method: "GET", path: "/api/onboarding/styles?image=\(id)", body: nil)
        return data
    }

    @discardableResult
    func onboardingChild(name: String, birthDate: Date, tier: String, language: String) async throws -> [String: Any] {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let body = try JSONSerialization.data(withJSONObject: [
            "name": name, "birthDate": f.string(from: birthDate),
            "tier": tier, "language": language,
        ])
        let (data, _) = try await request(method: "POST", path: "/api/onboarding/child",
                                          body: body, contentType: "application/json")
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    // MARK: -- Photo: draft / retry / commit (free retries during onboarding)

    struct OnboardingDraftResult: Codable { let ok: Bool; let draftKey: String? }
    /// Stylize a raw JPEG and return a DRAFT blob key. Doesn't commit. The
    /// chosen style guide (image) is rendered alongside the real photo.
    func onboardingPhotoDraft(jpeg: Data, styleGuideId: Int? = nil) async throws -> String {
        var path = "/api/onboarding/family?action=draft"
        if let styleGuideId { path += "&styleGuideId=\(styleGuideId)" }
        let (data, _) = try await request(method: "POST", path: path,
                                          body: jpeg, contentType: "image/jpeg",
                                          timeout: 320)
        let r = try JSONDecoder().decode(OnboardingDraftResult.self, from: data)
        guard let k = r.draftKey else { throw APIError.invalidResponse }
        return k
    }
    /// Re-stylize from the cached source bytes — same photo, different roll.
    func onboardingPhotoRetry(draftKey: String, attempt: Int, styleGuideId: Int? = nil) async throws -> String {
        var payload: [String: Any] = ["draftKey": draftKey, "attempt": attempt]
        if let styleGuideId { payload["styleGuideId"] = styleGuideId }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let (data, _) = try await request(method: "POST",
                                          path: "/api/onboarding/family?action=retry",
                                          body: body, contentType: "application/json",
                                          timeout: 320)
        let r = try JSONDecoder().decode(OnboardingDraftResult.self, from: data)
        guard let k = r.draftKey else { throw APIError.invalidResponse }
        return k
    }
    /// Promote a chosen draft to the canonical reference_key + create the
    /// People tile. `role` is "child" for the is_self tile and "parent" for
    /// the first grown-up.
    func onboardingPhotoCommit(draftKey: String, role: String, name: String,
                               relationship: String?) async throws {
        var body: [String: Any] = ["draftKey": draftKey, "role": role, "name": name]
        if let r = relationship, !r.isEmpty { body["relationship"] = r }
        let data = try JSONSerialization.data(withJSONObject: body)
        _ = try await request(method: "POST", path: "/api/onboarding/family?action=commit",
                              body: data, contentType: "application/json")
    }

    // MARK: -- Seed Core + complete

    struct OnboardingSeedResult: Codable {
        let ok: Bool
        let queuedCount: Int
        let slugs: [String]
        let message: String?
    }
    func onboardingSeedCore(styleGuideId: Int? = nil) async throws -> OnboardingSeedResult {
        var path = "/api/onboarding/seed-core"
        if let styleGuideId { path += "?styleGuideId=\(styleGuideId)" }
        // Renders ~13 tiles server-side (Gemini) before responding — give it the
        // function's full ceiling rather than the old fire-and-forget 30s.
        let (data, _) = try await request(method: "POST", path: path,
                                          body: nil, contentType: "application/json",
                                          timeout: 320)
        return try JSONDecoder().decode(OnboardingSeedResult.self, from: data)
    }
    func onboardingComplete() async {
        _ = try? await request(method: "POST", path: "/api/onboarding/complete",
                               body: nil, contentType: "application/json")
    }
}

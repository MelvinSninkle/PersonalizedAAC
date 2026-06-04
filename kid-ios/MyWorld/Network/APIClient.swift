import Foundation

/// Single point of contact with the web app's `/api/*` endpoints.
///
/// Auth is cookie-based: `URLSession` carries cookies via `HTTPCookieStorage`
/// automatically, so after `/api/auth/login` succeeds we don't have to do
/// anything to attach the session — every subsequent request includes it.
///
/// `HTTPCookieStorage.shared` persists cookies to the app's container, so
/// they survive a relaunch. Logging out clears them explicitly.
struct APIClient {
    /// Production origin. Override via UserDefaults `apiOrigin` for local dev.
    static let defaultOrigin = "https://aac.andrewpeterson.io"
    var origin: String

    init(origin: String = APIClient.defaultOrigin) {
        self.origin = origin
    }

    // MARK: -- Endpoints

    struct LoginResponse: Codable {
        let ok: Bool
        let user: User
        struct User: Codable {
            let email: String
            let role: String
            let slug: String?
        }
    }

    struct MeResponse: Codable {
        let user: APIClient.LoginResponse.User?
    }

    struct SyncResponse: Codable {
        let categories: [Category]
        let items: [Tile]
    }

    /// POST /api/auth/login — captures the Set-Cookie session.
    func login(email: String, password: String) async throws -> LoginResponse {
        let body = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        return try await postJSON("/api/auth/login", body: body)
    }

    /// GET /api/auth/me — returns the signed-in user (or {user:null}).
    func me() async throws -> MeResponse {
        try await getJSON("/api/auth/me")
    }

    /// POST /api/auth/logout — clears the server-side cookie. Best-effort.
    func logout() async {
        _ = try? await request(method: "POST", path: "/api/auth/logout", body: nil)
        // Clear local cookies regardless of server response.
        if let host = URL(string: origin)?.host,
           let cookies = HTTPCookieStorage.shared.cookies(for: URL(string: origin)!) {
            for c in cookies where c.domain.contains(host) {
                HTTPCookieStorage.shared.deleteCookie(c)
            }
        }
    }

    /// GET /api/sync?childId=<slug>
    func sync(childId: String) async throws -> SyncResponse {
        try await getJSON("/api/sync?childId=\(percentEscape(childId))")
    }

    /// GET /api/live?childId=<slug> — facilitator command poll.
    func live(childId: String) async throws -> LiveStatus {
        try await getJSON("/api/live?childId=\(percentEscape(childId))")
    }

    /// GET /api/media?key=<key> — streams blob bytes. Used for images + audio.
    func media(key: String) async throws -> (Data, String) {
        let (data, resp) = try await request(method: "GET",
                                             path: "/api/media?key=\(percentEscape(key))",
                                             body: nil)
        let mime = (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
        return (data, mime)
    }

    /// POST /api/events — logs a tile tap. Fire-and-forget; failures are ignored.
    func logEvent(_ event: [String: Any]) async {
        guard let body = try? JSONSerialization.data(withJSONObject: event) else { return }
        _ = try? await request(method: "POST", path: "/api/events", body: body, contentType: "application/json")
    }

    /// Fire-and-forget POST to any path that doesn't need a body or response —
    /// used for things like `/api/play-request?childId=...`.
    func postEmpty(path: String) async {
        _ = try? await request(method: "POST", path: path, body: nil)
    }

    // MARK: -- Plumbing

    private func percentEscape(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }

    private func getJSON<T: Decodable>(_ path: String) async throws -> T {
        let (data, _) = try await request(method: "GET", path: path, body: nil)
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    private func postJSON<T: Decodable>(_ path: String, body: Data) async throws -> T {
        let (data, _) = try await request(method: "POST", path: path, body: body, contentType: "application/json")
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    private func request(method: String,
                         path: String,
                         body: Data?,
                         contentType: String? = nil) async throws -> (Data, URLResponse) {
        guard let url = URL(string: origin + path) else {
            throw APIError.invalidResponse
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        req.httpShouldHandleCookies = true   // default, but explicit

        let session = URLSession.shared
        let pair: (Data, URLResponse)
        do { pair = try await session.data(for: req) }
        catch { throw APIError.transport(error) }

        guard let http = pair.1 as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.notAuthenticated
        }
        guard (200..<300).contains(http.statusCode) else {
            let bodyStr = String(data: pair.0, encoding: .utf8) ?? ""
            throw APIError.badStatus(http.statusCode, bodyStr)
        }
        return pair
    }
}

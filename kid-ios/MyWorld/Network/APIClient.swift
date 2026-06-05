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

    /// POST /api/live — tablet publishes its current state so the facilitator
    /// phone knows the tablet is present (status != 'idle' within 8s) and can
    /// show live progress. Fire-and-forget.
    func publishLiveState(childId: String, status: String, payload: LivePayload?) async {
        var dict: [String: Any] = ["kind": "state", "status": status]
        if let payload,
           let data = try? JSONEncoder().encode(payload),
           let obj = try? JSONSerialization.jsonObject(with: data) {
            dict["payload"] = obj
        } else {
            dict["payload"] = [:]
        }
        guard let body = try? JSONSerialization.data(withJSONObject: dict) else { return }
        _ = try? await request(method: "POST",
                               path: "/api/live?childId=\(percentEscape(childId))",
                               body: body, contentType: "application/json")
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

    // MARK: -- /api/game-log

    /// Wire format for POST /api/game-log — mirrors the optional fields the
    /// server learned to accept in Phase 1. Codable means we can ship arrays
    /// of attempts without hand-rolling the JSON. PRD §3/§4: slidesAttempted
    /// is the honest denominator, scoringVersion stamps the mercy cutover.
    struct GameLogPayload: Encodable {
        let childId: String
        let mode: String
        let category: String?
        let startedAt: String
        let endedAt: String
        let itemCount: Int                // full game length
        let slidesAttempted: Int          // rounds actually played (PRD §3.1)
        let correctCount: Int
        let scoringVersion: Int           // 2 = mercy any-attempt counts
        let endReason: String             // 'completed' | 'timeout' | 'facilitator_stop' | 'child_quit' | 'empty_scope'
        let skillSlug: String?
        let attempts: [Attempt]

        struct Attempt: Encodable {
            let itemId: Int?
            let label: String
            let category: String?
            let taxonomySlug: String?
            let correct: Bool
            let inputMethod: String       // "tap" | "verbal" | "object" | "physical" | "gesture"
            let misses: Int               // legacy parity field
            let attemptsTaken: Int        // PRD §3.2 mercy count
            let distractorCount: Int      // PRD §3.3 difficulty signal
            let childGenerated: Bool      // PRD §4.2 weighting flag
            let occurredAt: String
        }
    }

    /// POST /api/game-log — fire-and-forget. A failure never blocks the UI;
    /// the iPad has already celebrated by the time this fires.
    func submitGameLog(_ payload: GameLogPayload) async {
        guard let body = try? JSONEncoder().encode(payload) else { return }
        _ = try? await request(method: "POST", path: "/api/game-log", body: body, contentType: "application/json")
    }

    /// POST /api/exposure-tick — record one exposure of a skill for a child
    /// and let the server recompute the schedule (PRD §8). Used by the
    /// slideshow at session-end; matching/auditory/expressive sessions tick
    /// internally on the server side inside /api/game-log.
    func tickExposure(childId: String, skillSlug: String, source: String = "slideshow") async {
        guard let body = try? JSONSerialization.data(withJSONObject: [
            "childId":   childId,
            "skillSlug": skillSlug,
            "source":    source,
        ]) else { return }
        _ = try? await request(method: "POST", path: "/api/exposure-tick", body: body, contentType: "application/json")
    }

    // MARK: -- /api/describe-image, /api/generate-image, /api/tts, /api/upload, /api/items
    //
    // Endpoints used by AddTileView. Errors are thrown as APIError so the view
    // can surface them inline (a busy parent needs to know exactly what to do
    // next, not a 500-char stack dump).

    struct DescribeResult: Codable {
        let label: String
        let pronunciation: String
    }

    /// POST /api/describe-image — OpenAI vision suggests a 1-2 word label and
    /// a phonetic spelling tuned for TTS. Best-effort; if the org isn't
    /// verified for vision, returns empty strings.
    func describeImage(photoJPEG: Data) async throws -> DescribeResult {
        let (data, _) = try await request(method: "POST", path: "/api/describe-image",
                                          body: photoJPEG, contentType: "image/jpeg")
        do { return try JSONDecoder().decode(DescribeResult.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    /// POST /api/generate-image — re-illustrates the photo in the given style
    /// with the chosen OpenAI image model. Returns the raw PNG bytes. ~20-40s.
    func generateImage(photoJPEG: Data, label: String, style: String, model: String, childId: String) async throws -> Data {
        let path = "/api/generate-image?label=\(percentEscape(label))&style=\(percentEscape(style))&model=\(percentEscape(model))&childId=\(percentEscape(childId))"
        // Match the server's 180s ceiling (with a few seconds of grace) — the
        // default 60s URLRequest timeout was firing before gpt-image-1.5/2 at
        // high quality could finish.
        let (data, _) = try await request(method: "POST", path: path,
                                          body: photoJPEG, contentType: "image/jpeg",
                                          timeout: 200)
        return data
    }

    /// POST /api/tts — speaks `text` in the given emotion via ElevenLabs.
    /// Returns the raw MP3 bytes. Throws on failure so the caller can surface
    /// an inline error (the legacy `tts` below returns Data? for fire-and-
    /// forget callers like GameAudio that don't need to know what went wrong).
    func synthesizeSpeech(text: String, emotion: String) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: ["text": text, "emotion": emotion])
        let (data, _) = try await request(method: "POST", path: "/api/tts",
                                          body: body, contentType: "application/json")
        return data
    }

    struct UploadResult: Codable { let key: String }

    /// POST /api/upload — uploads raw bytes to private Vercel Blob storage
    /// and returns the storage key the server will use in /api/media.
    func uploadBlob(_ bytes: Data, kind: String, ext: String, contentType: String) async throws -> String {
        let path = "/api/upload?kind=\(percentEscape(kind))&ext=\(percentEscape(ext))"
        let (data, _) = try await request(method: "POST", path: path,
                                          body: bytes, contentType: contentType)
        return (try JSONDecoder().decode(UploadResult.self, from: data)).key
    }

    /// POST /api/items — creates a new tile row. Returns the saved Tile
    /// (with its server-assigned id) so the caller can insert it into the
    /// in-memory BoardStore without waiting for a full /api/sync.
    func createItem(section: String,
                    categoryId: Int?,
                    label: String,
                    imageKey: String,
                    soundKey: String?,
                    keepAspect: Bool,
                    description: String?,
                    needsReview: Bool = false,
                    childId: String) async throws -> Tile {
        var body: [String: Any] = [
            "section":     section,
            "label":       label,
            "imageKey":    imageKey,
            "keepAspect":  keepAspect,
            "childId":     childId,
            "order":       Int(Date().timeIntervalSince1970 * 1000),
            "pinned":      false,
            "needsReview": needsReview,
        ]
        if let categoryId  { body["categoryId"]  = categoryId }
        if let soundKey    { body["soundKey"]    = soundKey }
        if let description { body["description"] = description }
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await request(method: "POST", path: "/api/items",
                                          body: bodyData, contentType: "application/json")
        do { return try JSONDecoder().decode(Tile.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    /// How a tile update should treat the category field. The server leaves
    /// the value untouched unless we send a `categoryId` key, so we can't use a
    /// plain `Int?` (nil would be ambiguous between "top level" and "leave it").
    enum CategoryUpdate {
        case unchanged
        case set(Int?)   // nil = move to top level / Needs strip
    }

    /// PUT /api/items?id= — updates an existing tile. Only the fields you pass
    /// are changed (the server COALESCEs the rest). Used by the tray edit (fix
    /// a wrong AI name / placement) and by the review queue (`needsReview:
    /// false` to confirm a bulk-imported tile).
    func updateItem(id: Int,
                    label: String? = nil,
                    section: String? = nil,
                    category: CategoryUpdate = .unchanged,
                    soundKey: String? = nil,
                    needsReview: Bool? = nil,
                    childId: String) async throws -> Tile {
        var body: [String: Any] = ["childId": childId]
        if let label   { body["label"]   = label }
        if let section { body["section"] = section }
        switch category {
        case .unchanged:      break
        case .set(let catId): body["categoryId"] = catId ?? NSNull()
        }
        if let soundKey    { body["soundKey"]    = soundKey }
        if let needsReview { body["needsReview"] = needsReview }
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await request(method: "PUT", path: "/api/items?id=\(id)",
                                          body: bodyData, contentType: "application/json")
        do { return try JSONDecoder().decode(Tile.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    /// DELETE /api/items?id= — removes a tile (and its blobs server-side). Used
    /// by the review queue's "Remove" action.
    func deleteItem(id: Int) async throws {
        _ = try await request(method: "DELETE", path: "/api/items?id=\(id)", body: nil)
    }

    /// Fire-and-forget POST to any path that doesn't need a body or response —
    /// used for things like `/api/play-request?childId=...`.
    func postEmpty(path: String) async {
        _ = try? await request(method: "POST", path: path, body: nil)
    }

    /// Read the full child_settings blob (empty dict on any failure).
    private func childSettings(childId: String) async -> [String: Any] {
        guard let (data, _) = try? await request(
                method: "GET",
                path: "/api/child-settings?childId=\(percentEscape(childId))",
                body: nil),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return [:] }
        return (root["settings"] as? [String: Any]) ?? [:]
    }

    /// Schedules the parent set in the web Schedules panel (timed reminders,
    /// interactive questions, game nudges). Stored under settings.schedules.
    func fetchSchedules(childId: String) async -> [Schedule] {
        let settings = await childSettings(childId: childId)
        guard let arr = settings["schedules"] as? [Any],
              let data = try? JSONSerialization.data(withJSONObject: arr) else { return [] }
        return (try? JSONDecoder().decode([Schedule].self, from: data)) ?? []
    }

    /// Log a child's answer to a scheduled question so the parent dashboard
    /// can see what was tapped. Fire-and-forget.
    func logInteraction(childId: String, kind: String, prompt: String,
                        response: String, scheduleId: String?) async {
        var dict: [String: Any] = [
            "childId": childId, "kind": kind,
            "prompt": prompt, "response": response,
        ]
        if let scheduleId { dict["scheduleId"] = scheduleId }
        guard let body = try? JSONSerialization.data(withJSONObject: dict) else { return }
        _ = try? await request(method: "POST", path: "/api/interactions",
                               body: body, contentType: "application/json")
    }

    /// GET display prefs stored under `settings.kidDisplay`.
    func fetchDisplayPrefs(childId: String) async -> DisplayPrefsData? {
        let settings = await childSettings(childId: childId)
        guard let kd = settings["kidDisplay"],
              let kdData = try? JSONSerialization.data(withJSONObject: kd) else { return nil }
        return try? JSONDecoder().decode(DisplayPrefsData.self, from: kdData)
    }

    /// Reward settings (cheer phrases + background music) the parent set via
    /// the web rewards panel, stored under settings.rewards.
    struct RewardSettings {
        var phrases: [String]
        var music: String?
    }

    func fetchRewards(childId: String) async -> RewardSettings {
        let settings = await childSettings(childId: childId)
        let rw = settings["rewards"] as? [String: Any]
        let phrases = (rw?["phrases"] as? [String])?.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? []
        let music = rw?["music"] as? String
        return RewardSettings(phrases: phrases, music: music)
    }

    /// POST /api/tts { text, emotion } → audio/mpeg bytes (ElevenLabs voice).
    func tts(text: String, emotion: String = "excited") async -> Data? {
        guard let body = try? JSONSerialization.data(withJSONObject: ["text": text, "emotion": emotion]) else { return nil }
        guard let (data, _) = try? await request(method: "POST", path: "/api/tts",
                                                 body: body, contentType: "application/json") else { return nil }
        return data
    }

    /// GET a static audio asset (e.g. "/audio/color-tap-learn.mp3").
    func fetchAudioData(path: String) async -> Data? {
        let p = path.hasPrefix("/") ? path : "/" + path
        guard let (data, _) = try? await request(method: "GET", path: p, body: nil) else { return nil }
        return data
    }

    /// Merge-safe write of display prefs: read the current settings blob, set
    /// only the `kidDisplay` key, write the whole thing back. Avoids clobbering
    /// the web app's schedule / reward settings stored in the same blob.
    func saveDisplayPrefs(childId: String, data: DisplayPrefsData) async {
        var settings = await childSettings(childId: childId)
        if let encoded = try? JSONEncoder().encode(data),
           let kd = try? JSONSerialization.jsonObject(with: encoded) {
            settings["kidDisplay"] = kd
        }
        guard let body = try? JSONSerialization.data(withJSONObject: ["settings": settings]) else { return }
        _ = try? await request(
            method: "POST",
            path: "/api/child-settings?childId=\(percentEscape(childId))",
            body: body, contentType: "application/json"
        )
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
                         contentType: String? = nil,
                         timeout: TimeInterval? = nil) async throws -> (Data, URLResponse) {
        guard let url = URL(string: origin + path) else {
            throw APIError.invalidResponse
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        req.httpShouldHandleCookies = true   // default, but explicit
        // URLRequest default is 60s; image generation legitimately runs longer
        // (gpt-image-1.5/2 high quality + input_fidelity:high) so we let callers
        // raise it per-request. Other endpoints keep the 60s default.
        if let timeout { req.timeoutInterval = timeout }

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

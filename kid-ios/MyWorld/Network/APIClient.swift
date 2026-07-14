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
        /// Only present on /api/auth/apple — true when a brand-new account was
        /// created (vs. signing into an existing one). Drives whether the
        /// onboarding flow continues. nil for the email login/register paths.
        let created: Bool?
        struct User: Codable {
            let email: String
            let role: String
            let slug: String?
        }
    }

    struct MeResponse: Codable {
        let user: APIClient.LoginResponse.User?
    }

    /// Membership flags for this FAMILY (resolved server-side from the board
    /// owner's account) — drives friendly join-a-membership popups at the
    /// gates. nil = unknown (old server / offline) → be permissive; the server
    /// still enforces.
    struct Entitlement: Codable {
        let tier: String
        let label: String
        let stt: Bool
        let autoTeach: Bool
        let styling: Bool
    }

    struct SyncResponse: Codable {
        let categories: [Category]
        let items: [Tile]
        var entitlement: Entitlement? = nil
        /// Listening display filter (E8): server-owned bad-word list; words
        /// on it render as "Bad Word" in the listening strip.
        var listenBlocklist: [String]? = nil
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

    /// POST a facilitator command to the board's live channel — the same
    /// `{kind:'cmd', action}` shape the web parent dashboard sends (the board
    /// polls /api/live and reacts, e.g. listen-start flips on Listening Mode).
    func sendLiveCommand(childId: String, action: String) async -> Bool {
        guard let body = try? JSONSerialization.data(withJSONObject: ["kind": "cmd", "action": action]) else { return false }
        do {
            _ = try await request(method: "POST",
                                  path: "/api/live?childId=\(percentEscape(childId))",
                                  body: body, contentType: "application/json")
            return true
        } catch { return false }
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
    }

    /// POST /api/describe-image — OpenAI vision suggests a 1-2 word label.
    /// Best-effort; if the org isn't verified for vision, returns an empty
    /// label (phonetic-pronunciation generation was removed — TTS speaks from
    /// the title).
    func describeImage(photoJPEG: Data) async throws -> DescribeResult {
        let (data, _) = try await request(method: "POST", path: "/api/describe-image",
                                          body: photoJPEG, contentType: "image/jpeg")
        do { return try JSONDecoder().decode(DescribeResult.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    /// POST /api/generate-image — re-illustrates the photo in the given style
    /// with the chosen image model. `bg` picks the flat background color
    /// (preset name like 'pink' or a hex). Returns the raw PNG bytes. ~20-40s.
    func generateImage(photoJPEG: Data, label: String, style: String, model: String,
                       bg: String?, detail: String? = nil, childId: String) async throws -> Data {
        var path = "/api/generate-image?label=\(percentEscape(label))&style=\(percentEscape(style))&model=\(percentEscape(model))&childId=\(percentEscape(childId))"
        if let bg, !bg.isEmpty { path += "&bg=\(percentEscape(bg))" }
        if let detail, !detail.isEmpty { path += "&detail=\(percentEscape(detail))" }
        // 320s = Vercel's 300s function ceiling plus a 20s grace window, so a
        // near-the-edge response still arrives intact rather than the iPad
        // giving up first. gpt-image-1.5/-2 at high quality + high fidelity can
        // legitimately run 60-120s; the headroom is there for the long tail.
        let (data, _) = try await request(method: "POST", path: path,
                                          body: photoJPEG, contentType: "image/jpeg",
                                          timeout: 320)
        return data
    }

    /// POST /api/tts — speaks `text` in the given emotion via ElevenLabs.
    /// Returns the raw MP3 bytes. Throws on failure so the caller can surface
    /// an inline error (the legacy `tts` below returns Data? for fire-and-
    /// forget callers like GameAudio that don't need to know what went wrong).
    /// `childId` lets the server resolve that child's chosen voice
    /// (child_settings.voiceId) so newly created/edited tiles speak in it.
    func synthesizeSpeech(text: String, emotion: String, childId: String? = nil) async throws -> Data {
        var payload: [String: Any] = ["text": text, "emotion": emotion]
        if let childId, !childId.isEmpty { payload["childId"] = childId }
        let body = try JSONSerialization.data(withJSONObject: payload)
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
    /// a wrong AI name / placement), the review queue (`needsReview: false` to
    /// confirm a bulk-imported tile), and the board's full tile editor (image,
    /// voice, pin, keep-aspect, move, description — matching the web dashboard).
    func updateItem(id: Int,
                    label: String? = nil,
                    section: String? = nil,
                    category: CategoryUpdate = .unchanged,
                    imageKey: String? = nil,
                    soundKey: String? = nil,
                    keepAspect: Bool? = nil,
                    pinned: Bool? = nil,
                    description: String? = nil,
                    needsReview: Bool? = nil,
                    order: Int? = nil,
                    childId: String) async throws -> Tile {
        var body: [String: Any] = ["childId": childId]
        if let label   { body["label"]   = label }
        if let section { body["section"] = section }
        switch category {
        case .unchanged:      break
        case .set(let catId): body["categoryId"] = catId ?? NSNull()
        }
        if let imageKey    { body["imageKey"]    = imageKey }
        if let soundKey    { body["soundKey"]    = soundKey }
        if let keepAspect  { body["keepAspect"]  = keepAspect }
        if let pinned      { body["pinned"]      = pinned }
        if let order       { body["order"]       = order }
        // Explicit "" clears the description back to the game's fallback prompt;
        // nil leaves it untouched (so we only send it when the editor changed it).
        if let description { body["description"] = description }
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

    // MARK: -- Durable server-side tile jobs

    /// One server job's status (for the add-tile tray to poll).
    struct TileJobStatus: Codable, Identifiable {
        let id: Int
        let status: String          // queued | processing | done | failed
        let label: String?
        let itemId: Int?
        let imageKey: String?
        let artFailed: Bool
        let needsReview: Bool
        let error: String?
        let attempts: Int
    }
    private struct TileJobsList: Codable { let jobs: [TileJobStatus] }
    private struct TileJobCreated: Codable { let id: Int; let status: String }

    /// POST a photo to the durable server queue. The photo is persisted
    /// server-side BEFORE this returns, so it can never be lost; the server then
    /// renders the tile (style-consistent art + voice) and a cron guarantees it
    /// lands even if this device disappears. Returns the job id.
    func createTileJob(photoJPEG: Data, label: String, detail: String, section: String,
                       categoryId: Int?, style: String, styleGuideId: Int?, model: String,
                       bg: String, keepAspect: Bool, needsReview: Bool, emotion: String,
                       childId: String, relationship: String? = nil, raw: Bool = false) async throws -> Int {
        var path = "/api/tile-jobs?childId=\(percentEscape(childId))&section=\(percentEscape(section))"
            + "&style=\(percentEscape(style))&model=\(percentEscape(model))&bg=\(percentEscape(bg))"
            + "&emotion=\(percentEscape(emotion))"
        if !label.isEmpty  { path += "&label=\(percentEscape(label))" }
        if !detail.isEmpty { path += "&detail=\(percentEscape(detail))" }
        if let categoryId  { path += "&categoryId=\(categoryId)" }
        if let styleGuideId { path += "&styleGuideId=\(styleGuideId)" }
        if let relationship, !relationship.isEmpty { path += "&relationship=\(percentEscape(relationship))" }
        if keepAspect  { path += "&keepAspect=1" }
        if needsReview { path += "&needsReview=1" }
        if raw         { path += "&raw=1" }        // photo-as-is: no restyle, no charge
        let (data, _) = try await request(method: "POST", path: path,
                                          body: photoJPEG, contentType: "image/jpeg", timeout: 60)
        return (try JSONDecoder().decode(TileJobCreated.self, from: data)).id
    }

    // MARK: -- People / family (persons)

    /// A reference person — the child (is_self) and family/caregivers whose face
    /// anchors the tiles about them. `referenceKey` is their stylized portrait.
    struct Person: Codable, Identifiable, Hashable {
        let id: Int
        let displayName: String
        let givenName: String?
        let relationship: String
        let isSelf: Bool
        let referenceKey: String?

        enum CodingKeys: String, CodingKey {
            case id
            case displayName  = "display_name"
            case givenName    = "given_name"
            case relationship
            case isSelf       = "is_self"
            case referenceKey = "reference_key"
        }
    }
    private struct PersonsList: Codable { let persons: [Person] }

    /// GET the child's reference people (child + family).
    func listPersons(childId: String) async throws -> [Person] {
        let (data, _) = try await request(method: "GET",
                                          path: "/api/persons?childId=\(percentEscape(childId))", body: nil)
        return (try JSONDecoder().decode(PersonsList.self, from: data)).persons
    }

    /// POST structured person fields (name / relationship) — no photo. Upserts by
    /// id or, failing that, by display name. Returns the person id.
    @discardableResult
    func upsertPerson(id: Int?, displayName: String, relationship: String, childId: String) async throws -> Int {
        var body: [String: Any] = ["childId": childId, "displayName": displayName, "relationship": relationship]
        if let id { body["id"] = id }
        let data = try JSONSerialization.data(withJSONObject: body)
        let (resp, _) = try await request(method: "POST", path: "/api/persons",
                                          body: data, contentType: "application/json")
        struct R: Codable { let id: Int }
        return (try JSONDecoder().decode(R.self, from: resp)).id
    }

    func deletePerson(id: Int, childId: String) async {
        _ = try? await request(method: "DELETE",
                               path: "/api/persons?id=\(id)&childId=\(percentEscape(childId))", body: nil)
    }

    /// POST /api/square-tiles — set every tile square except those in a
    /// TV/movies/posters folder. Returns how many were squared vs left as posters.
    @discardableResult
    func squareAllTiles(childId: String) async throws -> (squared: Int, posters: Int) {
        let (data, _) = try await request(method: "POST",
                                          path: "/api/square-tiles?childId=\(percentEscape(childId))", body: nil)
        struct R: Codable { let squared: Int; let posters: Int }
        let r = try JSONDecoder().decode(R.self, from: data)
        return (r.squared, r.posters)
    }

    /// GET the child's active/recent jobs for the tray.
    func listTileJobs(childId: String) async throws -> [TileJobStatus] {
        let (data, _) = try await request(method: "GET",
                                          path: "/api/tile-jobs?childId=\(percentEscape(childId))", body: nil)
        return (try JSONDecoder().decode(TileJobsList.self, from: data)).jobs
    }

    /// DELETE a job (and its blobs); leaves any tile it already created alone.
    func deleteTileJob(id: Int, childId: String) async {
        _ = try? await request(method: "DELETE",
                               path: "/api/tile-jobs?id=\(id)&childId=\(percentEscape(childId))", body: nil)
    }

    /// Fire-and-forget POST to any path that doesn't need a body or response —
    /// used for things like `/api/play-request?childId=...`.
    func postEmpty(path: String) async {
        _ = try? await request(method: "POST", path: path, body: nil)
    }

    /// Read the full child_settings blob (empty dict on any failure).
    func childSettings(childId: String) async -> [String: Any] {
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
    func tts(text: String, emotion: String = "excited", childId: String? = nil) async -> Data? {
        // childId lets the server resolve the family's chosen ElevenLabs voice
        // (child_settings.voiceId) so spoken prompts match the board's tiles.
        var payload: [String: Any] = ["text": text, "emotion": emotion]
        if let childId, !childId.isEmpty { payload["childId"] = childId }
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
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

    /// Merge-safe write of arbitrary root settings keys (parent toggles like
    /// listenCensor): read the current blob, overlay the patch, write it all
    /// back. The server clamps admin-gated keys for non-admins regardless.
    func updateChildSettings(childId: String, patch: [String: Any]) async -> Bool {
        var settings = await childSettings(childId: childId)
        for (k, v) in patch { settings[k] = v }
        guard let body = try? JSONSerialization.data(withJSONObject: ["settings": settings]) else { return false }
        let ok = (try? await request(
            method: "POST",
            path: "/api/child-settings?childId=\(percentEscape(childId))",
            body: body, contentType: "application/json"
        )) != nil
        return ok
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

    // MARK: -- Store / credits

    /// Current credit balance (nil on any failure — the UI shows a placeholder).
    func storeBalance() async -> Int? {
        struct R: Decodable { let balance: Int? }
        guard let (data, _) = try? await request(method: "GET", path: "/api/store?action=catalog", body: nil),
              let r = try? JSONDecoder().decode(R.self, from: data) else { return nil }
        return r.balance
    }

    /// The account's effective membership (server-resolved: admin override →
    /// live subscription → free), plus this month's voice budget.
    struct StoreEntitlement: Decodable {
        struct Voice: Decodable { let used: Int; let cap: Int? }
        let tier: String; let label: String; let source: String
        let voice: Voice?
    }
    func storeEntitlement() async -> StoreEntitlement? {
        struct R: Decodable { let entitlement: StoreEntitlement? }
        guard let (data, _) = try? await request(method: "GET", path: "/api/store?action=catalog", body: nil),
              let r = try? JSONDecoder().decode(R.self, from: data) else { return nil }
        return r.entitlement
    }

    /// Report a verified StoreKit transaction; the server grants the credits
    /// idempotently (safe to re-send). Returns the credits granted this call.
    func iapVerify(jws: String, productId: String, transactionId: String) async -> Int? {
        struct R: Decodable { let credited: Int? }
        let body = try? JSONSerialization.data(withJSONObject: [
            "jws": jws, "productId": productId, "transactionId": transactionId,
        ])
        guard let body,
              let (data, _) = try? await request(method: "POST", path: "/api/store?action=iap-verify",
                                                 body: body, contentType: "application/json"),
              let r = try? JSONDecoder().decode(R.self, from: data) else { return nil }
        return r.credited
    }

    /// One shoppable word from the store library. Codable (not just Decodable)
    /// so the Word Shop can disk-cache the catalog and open instantly.
    struct ShopTile: Codable, Identifiable, Hashable {
        let id: String
        let label: String
        let column: String
        let category: String?
        let subcategory: String?
        let previewKey: String?
        let onBoard: Bool
        let personalized: Bool
        let itemId: Int?
        let freeRetryUsed: Bool
        let credits: Int
        /// false = this word's board is store-only and priced in credits, so
        /// it must not appear in the FREE common-use-boards section. Optional
        /// so cached catalogs and older servers (no field) decode as free.
        let freeBoard: Bool?
    }
    private struct ShopBrowse: Decodable { let tiles: [ShopTile] }
    func storeBrowse(childId: String) async throws -> [ShopTile] {
        let (data, _) = try await request(method: "GET",
                                          path: "/api/store?action=browse&childId=\(percentEscape(childId))",
                                          body: nil)
        return (try JSONDecoder().decode(ShopBrowse.self, from: data)).tiles
    }

    struct StoreCheckoutResult: Decodable { let ok: Bool; let charged: Int; let queued: Int; let balance: Int?; let note: String? }
    func storeCheckout(childId: String, taxonomyIds: [String], bundle: Bool = false) async throws -> StoreCheckoutResult {
        // bundle=true (a whole folder at once) earns the server's 20% discount.
        let body = try JSONSerialization.data(withJSONObject: ["childId": childId, "taxonomyIds": taxonomyIds, "bundle": bundle])
        let (data, _) = try await request(method: "POST", path: "/api/store?action=checkout",
                                          body: body, contentType: "application/json", timeout: 120)
        return try JSONDecoder().decode(StoreCheckoutResult.self, from: data)
    }

    struct StoreRetryResult: Decodable { let ok: Bool; let charged: Int; let freeRetry: Bool?; let balance: Int? }
    /// Re-draw a tile's picture in the child's style. First retry per tile is
    /// free; after that it costs one credit (server-enforced).
    struct FreeBoardResult: Decodable { let ok: Bool; let placed: Int?; let removed: Int?; let note: String? }
    func storeFreeBoard(childId: String, column: String, category: String, on: Bool) async throws -> FreeBoardResult {
        let body = try JSONSerialization.data(withJSONObject: ["childId": childId, "column": column, "category": category, "on": on])
        let (data, _) = try await request(method: "POST", path: "/api/store?action=free-board",
                                          body: body, contentType: "application/json")
        return try JSONDecoder().decode(FreeBoardResult.self, from: data)
    }

    struct PersonalizeAllResult: Decodable {
        let ok: Bool
        let remaining: Int?
        let total: Int?
        let cost: Int?
        let charged: Int?
        let queued: Int?
        let balance: Int?
        let note: String?
    }
    func storePersonalizeAll(childId: String, quote: Bool) async throws -> PersonalizeAllResult {
        let body = try JSONSerialization.data(withJSONObject: ["childId": childId, "quote": quote])
        let (data, _) = try await request(method: "POST", path: "/api/store?action=personalize-all",
                                          body: body, contentType: "application/json")
        return try JSONDecoder().decode(PersonalizeAllResult.self, from: data)
    }

    func storeRetry(childId: String, itemId: Int, guidance: String = "") async throws -> StoreRetryResult {
        // guidance = the parent's correction; the server attaches the current
        // image as the previous attempt so the model improves, not re-rolls.
        var payload: [String: Any] = ["childId": childId, "itemId": itemId]
        if !guidance.isEmpty { payload["guidance"] = guidance }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let (data, _) = try await request(method: "POST", path: "/api/store?action=retry",
                                          body: body, contentType: "application/json")
        return try JSONDecoder().decode(StoreRetryResult.self, from: data)
    }

    struct StoreRedeemResult: Decodable { let ok: Bool; let credited: Int; let balance: Int }
    func storeRedeem(code: String) async throws -> StoreRedeemResult {
        let body = try JSONSerialization.data(withJSONObject: ["code": code])
        let (data, _) = try await request(method: "POST", path: "/api/store?action=redeem",
                                          body: body, contentType: "application/json")
        return try JSONDecoder().decode(StoreRedeemResult.self, from: data)
    }

    /// The add-tile magic lookups: the exact-word tile already on the board
    /// (for the replace dialog) + other tiles whose prompts mention the word.
    struct ImpactExisting: Decodable { let itemId: Int; let label: String; let imageKey: String?; let isDefault: Bool }
    struct ImpactTile: Decodable, Identifiable { var id: String { taxonomyId }
        let taxonomyId: String; let itemId: Int; let label: String; let previewKey: String? }
    struct ImpactResult: Decodable { let existing: ImpactExisting?; let affected: [ImpactTile] }
    func storeImpact(childId: String, word: String) async -> ImpactResult? {
        guard let (data, _) = try? await request(method: "GET",
            path: "/api/store?action=impact&childId=\(percentEscape(childId))&word=\(percentEscape(word))",
            body: nil) else { return nil }
        return try? JSONDecoder().decode(ImpactResult.self, from: data)
    }

    /// "Replace": the existing word tile adopts the new tile's image (old art
    /// archived server-side) and the duplicate row is removed safely.
    func storeAdoptImage(childId: String, sourceItemId: Int, targetItemId: Int) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "childId": childId, "sourceItemId": sourceItemId, "targetItemId": targetItemId])
        _ = try await request(method: "POST", path: "/api/store?action=adopt-image",
                              body: body, contentType: "application/json")
    }

    struct RegenWithResult: Decodable { let ok: Bool; let queued: Int; let charged: Int; let balance: Int?; let note: String? }
    func storeRegenWith(childId: String, taxonomyIds: [String], refItemId: Int) async throws -> RegenWithResult {
        let body = try JSONSerialization.data(withJSONObject: [
            "childId": childId, "taxonomyIds": taxonomyIds, "refItemId": refItemId])
        let (data, _) = try await request(method: "POST", path: "/api/store?action=regen-with",
                                          body: body, contentType: "application/json")
        return try JSONDecoder().decode(RegenWithResult.self, from: data)
    }

    // MARK: -- Seed starter words (chunked)

    /// One chunk of onboarding's resumable seed-core build. Mirrors the JSON the
    /// server returns from POST /api/onboarding/seed-core?g=<n>.
    struct SeedCoreChunk: Decodable {
        let ok: Bool
        let done: Bool
        let nextG: Int
        let total: Int
        let placed: Int
        let failed: Int
    }

    /// Live board-build progress (the durable seed_jobs draining server-side).
    struct SeedKindStatus: Decodable { let total: Int; let done: Int; let dead: Int }
    struct SeedStatus: Decodable {
        let active: Bool
        let render: SeedKindStatus
        let voice: SeedKindStatus
    }
    func seedStatus(childId: String) async -> SeedStatus? {
        guard let (data, _) = try? await request(method: "GET",
                                                 path: "/api/onboarding/seed-core?childId=\(percentEscape(childId))",
                                                 body: nil) else { return nil }
        return try? JSONDecoder().decode(SeedStatus.self, from: data)
    }

    /// Build ONE chunk of the child's starter board — the SAME resumable engine
    /// onboarding uses (upserts by taxonomy_slug, so it never dupes). The caller
    /// loops, passing `g = 0` first and then the returned `nextG`, until `done`.
    /// Keeping the loop in the caller lets a SwiftUI view update its progress
    /// @State on the main actor between chunks without any cross-actor hops.
    func seedCoreChunk(g: Int) async throws -> SeedCoreChunk {
        let (data, _) = try await request(method: "POST",
                                          path: "/api/onboarding/seed-core?g=\(g)",
                                          body: nil, contentType: "application/json",
                                          timeout: 320)
        return try JSONDecoder().decode(SeedCoreChunk.self, from: data)
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

    // Internal (not private) so feature extensions in other files — e.g. the
    // parent-app endpoints in Parent/ParentAPI.swift — can reuse the plumbing.
    func request(method: String,
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

import Foundation

/// Parent-app endpoints, kept in their own extension so the kid-board surface
/// of APIClient stays unchanged. Everything here talks to routes that already
/// exist on the web backend — no client-specific server code.
extension APIClient {

    // MARK: -- /api/message-to-board (PRD §4.7)

    struct MessageToken: Codable, Identifiable, Hashable {
        var id: String { word + (imageKey ?? "-") }
        let word: String
        let itemId: Int?
        let imageKey: String?
        let soundKey: String?
        let text: Bool?
        let holdMs: Double?
    }

    struct MessageResult: Codable {
        let ok: Bool
        let tokens: [MessageToken]
        let matched: Int
        let total: Int
    }

    /// Tokenizes the text against the child's board tiles server-side and
    /// publishes the sequence to the iPad through the live channel. The
    /// returned tokens are the preview ("this is how the child will see it").
    func sendMessageToBoard(childId: String, text: String) async throws -> MessageResult {
        let body = try JSONSerialization.data(withJSONObject: ["childId": childId, "text": text])
        let (data, _) = try await request(method: "POST", path: "/api/message-to-board",
                                          body: body, contentType: "application/json")
        do { return try JSONDecoder().decode(MessageResult.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    // MARK: -- /api/live commands (phone side — publish, not poll)

    /// Push a facilitator command to the child's iPad: start a game, end it.
    /// Mirrors the JSON therapist.html/parent.html publish via POST kind=cmd.
    func publishLiveCommand(childId: String, _ cmd: [String: Any]) async throws {
        var dict: [String: Any] = ["kind": "cmd"]
        for (k, v) in cmd { dict[k] = v }
        let body = try JSONSerialization.data(withJSONObject: dict)
        _ = try await request(method: "POST",
                              path: "/api/live?childId=\(percentEscapeParent(childId))",
                              body: body, contentType: "application/json")
    }

    // MARK: -- /api/analytics (PRD §4.5)

    /// Loosely-typed analytics payload: the endpoint returns several series and
    /// we only decode the parts the v1 stats screen renders. The server
    /// PRE-FORMATS these for display (mastery.pct is 0-100; session fields are
    /// ready-made strings like "4 / 5" and "12 min"), so the phone renders them
    /// verbatim — no client-side math to drift out of step with the web.
    struct AnalyticsResponse: Codable {
        struct MasteryRow: Codable, Identifiable {
            var id: String { name }
            let name: String
            let pct: Int           // 0-100, server-rounded
        }
        struct SessionRow: Codable, Identifiable {
            var id: String { (date ?? "") + (mode ?? "") + (result ?? "") }
            let date: String?      // "Jun 12"
            let mode: String?      // human label ("Matching")
            let category: String?  // resolved scope label
            let result: String?    // "4 / 5" or "—"
            let length: String?    // "12 min" or "—"
        }
        struct UseSeries: Codable, Identifiable, Hashable {
            var id: String { name }
            let name: String
            let data: [Int]
        }
        struct GameSeries: Codable, Identifiable, Hashable {
            var id: String { name }
            let name: String
            let data: [Double]      // accuracy 0-100 per bucket
        }
        struct ModeSeries: Codable, Identifiable, Hashable {
            var id: String { mode }
            let name: String      // human label ("Matching")
            let mode: String      // raw mode id ("self_paced", "auditory_comprehension"…)
            let data: [Double]    // accuracy 0-100 per bucket
        }
        struct UsePayload: Codable { let series: [UseSeries] }
        struct GamesPayload: Codable { let series: [GameSeries] }
        struct GamesByModePayload: Codable { let series: [ModeSeries] }

        // Forgiving decoder: every section optional, missing → empty default.
        // Important because the server's analytics endpoint may degrade any
        // single section to [] on error; we never want one weak signal to
        // hide the rest.
        let labels: [String]
        let mastery: [MasteryRow]
        let recentSessions: [SessionRow]
        let use: UsePayload
        let games: GamesPayload
        let gamesByMode: GamesByModePayload

        enum CodingKeys: String, CodingKey {
            case labels, mastery, recentSessions, use, games, gamesByMode
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            labels         = (try? c.decode([String].self, forKey: .labels))         ?? []
            mastery        = (try? c.decode([MasteryRow].self, forKey: .mastery))    ?? []
            recentSessions = (try? c.decode([SessionRow].self, forKey: .recentSessions)) ?? []
            use            = (try? c.decode(UsePayload.self, forKey: .use))          ?? UsePayload(series: [])
            games          = (try? c.decode(GamesPayload.self, forKey: .games))      ?? GamesPayload(series: [])
            gamesByMode    = (try? c.decode(GamesByModePayload.self, forKey: .gamesByMode)) ?? GamesByModePayload(series: [])
        }
    }

    func analytics(childId: String) async throws -> AnalyticsResponse {
        let (data, _) = try await request(method: "GET",
                                          path: "/api/analytics?childId=\(percentEscapeParent(childId))",
                                          body: nil)
        do { return try JSONDecoder().decode(AnalyticsResponse.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    // MARK: -- /api/album (picture memorabilia)

    struct AlbumEntry: Codable, Identifiable, Hashable {
        var id: String { blobKey + (when ?? "") }
        let label: String?
        let section: String?
        let blobKey: String
        let when: String?
        let kind: String?       // 'current' | 'history'
    }
    struct AlbumTile: Codable, Identifiable, Hashable {
        var id: String { (itemId.map(String.init) ?? "l:") + (label ?? "") + (section ?? "") }
        let itemId: Int?
        let label: String?
        let section: String?      // 'people' | 'nouns' | 'verbs' | 'needs' | 'events' | …
        let current: AlbumEntry?
        let history: [AlbumEntry]
    }
    struct AlbumByTileResponse: Codable {
        let tiles: [AlbumTile]
    }

    func albumByTile(childId: String, limit: Int = 600) async throws -> [AlbumTile] {
        let (data, _) = try await request(method: "GET",
                                          path: "/api/album?childId=\(percentEscapeParent(childId))&mode=by-tile&limit=\(limit)",
                                          body: nil)
        do { return try JSONDecoder().decode(AlbumByTileResponse.self, from: data).tiles }
        catch { throw APIError.decoding(error) }
    }

    // MARK: -- /api/advance-band (vocabulary level)

    struct BandStatus: Codable {
        struct Mastery: Codable {
            let correct: Int
            let total: Int
            let ready: Bool
            let lookbackDays: Int
            let minAttempts: Int
        }
        let current: String?
        let natural: String?
        let advanced: String?
        let next: String?
        let readyToAdvance: Bool?
        let mastery: Mastery?
    }

    func bandStatus(childId: String) async throws -> BandStatus {
        let (data, _) = try await request(method: "GET",
                                          path: "/api/advance-band?childId=\(percentEscapeParent(childId))",
                                          body: nil)
        do { return try JSONDecoder().decode(BandStatus.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    func advanceBand(childId: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["childId": childId, "reason": "parent"])
        _ = try await request(method: "POST", path: "/api/advance-band",
                              body: body, contentType: "application/json")
    }

    // MARK: -- /api/word-history (PRD §4.5)

    struct WordEvent: Codable, Identifiable, Hashable {
        let id: Int
        let label: String
        let category: String?
        let section: String?
        let when: String
    }
    struct WordHistoryResponse: Codable {
        let rows: [WordEvent]
        let hasMore: Bool
    }
    func wordHistory(childId: String, query: String?, since: Date?, until: Date?,
                     limit: Int = 200, offset: Int = 0) async throws -> WordHistoryResponse {
        let iso = ISO8601DateFormatter()
        var path = "/api/word-history?childId=\(percentEscapeParent(childId))&limit=\(limit)&offset=\(offset)"
        if let q = query?.trimmingCharacters(in: .whitespaces), !q.isEmpty {
            path += "&q=\(percentEscapeParent(q))"
        }
        if let since { path += "&since=\(percentEscapeParent(iso.string(from: since)))" }
        if let until { path += "&until=\(percentEscapeParent(iso.string(from: until)))" }
        let (data, _) = try await request(method: "GET", path: path, body: nil)
        do { return try JSONDecoder().decode(WordHistoryResponse.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    // MARK: -- /api/top-words

    struct TopWord: Codable, Identifiable, Hashable {
        var id: String { label.lowercased() }
        let label: String
        let count: Int
        let category: String?
        let section: String?
        let firstAt: String
        let lastAt: String
    }
    struct TopWordsResponse: Codable {
        let rows: [TopWord]
        let days: Int
    }
    func topWords(childId: String, days: Int = 30, limit: Int = 50) async throws -> TopWordsResponse {
        let (data, _) = try await request(
            method: "GET",
            path: "/api/top-words?childId=\(percentEscapeParent(childId))&days=\(days)&limit=\(limit)",
            body: nil
        )
        do { return try JSONDecoder().decode(TopWordsResponse.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    // MARK: -- /api/input-methods — how the child is answering over time

    struct InputMethodSeries: Codable, Identifiable, Hashable {
        var id: String { method }
        let method: String
        let data: [Int]
    }
    struct InputMethodCorrect: Codable, Hashable { let ok: Int; let total: Int }
    struct InputMethodsResponse: Codable {
        let totals: [String: Int]
        let correctBy: [String: InputMethodCorrect]
        let buckets: [String]
        let series: [InputMethodSeries]
    }
    func inputMethods(childId: String, days: Int = 30) async throws -> InputMethodsResponse {
        let (data, _) = try await request(
            method: "GET",
            path: "/api/input-methods?childId=\(percentEscapeParent(childId))&days=\(days)",
            body: nil
        )
        do { return try JSONDecoder().decode(InputMethodsResponse.self, from: data) }
        catch { throw APIError.decoding(error) }
    }

    // MARK: -- schedules (merge-safe write, mirrors saveDisplayPrefs)

    /// Write the schedules array back into child_settings without clobbering
    /// the other keys the web app stores in the same blob.
    func saveSchedules(childId: String, _ schedules: [[String: Any]]) async {
        guard let (data, _) = try? await request(
                method: "GET",
                path: "/api/child-settings?childId=\(percentEscapeParent(childId))",
                body: nil),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return }
        var settings = (root["settings"] as? [String: Any]) ?? [:]
        settings["schedules"] = schedules
        guard let body = try? JSONSerialization.data(withJSONObject: ["settings": settings]) else { return }
        _ = try? await request(method: "POST",
                               path: "/api/child-settings?childId=\(percentEscapeParent(childId))",
                               body: body, contentType: "application/json")
    }

    /// Raw schedules as dictionaries — used by the editor so unknown fields
    /// written by the web round-trip untouched.
    func fetchRawSchedules(childId: String) async -> [[String: Any]] {
        guard let (data, _) = try? await request(
                method: "GET",
                path: "/api/child-settings?childId=\(percentEscapeParent(childId))",
                body: nil),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let settings = root["settings"] as? [String: Any]
        else { return [] }
        return (settings["schedules"] as? [[String: Any]]) ?? []
    }

    // MARK: -- plumbing (extension can't see the private helper in APIClient)

    fileprivate func percentEscapeParent(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }
}

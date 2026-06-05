import Foundation

/// A category on the board. The shape mirrors `rowToCategory` in
/// `api/_lib/db.js`, so the Codable decoder reads `/api/sync` JSON directly.
struct Category: Codable, Identifiable, Hashable {
    let id: Int
    let section: BoardSection
    let label: String
    let parentId: Int?
    let imageKey: String?
    let imageUrl: String?
    let keepAspect: Bool
    let order: Int
    let childId: String?
    let ownerUserId: Int?
    let taxonomySlug: String?
    /// Special-render hint:
    ///   "location" → tap-to-speak + show its children as room tiles
    ///   "room"     → short-press speaks, long-press opens its interior
    ///   nil        → normal category (default)
    let kind: String?

    var isLocation: Bool { kind == "location" }
    var isRoom: Bool { kind == "room" }

    enum CodingKeys: String, CodingKey {
        case id, section, label
        case parentId
        case imageKey
        case imageUrl
        case keepAspect
        case order
        case childId
        case ownerUserId
        case taxonomySlug
        case kind
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        // The web sends section as the lowercase string already.
        let sec = try c.decode(String.self, forKey: .section).lowercased()
        section = BoardSection(rawValue: sec) ?? .nouns
        label = try c.decode(String.self, forKey: .label)
        parentId = try c.decodeIfPresent(Int.self, forKey: .parentId)
        imageKey = try c.decodeIfPresent(String.self, forKey: .imageKey)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        keepAspect = try c.decodeIfPresent(Bool.self, forKey: .keepAspect) ?? false
        order = try c.decodeIfPresent(Int.self, forKey: .order) ?? 0
        childId = try c.decodeIfPresent(String.self, forKey: .childId)
        ownerUserId = try c.decodeIfPresent(Int.self, forKey: .ownerUserId)
        taxonomySlug = try c.decodeIfPresent(String.self, forKey: .taxonomySlug)
        kind = try c.decodeIfPresent(String.self, forKey: .kind)
    }
}

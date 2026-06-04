import Foundation

/// One item / tile / button on the board. Mirrors `rowToItem` in
/// `api/_lib/db.js`.
struct Tile: Codable, Identifiable, Hashable {
    let id: Int
    let section: BoardSection
    let categoryId: Int?
    let label: String
    let imageKey: String?
    let imageUrl: String?
    let soundKey: String?
    let soundUrl: String?
    let keepAspect: Bool
    let order: Int
    let pinned: Bool
    let childId: String?
    let ownerUserId: Int?
    let taxonomySlug: String?

    enum CodingKeys: String, CodingKey {
        case id, section, label
        case categoryId
        case imageKey
        case imageUrl
        case soundKey
        case soundUrl
        case keepAspect
        case order
        case pinned
        case childId
        case ownerUserId
        case taxonomySlug
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        let sec = try c.decode(String.self, forKey: .section).lowercased()
        section = BoardSection(rawValue: sec) ?? .nouns
        categoryId = try c.decodeIfPresent(Int.self, forKey: .categoryId)
        label = try c.decode(String.self, forKey: .label)
        imageKey = try c.decodeIfPresent(String.self, forKey: .imageKey)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        soundKey = try c.decodeIfPresent(String.self, forKey: .soundKey)
        soundUrl = try c.decodeIfPresent(String.self, forKey: .soundUrl)
        keepAspect = try c.decodeIfPresent(Bool.self, forKey: .keepAspect) ?? false
        order = try c.decodeIfPresent(Int.self, forKey: .order) ?? 0
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
        childId = try c.decodeIfPresent(String.self, forKey: .childId)
        ownerUserId = try c.decodeIfPresent(Int.self, forKey: .ownerUserId)
        taxonomySlug = try c.decodeIfPresent(String.self, forKey: .taxonomySlug)
    }
}

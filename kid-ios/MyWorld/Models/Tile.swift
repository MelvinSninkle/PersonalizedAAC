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
    /// PRD §5: optional description used as the audio prompt in Auditory
    /// Comprehension mode (e.g. "lives in a field, four legs, eats grass").
    /// Falls back to "Who/what is the [label]?" in the view when empty.
    let description: String?
    /// Taxonomy teaching clues (easiest first) — spoken after the word by the
    /// "Teach me" slideshow. Attached by /api/sync from descriptive_clues.
    let descriptiveClues: [String]?
    /// True while a bulk-imported tile is awaiting the parent's review. The
    /// tile is already live on the board; this just surfaces it in the review
    /// queue. Cleared when the parent confirms it.
    let needsReview: Bool

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
        case description
        case descriptiveClues
        case needsReview
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
        description = try c.decodeIfPresent(String.self, forKey: .description)
        descriptiveClues = try c.decodeIfPresent([String].self, forKey: .descriptiveClues)
        needsReview = try c.decodeIfPresent(Bool.self, forKey: .needsReview) ?? false
    }
}

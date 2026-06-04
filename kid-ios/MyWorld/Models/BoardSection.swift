import Foundation

/// The four columns of the board, matching the web app's `section` field.
/// Order here drives the tab order.
enum BoardSection: String, CaseIterable, Identifiable, Codable {
    case people
    case nouns
    case verbs
    case needs

    var id: String { rawValue }

    /// Display label shown on the tab.
    var label: String {
        switch self {
        case .people: return "People"
        case .nouns:  return "Nouns"
        case .verbs:  return "Verbs"
        case .needs:  return "Needs"
        }
    }

    /// Pastel background color used by the web app for this section's column.
    /// Hex strings let us reuse exactly the same palette without baking SwiftUI
    /// Color conversion into the model layer.
    var bandHex: String {
        switch self {
        case .people: return "#fde7ef"
        case .nouns:  return "#fff4cc"
        case .verbs:  return "#dcefe2"
        case .needs:  return "#e3e8ff"
        }
    }
}

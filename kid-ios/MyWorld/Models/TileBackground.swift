import Foundation

/// Background-color presets a parent can pick for a generated tile.
/// The rawValue maps to the server's BG_PRESETS table in api/generate-image.js
/// (passed as ?bg=); `hex` is what the iOS picker swatch shows.
enum TileBackground: String, CaseIterable, Identifiable {
    case pink, mint, yellow, blue, peach, white

    var id: String { rawValue }

    /// Human label used in the picker menu.
    var label: String {
        switch self {
        case .pink:   return "Pink"
        case .mint:   return "Mint"
        case .yellow: return "Yellow"
        case .blue:   return "Blue"
        case .peach:  return "Peach"
        case .white:  return "White"
        }
    }

    /// Swatch color shown in the iOS picker — matches the soft pastel the
    /// model will paint.
    var hex: String {
        switch self {
        case .pink:   return "#ffe4ef"
        case .mint:   return "#dcefe2"
        case .yellow: return "#fff4cc"
        case .blue:   return "#e3e8ff"
        case .peach:  return "#ffe4cc"
        case .white:  return "#f8f8f8"
        }
    }
}

import CoreGraphics

/// Shared layout constants so BoardView and SectionColumn agree on exactly how
/// wide a column is for a given tiles-across count. Keeping these in one place
/// is what makes every tile across the board come out the same size.
enum BoardMetrics {
    /// Gap between tiles in a grid.
    static let tileGap: CGFloat = 8
    /// Horizontal inset on each side of a column's tile grid.
    static let columnPad: CGFloat = 6
    /// Width of the divider drawn between columns.
    static let dividerWidth: CGFloat = 1

    /// "A comfortable, default-density board is this many tiles across in total."
    /// Used to fix a constant tile size: at the default config (2+4+2 = 8) the
    /// board fills the screen; reduce any column's tiles-across and the board
    /// gets *narrower* (tiles keep their size) instead of the tiles ballooning.
    static let referenceAcross: CGFloat = 8

    /// Never shrink a tile below this even on a packed board.
    static let minTile: CGFloat = 44

    /// The exact width a column occupies for `across` tiles at `tile` size.
    static func columnWidth(across: Int, tile: CGFloat) -> CGFloat {
        let a = max(1, across)
        return CGFloat(a) * tile + CGFloat(a - 1) * tileGap + 2 * columnPad
    }
}

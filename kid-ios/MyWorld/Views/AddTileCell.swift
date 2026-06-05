import SwiftUI

/// The dashed "➕ Add tile" cell that sits at the end of a section's grid (and
/// the Needs strip) while the board is unlocked. It's the discoverable, in-grid
/// way to add a tile — a parent looking at People taps the one under People and
/// the add flow opens pre-set to People. Hidden entirely when the board is
/// locked, so the child never sees it.
struct AddTileCell: View {
    let size: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: "plus")
                    .font(.system(size: size * 0.30, weight: .semibold))
                Text("Add tile")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(Color(hex: "#ff1493"))
            .frame(width: size, height: size)
            .background(Color.white.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color(hex: "#ff1493").opacity(0.65),
                                  style: StrokeStyle(lineWidth: 2, dash: [7, 5]))
            )
        }
        .buttonStyle(.plain)
    }
}

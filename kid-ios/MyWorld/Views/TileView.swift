import SwiftUI

/// One tile button. The whole surface is a single hit target — touches fire on
/// the `onTapGesture` (native UIKit gesture under the hood), so there's no
/// 300ms click delay or double-tap-to-zoom fight the WebView has.
struct TileView: View {
    let tile: Tile
    let onTap: (Tile) -> Void

    @Environment(DisplayPrefs.self) private var prefs
    @State private var image: UIImage?

    var body: some View {
        Button {
            onTap(tile)
        } label: {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Color(.systemBackground))
                    if let img = image {
                        Image(uiImage: img)
                            .resizable()
                            .aspectRatio(contentMode: tile.keepAspect ? .fit : .fill)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                    } else {
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(Color.black.opacity(0.06), lineWidth: 1)
                )

                if !prefs.hideLabels {
                    Text(tile.label)
                        .font(.system(size: 17, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 4)
                }
            }
        }
        .buttonStyle(TileButtonStyle())
        .task(id: tile.imageKey) { await loadImage() }
    }

    private func loadImage() async {
        guard let key = tile.imageKey, !key.isEmpty else { return }
        if let img = await MediaCache.shared.image(for: key) {
            await MainActor.run { self.image = img }
        }
    }
}

/// Subtle scale-down on press, no system blue highlight — the same affordance
/// the web app gives but driven by native pressed-state instead of CSS.
struct TileButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1.0)
            .animation(.spring(response: 0.18, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

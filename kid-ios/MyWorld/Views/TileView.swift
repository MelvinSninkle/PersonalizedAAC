import SwiftUI

/// One tile button. The whole surface is a single hit target — touches fire on
/// the `onTapGesture` (native UIKit gesture under the hood), so there's no
/// 300ms click delay or double-tap-to-zoom fight the WebView has.
struct TileView: View {
    let tile: Tile
    let onTap: (Tile) -> Void
    /// When the board is unlocked, tapping a tile opens its editor instead of
    /// speaking (matching the web organizer). A pencil badge marks it editable.
    var editMode: Bool = false
    var onEdit: (Tile) -> Void = { _ in }
    /// THE one exception to the guillotine rule: tiles inside a folder named
    /// "TV" (see categoryNameIsPoster) show their natural poster aspect.
    /// Everything else center-crops to fill the square.
    var posterMode: Bool = false

    @Environment(DisplayPrefs.self) private var prefs
    @State private var image: UIImage?

    var body: some View {
        Button {
            if editMode { onEdit(tile) } else { onTap(tile) }
        } label: {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Color(.systemBackground))
                    if let img = image {
                        Image(uiImage: img)
                            .resizable()
                            .aspectRatio(contentMode: posterMode ? .fit : .fill)   // guillotine everywhere but the TV folder
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                    } else if tile.imageKey == nil || tile.imageKey?.isEmpty == true {
                        // WORD TILE: the art hasn't been generated yet (a fresh
                        // board whose custom render is still queued). Show the
                        // word big and warm — matches the web app's word-tile —
                        // instead of a broken-looking placeholder icon. The real
                        // image replaces it on a later sync with no layout shift.
                        RoundedRectangle(cornerRadius: 18)
                            .fill(Color(hex: "#fdf2f8"))
                        RoundedRectangle(cornerRadius: 18)
                            .strokeBorder(Color(hex: "#f3c6dd"), style: StrokeStyle(lineWidth: 2, dash: [7, 5]))
                        Text(tile.label)
                            .font(.system(size: 19, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color(hex: "#9d2463"))
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.5)
                            .padding(8)
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
                        .stroke(editMode ? Color(hex: "#ff1493").opacity(0.7) : Color.black.opacity(0.06),
                                lineWidth: editMode ? 2 : 1)
                )
                // Pencil badge so the parent knows the tile is tap-to-edit while
                // unlocked (and the pinned star, matching the web organizer).
                .overlay(alignment: .topTrailing) {
                    if editMode {
                        Image(systemName: "pencil.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(Color(hex: "#ff1493"))
                            .background(Circle().fill(.white))
                            .padding(5)
                    }
                }
                .overlay(alignment: .topLeading) {
                    if tile.pinned {
                        Image(systemName: "star.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(.yellow)
                            .padding(6)
                            .shadow(color: .black.opacity(0.25), radius: 1)
                    }
                }

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
        if let img = await MediaCache.shared.image(for: key, maxPixel: 640) {
            // GUILLOTINE RULE: trim baked-in margins, then the view center-
            // crops to fill the square. Sole exception: the TV folder keeps
            // its posters untouched.
            let display = posterMode ? img : img.trimmingFlatBorders()
            await MainActor.run { self.image = display }
        }
    }
}

// MARK: -- Display-crop for baked-in margins

extension UIImage {
    /// Crops away uniform "letterbox" margins baked INTO generated art (a
    /// subject drawn on a white/flat card, or an old non-square render saved
    /// with side bars). The tile frame is already square — this makes the
    /// PIXELS earn it. Caption bands survive (text isn't a flat border).
    /// Cheap sampled edge scan; returns self when nothing meaningful to trim.
    func trimmingFlatBorders(tolerance: Int = 18) -> UIImage {
        guard let cg = cgImage else { return self }
        let w = cg.width, h = cg.height
        guard w > 16, h > 16,
              let data = cg.dataProvider?.data,
              let ptr = CFDataGetBytePtr(data) else { return self }
        let bpr = cg.bytesPerRow
        let bpp = cg.bitsPerPixel / 8
        guard bpp >= 3 else { return self }

        func px(_ x: Int, _ y: Int) -> (Int, Int, Int) {
            let o = y * bpr + x * bpp
            return (Int(ptr[o]), Int(ptr[o + 1]), Int(ptr[o + 2]))
        }
        let corner = px(1, 1)
        func matches(_ p: (Int, Int, Int)) -> Bool {
            abs(p.0 - corner.0) <= tolerance && abs(p.1 - corner.1) <= tolerance && abs(p.2 - corner.2) <= tolerance
        }
        let stepX = max(1, w / 48), stepY = max(1, h / 48)
        func rowFlat(_ y: Int) -> Bool {
            var x = 0
            while x < w { if !matches(px(x, y)) { return false }; x += stepX }
            return true
        }
        func colFlat(_ x: Int) -> Bool {
            var y = 0
            while y < h { if !matches(px(x, y)) { return false }; y += stepY }
            return true
        }

        var top = 0, bottom = h - 1, left = 0, right = w - 1
        while top < bottom && rowFlat(top) { top += 1 }
        while bottom > top && rowFlat(bottom) { bottom -= 1 }
        while left < right && colFlat(left) { left += 1 }
        while right > left && colFlat(right) { right -= 1 }

        let nw = right - left + 1, nh = bottom - top + 1
        // Bail on degenerate results (a near-blank image would trim to nothing)
        // and skip the work when the trim is cosmetic (< ~2% each way).
        guard nw > w / 3, nh > h / 3, (w - nw > w / 50 || h - nh > h / 50) else { return self }
        guard let cropped = cg.cropping(to: CGRect(x: left, y: top, width: nw, height: nh)) else { return self }
        return UIImage(cgImage: cropped, scale: scale, orientation: imageOrientation)
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

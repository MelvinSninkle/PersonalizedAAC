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
    /// Present ONLY on the pre-login practice board (PracticeBoardView
    /// injects it): the Label Lab caption band, the pink/violet tier rings,
    /// and under-tile label suppression. nil on every real board, so nothing
    /// changes there.
    @Environment(PracticeChrome.self) private var practiceChrome: PracticeChrome?
    @State private var image: UIImage?

    private var practiceBandVisible: Bool {
        guard let chrome = practiceChrome else { return false }
        guard let key = tile.imageKey, !key.isEmpty else { return false }
        return !chrome.bandSkip.contains(tile.id)
    }

    var body: some View {
        Button {
            if editMode { onEdit(tile) } else { onTap(tile) }
        } label: {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Color(.systemBackground))
                    // Synchronous decoded-cache lookup first: lazy grids
                    // re-create this view on every scroll-in, and without this
                    // every appearance flashed the gray placeholder while the
                    // async decode re-ran. Anything ever decoded renders on
                    // the FIRST frame now; `image` covers the true cold path.
                    if let img = image ?? MediaCache.decodedImage(for: tile.imageKey, maxPixel: 640) {
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
                        Text(tile.display)
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
                    // Label Lab caption band (practice board only): the
                    // converged recipe as RATIOS of the tile's rendered width
                    // (band 180/1024, text 112/1024), text auto-shrinking to
                    // fit — the same treatment practice.html ships.
                    if practiceBandVisible {
                        GeometryReader { g in
                            VStack(spacing: 0) {
                                Spacer(minLength: 0)
                                Text(tile.display)
                                    .font(.system(size: g.size.width * 0.109, weight: .heavy, design: .rounded))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.35)
                                    .padding(.horizontal, 3)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: g.size.width * 0.176)
                                    .background(Color.white.opacity(0.93))
                                    .foregroundStyle(Color(hex: "#1f2937"))
                            }
                        }
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
                // Practice-board tier rings, same coding as practice.html:
                // Nouns (their whole world of things) = violet Pro, everything
                // else personalizable = pink Plus.
                .overlay {
                    if practiceChrome != nil {
                        RoundedRectangle(cornerRadius: 18)
                            .strokeBorder(tile.section == .nouns
                                          ? Color(hex: "#7c3aed").opacity(0.45)
                                          : Color(hex: "#ff1493").opacity(0.5),
                                          lineWidth: 2.5)
                    }
                }
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

                // Practice board: the caption band IS the label — never both.
                if !prefs.hideLabels && practiceChrome == nil {
                    Text(tile.display)
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
        // Already rendering synchronously from the decoded cache → no work.
        if MediaCache.decodedImage(for: key, maxPixel: 640) != nil { return }
        if let img = await MediaCache.shared.image(for: key, maxPixel: 640) {
            // NO automatic pixel trimming — auto blank-space removal was the
            // board's most-complained-about behavior and is deliberately gone.
            // The square frame center-crops (fill); Adjust framing is the
            // parent's tool for anything beyond that.
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

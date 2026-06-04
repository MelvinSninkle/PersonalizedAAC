import SwiftUI

/// The board, mirroring the web layout:
///
///   ┌──────── HEADER ────────┐
///   │ People │ Nouns │ Verbs │
///   │  (2fr) │ (4fr) │ (3fr) │
///   └──────── NEEDS ─────────┘   ← horizontal strip, full width
///
/// No navigation drill-in. Each section column owns its own selection
/// (current category + subcategory) so the three columns stay visible at
/// all times — exactly the AAC board affordance the web app gives Fletcher.
struct BoardView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(BoardStore.self) private var board

    @State private var showSettings = false

    /// Column flex ratios mirror the web's CSS `2fr 4fr 3fr`.
    private let ratios: (CGFloat, CGFloat, CGFloat) = (2, 4, 3)

    var body: some View {
        VStack(spacing: 0) {
            headerBar

            GeometryReader { geo in
                let total = ratios.0 + ratios.1 + ratios.2
                let w0 = geo.size.width * ratios.0 / total
                let w1 = geo.size.width * ratios.1 / total
                let w2 = geo.size.width * ratios.2 / total

                HStack(spacing: 0) {
                    SectionColumn(section: .people).frame(width: w0)
                    Divider()
                    SectionColumn(section: .nouns).frame(width: w1)
                    Divider()
                    SectionColumn(section: .verbs).frame(width: w2)
                }
            }

            Divider()
            NeedsStrip()
        }
        .background(Color(hex: "#fff7fb"))
        .sheet(isPresented: $showSettings) { SettingsView() }
        .task { await board.refresh(childId: auth.childSlug) }
        .refreshable { await board.refresh(childId: auth.childSlug) }
    }

    // MARK: -- Pink header strip

    private var headerBar: some View {
        HStack {
            Text("My World")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Spacer()
            // Tiny gear, long-press for parent settings.
            Image(systemName: "gearshape")
                .foregroundStyle(.white.opacity(0.55))
                .padding(8)
                .contentShape(Rectangle())
                .onLongPressGesture(minimumDuration: 0.7) {
                    showSettings = true
                }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color(hex: "#ff1493"))
    }
}

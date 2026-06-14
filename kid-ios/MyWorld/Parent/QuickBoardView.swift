import SwiftUI

/// PRD §4.3 — the fallback board. If the iPad is broken or left at home, the
/// child uses the parent's phone: this presents the EXACT same BoardView the
/// iPad renders (same store, same tap-to-speak), full screen. The exit is a
/// clearly-labeled pill that requires a 1.2s HOLD — findable for the parent,
/// but a child's taps can't dismiss it (and can't kill their own voice).
struct QuickBoardView: View {
    let onExit: () -> Void
    @State private var holdProgress: CGFloat = 0
    @State private var holding = false

    var body: some View {
        ZStack(alignment: .top) {
            BoardView()

            exitPill
                .padding(.top, 8)
        }
    }

    private var exitPill: some View {
        ZStack {
            Capsule().fill(Color.black.opacity(0.55))
            // Fill that sweeps left→right while holding, so the parent gets
            // clear feedback that the hold is registering.
            GeometryReader { geo in
                Capsule()
                    .fill(Color(hex: "#ff1493"))
                    .frame(width: geo.size.width * holdProgress)
            }
            .clipShape(Capsule())
            HStack(spacing: 7) {
                Image(systemName: holding ? "lock.open.fill" : "lock.fill")
                    .font(.system(size: 14, weight: .bold))
                Text(holding ? "Keep holding to exit…" : "Hold to exit to Parent app")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
        }
        .frame(height: 42)
        .fixedSize()
        .overlay(Capsule().stroke(.white.opacity(0.35), lineWidth: 1))
        .contentShape(Capsule())
        .gesture(
            LongPressGesture(minimumDuration: 1.2)
                .onChanged { _ in
                    holding = true
                    withAnimation(.linear(duration: 1.2)) { holdProgress = 1 }
                }
                .onEnded { _ in onExit() }
        )
        .simultaneousGesture(
            // Reset the fill if they let go early (the long-press onChanged
            // doesn't fire a release, so we catch lift-off here).
            DragGesture(minimumDistance: 0)
                .onEnded { _ in
                    if holdProgress < 1 {
                        holding = false
                        withAnimation(.easeOut(duration: 0.2)) { holdProgress = 0 }
                    }
                }
        )
        .accessibilityLabel("Hold to return to the parent app")
    }
}

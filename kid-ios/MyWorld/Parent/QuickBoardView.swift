import SwiftUI

/// PRD §4.3 — the fallback board. If the iPad is broken or left at home, the
/// child uses the parent's phone: this presents the EXACT same BoardView the
/// iPad renders (same store, same tap-to-speak), full screen. The only
/// addition is the exit affordance: a long-press (1.2s) on the small lock pill
/// — deliberate enough that the child's taps can't dismiss their own voice.
struct QuickBoardView: View {
    let onExit: () -> Void
    @State private var exitArmed = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            BoardView()

            // Exit pill — parent-only by gesture difficulty, mirrors the web
            // game-exit convention (1.2s hold).
            Image(systemName: "lock.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white.opacity(exitArmed ? 1 : 0.55))
                .padding(10)
                .background(.black.opacity(0.25), in: Circle())
                .padding(.top, 6)
                .padding(.trailing, 8)
                .onLongPressGesture(minimumDuration: 1.2) {
                    onExit()
                } onPressingChanged: { pressing in
                    exitArmed = pressing
                }
                .accessibilityLabel("Hold to return to the parent app")
        }
    }
}

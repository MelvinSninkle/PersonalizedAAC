import SwiftUI
import UIKit

/// The ✕ pattern used across all full-screen child views (matching, slideshow,
/// celebration, room interior). Tap does NOTHING — only a long-press (~0.7s)
/// closes the screen. Keeps Fletcher from accidentally exiting; parents can
/// hold to leave. A tiny haptic confirms the close.
///
/// Place inside a ZStack as the top layer; the `contentShape` + `onTapGesture`
/// absorb taps so they don't fall through to any tap-to-advance gesture below.
struct LongPressExitButton: View {
    let onExit: () -> Void
    var tint: Color = .white
    var background: Color = Color.white.opacity(0.16)

    var body: some View {
        Image(systemName: "xmark")
            .font(.title2.weight(.bold))
            .foregroundStyle(tint)
            .padding(14)
            .background(background)
            .clipShape(Circle())
            .contentShape(Rectangle())
            .onTapGesture {
                // Quick-tap close is a synced safety setting for older kids;
                // default keeps the tap as a deliberate no-op (kids mash).
                if TouchConfig.easyClose {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    onExit()
                }
            }
            // Hold length is the parent's exitHoldMs slider (Safety & unlock).
            .onLongPressGesture(minimumDuration: Double(TouchConfig.exitHoldMs) / 1000.0) {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                onExit()
            }
    }

    /// Convenience: place in the top-right corner with consistent insets.
    /// The wrapper is `.allowsHitTesting(false)` so the Spacers don't swallow
    /// touches meant for the underlying view (e.g. tap-to-advance in the
    /// slideshow). Only the X itself receives gestures.
    static func corner(tint: Color = .white,
                       background: Color = Color.white.opacity(0.16),
                       onExit: @escaping () -> Void) -> some View {
        VStack {
            HStack {
                Spacer().allowsHitTesting(false)
                LongPressExitButton(onExit: onExit, tint: tint, background: background)
                    .padding(.top, 18).padding(.trailing, 18)
            }
            Spacer().allowsHitTesting(false)
        }
    }
}

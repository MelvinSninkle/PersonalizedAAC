import SwiftUI

/// Standalone celebration mode — flowers/confetti + a vocalized cheer, for a
/// few seconds, then auto-closes. Mirrors the web's "Celebration" launcher
/// (a pure reward moment, no game).
struct CelebrationView: View {
    let onExit: () -> Void

    @Environment(AuthManager.self) private var auth
    @State private var celebrating = false

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: "#fff7fb"), Color(hex: "#ffe6f2")],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Text("🎉").font(.system(size: 120))
                Text("Hooray!")
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
            }

            ConfettiView(running: celebrating)

            LongPressExitButton.corner(
                tint: Color(hex: "#ad1457"),
                background: Color.black.opacity(0.06)
            ) { onExit() }
        }
        .task {
            celebrating = true
            GameAudio.shared.playCheer(childId: auth.childSlug)
            try? await Task.sleep(nanoseconds: 4_400_000_000)
            onExit()
        }
    }
}

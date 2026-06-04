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

            VStack {
                HStack {
                    Spacer()
                    Button { onExit() } label: {
                        Image(systemName: "xmark")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.secondary)
                            .padding(12)
                            .background(.thinMaterial)
                            .clipShape(Circle())
                    }
                    .padding(.top, 16).padding(.trailing, 16)
                }
                Spacer()
            }
        }
        .task {
            celebrating = true
            GameAudio.shared.playCheer(childId: auth.childSlug)
            try? await Task.sleep(nanoseconds: 4_400_000_000)
            onExit()
        }
    }
}

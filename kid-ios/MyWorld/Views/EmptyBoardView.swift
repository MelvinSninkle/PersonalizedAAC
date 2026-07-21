import SwiftUI

/// Full-screen welcome shown when the signed-in child's board has zero tiles —
/// a brand-new account that finished sign-up but hasn't generated its starter
/// words yet. The native match to the web app.html empty-state: build the
/// starter set right here (the same chunked seed-core engine onboarding uses),
/// rendered in the child's art style and spoken in the child's voice.
struct EmptyBoardView: View {
    /// Child's display name for the copy ("" when unknown → generic wording).
    let possessive: String        // e.g. "Simon's" or "your child's"
    /// Called after a successful build so the caller can re-sync the board.
    let onDone: () -> Void

    @State private var generating = false
    @State private var placed = 0
    @State private var total = 0
    @State private var errorText: String?

    private let api = APIClient()

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: "#7c3aed"), Color(hex: "#db2777")],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Text("🎨").font(.system(size: 60))

                Text("Let’s build \(possessive) board")
                    .font(.system(size: 27, weight: .heavy, design: .rounded))
                    .multilineTextAlignment(.center)

                Text("This board doesn’t have any tiles yet. Generate the starter words, the core vocabulary every new board begins with, and they’ll appear here in your art style and voice.")
                    .font(.system(size: 15))
                    .multilineTextAlignment(.center)
                    .opacity(0.95)
                    .fixedSize(horizontal: false, vertical: true)

                if generating {
                    VStack(spacing: 8) {
                        ProgressView(value: Double(min(placed, max(total, 1))),
                                     total: Double(max(total, 1)))
                            .tint(.white)
                        Text(total > 0 ? "Generating… \(min(placed, total)) of \(total) tiles"
                                       : "Starting…")
                            .font(.system(size: 13)).opacity(0.9)
                    }
                    .frame(maxWidth: 320)
                    .padding(.top, 4)
                } else {
                    Button(action: start) {
                        Text("✨ Generate starter words")
                            .font(.system(size: 17, weight: .heavy, design: .rounded))
                            .padding(.horizontal, 26).padding(.vertical, 14)
                            .background(Color.white)
                            .foregroundStyle(Color(hex: "#7c3aed"))
                            .clipShape(Capsule())
                            .shadow(color: .black.opacity(0.25), radius: 8, y: 4)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 4)
                }

                if let e = errorText {
                    Text(e)
                        .font(.system(size: 13))
                        .multilineTextAlignment(.center)
                        .opacity(0.95)
                        .padding(.horizontal, 12)
                }
            }
            .foregroundStyle(.white)
            .padding(28)
            .frame(maxWidth: 500)
        }
    }

    private func start() {
        generating = true
        errorText = nil
        // Loop the chunked build on the main actor so progress @State updates stay
        // on-main; each chunk is an `await` that suspends without blocking the UI.
        Task { @MainActor in
            do {
                var g = 0, guardN = 0
                while true {
                    let r = try await api.seedCoreChunk(g: g)
                    placed += r.placed
                    total = r.total
                    if r.done { break }
                    g = r.nextG
                    guardN += 1
                    if guardN > 400 { break }
                }
                onDone()
            } catch {
                generating = false
                errorText = "Could not generate: "
                    + ((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            }
        }
    }
}

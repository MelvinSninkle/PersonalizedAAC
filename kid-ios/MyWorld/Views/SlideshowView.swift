import SwiftUI

/// Slideshow game: cycles through a chosen set of tiles full-screen, plays
/// each tile's audio as it appears. Tap anywhere → next. ✕ in the corner →
/// exit back to the board.
struct SlideshowView: View {
    let session: GameController.Session
    let onExit: () -> Void

    @Environment(BoardStore.self) private var board
    @Environment(AuthManager.self) private var auth

    @State private var index: Int = 0
    @State private var tiles: [Tile] = []
    @State private var image: UIImage?
    @State private var celebrating = false

    private var current: Tile? { tiles.indices.contains(index) ? tiles[index] : nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let tile = current {
                VStack(spacing: 20) {
                    Spacer()
                    if let img = image {
                        Image(uiImage: img)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 720, maxHeight: 540)
                            .clipShape(RoundedRectangle(cornerRadius: 32))
                            .shadow(radius: 30)
                    } else {
                        ProgressView().tint(.white)
                    }
                    Text(tile.label)
                        .font(.system(size: 72, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                    Spacer()
                    Text("Tap anywhere for the next one")
                        .font(.callout)
                        .foregroundStyle(.white.opacity(0.5))
                        .padding(.bottom, 30)
                }
            } else {
                Text("No tiles to show")
                    .foregroundStyle(.white)
            }

            // Exit affordance — big enough for a parent to find quickly, far
            // enough from the center that a kid mashing the screen won't hit
            // it by accident.
            VStack {
                HStack {
                    Spacer()
                    Button {
                        onExit()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(14)
                            .background(Color.white.opacity(0.18))
                            .clipShape(Circle())
                    }
                    .padding(.top, 18)
                    .padding(.trailing, 18)
                }
                Spacer()
            }

            ConfettiView(running: celebrating)
        }
        .contentShape(Rectangle())
        .onTapGesture { advance() }
        .task { setup() }
        .onDisappear { GameAudio.shared.stopMusic() }
        .task(id: index) { await loadCurrent() }
    }

    private func setup() {
        // Use the same scope resolver as matching so sections / cat:<id> /
        // ranges all work, not just a bare numeric id.
        tiles = board.tilesForScope(session.scope, from: session.from, to: session.to)
            .filter { $0.imageKey?.isEmpty == false }
            .shuffled()
            .prefix(40).map { $0 }
        GameAudio.shared.startMusic(childId: auth.childSlug)
    }

    private func loadCurrent() async {
        image = nil
        guard let key = current?.imageKey, !key.isEmpty else { return }
        if let img = await MediaCache.shared.image(for: key) {
            await MainActor.run { self.image = img }
        }
        // Play the tile's audio as it appears.
        if let t = current {
            await TilePlayer.shared.play(t)
        }
    }

    private func advance() {
        if index + 1 < tiles.count {
            index += 1
        } else {
            // End of deck — celebrate with confetti + a vocalized cheer, then close.
            celebrating = true
            GameAudio.shared.playCheer(childId: auth.childSlug)
            Task {
                try? await Task.sleep(nanoseconds: 2_400_000_000)
                onExit()
            }
        }
    }
}

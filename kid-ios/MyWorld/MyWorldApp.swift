import SwiftUI
import AVFoundation

@main
struct MyWorldApp: App {
    @State private var auth = AuthManager()
    @State private var board = BoardStore()

    init() {
        setupAudioSession()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .environment(board)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
        }
    }

    /// Configure the iPad to play tile audio even with the silent switch on
    /// and to mix politely with other apps (so if a parent is playing music
    /// it ducks but doesn't stop).
    private func setupAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [.duckOthers])
            try session.setActive(true)
        } catch {
            // Non-fatal — speech will still work via the default route.
            print("AVAudioSession setup failed: \(error)")
        }
    }
}

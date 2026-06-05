import SwiftUI
import AVFoundation

@main
struct MyWorldApp: App {
    @State private var auth      = AuthManager()
    @State private var board     = BoardStore()
    @State private var prefs     = DisplayPrefs()
    @State private var live      = LiveSession()
    @State private var game      = GameController()
    @State private var scheduler = Scheduler()
    @State private var addQueue  = AddTileQueue()

    init() {
        setupAudioSession()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .environment(board)
                .environment(prefs)
                .environment(live)
                .environment(game)
                .environment(scheduler)
                .environment(addQueue)
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

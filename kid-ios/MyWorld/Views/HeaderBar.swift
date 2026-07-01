import SwiftUI

/// The pink (configurable) header strip across the top of the board. Layout
/// mirrors the web app:
///
///   ┌─[🔒]─────[title centered]──────[🙋 Play with me]─┐
///                                      [+ edit toolbar when unlocked]
///
/// Long-press the lock to flip into edit mode (which reveals ⚙ Display +
/// Parent / Therapist external links). No password gate in v0 — the gesture
/// itself is the parent-only affordance.
struct HeaderBar: View {
    @Environment(AuthManager.self) private var auth
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(AddTileQueue.self) private var addQueue
    @Environment(DeviceMode.self) private var mode

    @Binding var editMode: Bool
    @Binding var showDisplay: Bool
    @Binding var showSettings: Bool
    @Binding var listening: Bool
    let speech: SpeechListener
    @State private var showUnlock = false
    @State private var showAddTile = false

    var title: String { worldTitle(auth.user?.slug) }
    private var hex: String { prefs.colorHeaderText }

    var body: some View {
        ZStack {
            // Centered content: the branded title, or — while listening — the
            // live one-tile-high strip that takes over the branding spot.
            if listening {
                ListenStripView(speech: speech)
                    .padding(.horizontal, 66)   // clear the side buttons
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "globe.americas.fill")
                        .foregroundStyle(Color(hex: hex))
                    Text(title)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: hex))
                }
            }

            HStack {
                lockButton
                listenButton
                Spacer()
                trailingControls
            }
            .padding(.horizontal, 12)
        }
        .frame(height: listening ? 104 : 48)
        .animation(.easeInOut(duration: 0.2), value: listening)
        .background(Color(hex: prefs.colorHeaderBg))
        .onTapGesture(count: 3) {
            // Hidden gesture: triple-tap the bar to open settings (sign out,
            // clear cache). Long-press the lock for edit mode.
            showSettings = true
        }
        .sheet(isPresented: $showUnlock) {
            UnlockSheet { editMode = true }
        }
        // Full-screen (not a form sheet) so the board + its header don't bleed
        // through behind the add UI on iPad.
        .fullScreenCover(isPresented: $showAddTile) {
            AddTileView { showAddTile = false }
        }
    }

    // MARK: -- Left: the lock icon
    //
    // Tap = no-op (kids can mash on it and nothing happens — there's no flash
    //   of UI, no animation, nothing to "discover").
    // Tap when unlocked = re-locks immediately (one-tap exit for the parent).
    // Long-press 0.7s = opens the password sheet → unlock on correct password.

    private var lockButton: some View {
        Button {
            if editMode { editMode = false }
        } label: {
            Image(systemName: editMode ? "lock.open.fill" : "lock.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color(hex: hex).opacity(editMode ? 1 : 0.55))
                .padding(8)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.7)
                .onEnded { _ in
                    if !editMode { showUnlock = true }
                }
        )
    }

    // MARK: -- Left (after lock): the mic toggle for Listening Mode
    //
    // Deliberately NOT behind edit mode — the child can turn listening on/off
    // himself, mirrored opposite the Play button. Flips `listening`; BoardView
    // owns the actual speech start/stop + the 2-minute timeout.

    private var listenButton: some View {
        Button {
            listening.toggle()
        } label: {
            Image(systemName: listening ? "stop.circle.fill" : "mic.circle.fill")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(listening ? Color(hex: "#dc2626") : Color(hex: hex).opacity(0.9))
                .padding(6)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: -- Right: Play with me + (edit-only) toolbar

    @ViewBuilder
    private var trailingControls: some View {
        HStack(spacing: 8) {
            if editMode {
                // Adding tiles now happens from the dashed "+ Add tile" cells in
                // the board grid (discoverable, pre-set to the section you're
                // looking at). The header only surfaces a live render-status pill
                // while photos are still processing — tap it to open the tray and
                // watch progress / fix any that stumbled. Tiles finish + land on
                // the board even if this is dismissed.
                let rendering = addQueue.jobs.filter { $0.phase == .working }.count
                if rendering > 0 {
                    pillButton("⏳ \(rendering) rendering") { showAddTile = true }
                }
                pillButton("⚙ Display")  { showDisplay = true }
                // Switch THIS device to the native parent app. Lives in edit
                // mode (reached by long-pressing the lock) so it's discoverable
                // for a parent but unreachable for the child. The role persists,
                // so the device stays in parent mode until switched back.
                pillButton("🧑 Parent app") {
                    editMode = false
                    mode.role = .parent
                }
                if let slug = auth.user?.slug {
                    pillLink(label: "🩺 Therapist",
                             url: URL(string: "https://aac.andrewpeterson.io/therapist/\(slug)")!)
                }
            }
            playWithMeButton
        }
    }

    private var playWithMeButton: some View {
        Button {
            Task { await sendPlayRequest() }
        } label: {
            Text("🙋 Play with me")
                .font(.system(size: 14, weight: .semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(Color(hex: hex))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func pillButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(Color(hex: hex))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func pillLink(label: String, url: URL) -> some View {
        Link(destination: url) {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.18))
                .foregroundStyle(Color(hex: hex))
                .clipShape(Capsule())
        }
    }

    private func sendPlayRequest() async {
        let slug = auth.user?.slug ?? auth.childSlug
        let api = APIClient()
        await api.postEmpty(path: "/api/play-request?childId=\(slug)")
    }
}

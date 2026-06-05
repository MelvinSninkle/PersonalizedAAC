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

    @Binding var editMode: Bool
    @Binding var showDisplay: Bool
    @Binding var showSettings: Bool
    @State private var showUnlock = false

    var title: String { "\(prettyChildName(auth.user?.slug))'s World" }
    private var hex: String { prefs.colorHeaderText }

    var body: some View {
        ZStack {
            // Centered title fills the strip; the side controls overlay on top.
            HStack(spacing: 8) {
                Image(systemName: "globe.americas.fill")
                    .foregroundStyle(Color(hex: hex))
                Text(title)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: hex))
            }

            HStack {
                lockButton
                Spacer()
                trailingControls
            }
            .padding(.horizontal, 12)
        }
        .frame(height: 48)
        .background(Color(hex: prefs.colorHeaderBg))
        .onTapGesture(count: 3) {
            // Hidden gesture: triple-tap the bar to open settings (sign out,
            // clear cache). Long-press the lock for edit mode.
            showSettings = true
        }
        .sheet(isPresented: $showUnlock) {
            UnlockSheet { editMode = true }
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

    // MARK: -- Right: Play with me + (edit-only) toolbar

    @ViewBuilder
    private var trailingControls: some View {
        HStack(spacing: 8) {
            if editMode {
                pillButton("⚙ Display") { showDisplay = true }
                if let slug = auth.user?.slug {
                    pillLink(label: "👪 Parent",
                             url: URL(string: "https://aac.andrewpeterson.io/parent/\(slug)")!)
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

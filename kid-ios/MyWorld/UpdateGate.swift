import SwiftUI

/// Launch version gate — the one-way "please update" channel.
///
/// On launch the app fetches `/api/manifest?app=versions` (public, cached,
/// no auth) and compares its own CFBundleVersion against the server's two
/// thresholds for iOS:
///   - below `minBuild`  → a full-screen update wall (the build is known-broken
///     against the current API; better a clear message than silent failures).
///   - below `softBuild` → a dismissible "update available" card, once per
///     launch.
/// Both thresholds default to 0 server-side (env unset → gate off), and ANY
/// fetch/parse failure fails open — an AAC device must never lose its voice
/// to a flaky network or a misconfigured gate.
struct UpdateGate: ViewModifier {
    struct Gate: Decodable {
        let minBuild: Int?
        let softBuild: Int?
        let updateUrl: String?
        let note: String?
    }
    private struct Versions: Decodable { let ios: Gate? }

    @State private var walled: Gate?
    @State private var nudged: Gate?
    @State private var checked = false

    func body(content: Content) -> some View {
        ZStack {
            content
            if let g = walled {
                wallView(g)
                    .transition(.opacity)
            } else if let g = nudged {
                VStack {
                    Spacer()
                    nudgeCard(g)
                        .padding(16)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .task {
            guard !checked else { return }
            checked = true
            await check()
        }
    }

    private static var currentBuild: Int {
        Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "") ?? 0
    }

    private func check() async {
        guard let url = URL(string: APIClient.defaultOrigin + "/api/manifest?app=versions") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let v = try? JSONDecoder().decode(Versions.self, from: data),
              let g = v.ios else { return }   // fail open
        let build = Self.currentBuild
        guard build > 0 else { return }       // dev builds without a number: never gate
        if let min = g.minBuild, min > 0, build < min {
            withAnimation { walled = g }
        } else if let soft = g.softBuild, soft > 0, build < soft {
            withAnimation { nudged = g }
        }
    }

    private func wallView(_ g: Gate) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "arrow.down.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color(hex: Brand.pink))
            Text("Time to update My World")
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
                .multilineTextAlignment(.center)
            Text(g.note ?? "This version is too old to talk to our servers safely. Update and everything — the board, the pictures, the voices — is right where you left it.")
                .font(.system(size: 14))
                .foregroundStyle(Color(hex: Brand.muted))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
            if let s = g.updateUrl, let url = URL(string: s) {
                Link("Update now", destination: url)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.vertical, 13).padding(.horizontal, 28)
                    .background(Color(hex: Brand.pink), in: Capsule())
            } else {
                Text("Open the TestFlight app (or the App Store) and install the newest My World.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(hex: Brand.ink))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(hex: Brand.bg))
    }

    private func nudgeCard(_ g: Gate) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkles")
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            VStack(alignment: .leading, spacing: 4) {
                Text("A new My World is ready")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color(hex: Brand.ink))
                Text(g.note ?? "Update when convenient — new features and fixes are waiting.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
                HStack(spacing: 14) {
                    if let s = g.updateUrl, let url = URL(string: s) {
                        Link("Update", destination: url)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Color(hex: Brand.pinkDeep))
                    }
                    Button("Later") { withAnimation { nudged = nil } }
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: Brand.muted))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
        .shadow(color: .black.opacity(0.10), radius: 12, y: 4)
    }
}

extension View {
    /// Attach at the root — checks the server's minimum/suggested app build
    /// once per launch and shows the update wall / nudge as needed.
    func updateGate() -> some View { modifier(UpdateGate()) }
}

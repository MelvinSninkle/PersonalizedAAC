import SwiftUI

/// First-run chooser: is this the child's board or the parent's device?
/// Shown once after login when no role is stored. Both choices are reversible
/// from settings — picking wrong is a two-tap fix, so no confirmation step.
struct RolePickerView: View {
    @Environment(DeviceMode.self) private var mode
    @Environment(AuthManager.self) private var auth
    /// The tapped role while the destination view spins up — the first load
    /// pulls the whole board over the network, which can take several seconds
    /// with NOTHING on screen unless we say so here.
    @State private var opening: DeviceMode.Role?

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image("MyWorldLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
            Text("Who uses this device?")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))

            VStack(spacing: 16) {
                roleButton(
                    icon: "hand.tap.fill",
                    title: "\(childPossessive(auth.user?.slug, fallback: "Your child's")) board",
                    subtitle: "Big tiles, tap to talk. Best on a tablet in Guided Access.",
                    role: .childBoard
                )
                roleButton(
                    icon: "person.fill",
                    title: "Parent app",
                    subtitle: "Add tiles, start games, see progress, message the board.",
                    role: .parent
                )
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 560)

            Spacer()
            if opening != nil {
                HStack(spacing: 8) {
                    ProgressView()
                    Text(opening == .childBoard ? "Opening the board — loading pictures & voices…"
                                                : "Opening the parent app…")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color(hex: "#ad1457"))
                }
                .padding(.bottom, 24)
            } else {
                Text("You can change this any time in Settings.")
                    .font(.footnote)
                    .foregroundStyle(Color(hex: "#9ca3af"))
                    .padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(hex: "#fff7fb"))
    }

    private func roleButton(icon: String, title: String, subtitle: String, role: DeviceMode.Role) -> some View {
        Button {
            guard opening == nil else { return }
            opening = role
            // Let SwiftUI paint the spinner frame BEFORE the heavy destination
            // swap starts, so the tap visibly did something immediately.
            Task { @MainActor in
                await Task.yield()
                mode.role = role
            }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 54, height: 54)
                    .background(Color(hex: "#ff1493"), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 19, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: "#1f2937"))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: "#6b7280"))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if opening == role {
                    ProgressView()
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color(hex: "#c9b3bf"))
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

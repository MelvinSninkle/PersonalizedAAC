import SwiftUI

/// First-run chooser: is this the child's board or the parent's device?
/// Shown once after login when no role is stored. Both choices are reversible
/// from settings — picking wrong is a two-tap fix, so no confirmation step.
struct RolePickerView: View {
    @Environment(DeviceMode.self) private var mode
    @Environment(AuthManager.self) private var auth

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
                    title: "\(prettyChildName(auth.user?.slug)) — the communication board",
                    subtitle: "Big tiles, tap to talk. Use Guided Access to keep the child in the app.",
                    role: .childBoard
                )
                roleButton(
                    icon: "person.crop.circle.fill",
                    title: "Me — the parent app",
                    subtitle: "Add tiles on the go, start games, see progress, message the board.",
                    role: .parent
                )
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 560)

            Spacer()
            Text("You can change this any time in Settings.")
                .font(.footnote)
                .foregroundStyle(Color(hex: "#9ca3af"))
                .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(hex: "#fff7fb"))
    }

    private func roleButton(icon: String, title: String, subtitle: String, role: DeviceMode.Role) -> some View {
        Button {
            mode.role = role
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 30))
                    .foregroundStyle(Color(hex: "#ff1493"))
                    .frame(width: 44)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 18, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color(hex: "#1f2937"))
                        .multilineTextAlignment(.leading)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: "#6b7280"))
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(Color(hex: "#c9b3bf"))
            }
            .padding(16)
            .background(.white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

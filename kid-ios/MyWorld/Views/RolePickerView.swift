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
                    title: "\(prettyChildName(auth.user?.slug))'s board",
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
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: "#c9b3bf"))
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

import SwiftUI

/// Password gate for entering edit mode. Long-press the lock → this sheet
/// appears. Parent types their password → we POST /api/auth/login with the
/// stored email; success flips edit mode on, failure shows an inline error.
///
/// Critical UX detail: a kid can ALWAYS escape the sheet. The big "Cancel"
/// button + tap-outside-to-dismiss + the iOS swipe-down gesture all close
/// it. We do NOT trap focus or hide the dismiss affordances.
struct UnlockSheet: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let onUnlock: () -> Void

    @State private var password: String = ""
    @State private var error: String?
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer().frame(height: 8)

                Image(systemName: "lock.fill")
                    .font(.system(size: 44, weight: .bold))
                    .foregroundStyle(Color(hex: "#ff1493"))

                Text("Parent unlock")
                    .font(.title2.bold())

                Text(auth.user.map { "Enter the password for \($0.email)" } ?? "Sign in to continue")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .padding(14)
                    .background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal)
                    .submitLabel(.go)
                    .onSubmit { submit() }

                if let error {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                Button {
                    submit()
                } label: {
                    Text(submitting ? "Unlocking…" : "Unlock")
                        .font(.title3.weight(.semibold))
                        .padding(.vertical, 14)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(.white)
                        .background(Color(hex: "#ff1493"))
                        .clipShape(Capsule())
                }
                .disabled(submitting || password.isEmpty)
                .padding(.horizontal)

                Spacer()
            }
            .padding(.top, 12)
            .toolbar {
                // Big, obvious exit. Kid taps Cancel → back to the board.
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", role: .cancel) { dismiss() }
                        .font(.body.weight(.semibold))
                }
            }
            .interactiveDismissDisabled(false)   // swipe-down stays available
        }
    }

    private func submit() {
        guard let email = auth.user?.email else { dismiss(); return }
        submitting = true
        Task {
            let api = APIClient()
            do {
                _ = try await api.login(email: email, password: password)
                await MainActor.run {
                    submitting = false
                    onUnlock()
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    submitting = false
                    self.error = "That password didn't work. Try again."
                    self.password = ""
                }
            }
        }
    }
}

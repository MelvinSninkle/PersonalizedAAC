import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    @State private var email = ""
    @State private var password = ""
    @State private var submitting = false
    @State private var resetMsg: String?
    @State private var resetBusy = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            // The real app icon as the wordmark, with the rounded-square look.
            Image("MyWorldLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 116, height: 116)
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                .accessibilityLabel("My World")
            VStack(spacing: 2) {
                Text("My World")
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ff1493"))
                Text("Tap to Talk")
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457").opacity(0.8))
            }
            Text("Sign in to your child's board")
                .font(.title3)
                .foregroundStyle(Color(hex: "#6b7280"))

            VStack(spacing: 14) {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(14)
                    .background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .padding(14)
                    .background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .frame(maxWidth: 420)

            if let err = auth.lastError {
                Text(err)
                    .foregroundStyle(.red)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Button {
                Task {
                    submitting = true
                    await auth.signIn(email: email, password: password)
                    submitting = false
                }
            } label: {
                Text(submitting ? "Signing in…" : "Sign in")
                    .font(.title3.weight(.semibold))
                    .padding(.vertical, 14)
                    .frame(maxWidth: 420)
                    .foregroundStyle(.white)
                    .background(Color(hex: "#ff1493"))
                    .clipShape(Capsule())
            }
            .disabled(submitting || email.isEmpty || password.isEmpty)

            // Same reset flow as the web login: enter your email, get a link.
            Button {
                Task { await requestReset() }
            } label: {
                Text(resetBusy ? "Sending…" : "Forgot password?")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color(hex: "#ad1457"))
            }
            .disabled(resetBusy)
            if let m = resetMsg {
                Text(m)
                    .font(.footnote)
                    .foregroundStyle(Color(hex: "#047857"))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            Spacer()
            Spacer()
        }
        .padding()
        .background(Color(hex: "#fff7fb"))
    }

    private func requestReset() async {
        let addr = email.trimmingCharacters(in: .whitespaces)
        guard addr.contains("@") else {
            resetMsg = "Enter your account email above first, then tap again."
            return
        }
        resetBusy = true
        defer { resetBusy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["email": addr])
            _ = try await APIClient().request(method: "POST", path: "/api/auth/reset-request",
                                              body: body, contentType: "application/json")
            resetMsg = "If that email has an account, a reset link is on its way. Check your inbox."
        } catch {
            resetMsg = "Couldn't send the link — check your connection and try again."
        }
    }
}

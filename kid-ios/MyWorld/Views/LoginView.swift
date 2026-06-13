import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    @State private var email = ""
    @State private var password = ""
    @State private var submitting = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            // The My World "tap to talk" logo — the same globe mark the board
            // header and the web app use, bundled in Assets.xcassets.
            Image("MyWorldLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 132, height: 132)
                .accessibilityLabel("My World")
            VStack(spacing: 2) {
                Text("My World")
                    .font(.system(size: 46, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ff1493"))
                Text("Tap to Talk")
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457").opacity(0.75))
            }
            Text("Sign in to your child's board")
                .font(.title3)
                .foregroundStyle(.secondary)

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
            Spacer()
            Spacer()
        }
        .padding()
        .background(Color(hex: "#fff7fb"))
    }
}

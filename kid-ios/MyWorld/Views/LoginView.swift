import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    @State private var email = ""
    @State private var password = ""
    @State private var submitting = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("My World")
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ff1493"))
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

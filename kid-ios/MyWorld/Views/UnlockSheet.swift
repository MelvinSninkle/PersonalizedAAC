import SwiftUI

/// Password gate for entering edit mode. Long-press the lock → this sheet
/// appears. Parent types their password → we POST /api/auth/login with the
/// stored email; success flips edit mode on, failure shows an inline error.
///
/// #17: when this device has a quick-unlock PIN set (Settings → Safety), the
/// sheet opens on a 4-digit PIN pad instead — auto-submits on the 4th digit,
/// "Use password instead" is always one tap away, and five wrong PINs fall
/// back to the password until a successful unlock resets the counter.
///
/// Critical UX detail: a kid can ALWAYS escape the sheet. The big "Cancel"
/// button + tap-outside-to-dismiss + the iOS swipe-down gesture all close
/// it. We do NOT trap focus or hide the dismiss affordances.
struct UnlockSheet: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let onUnlock: () -> Void

    @State private var password: String = ""
    @State private var pin: String = ""
    @State private var pinMode = false
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

                if pinMode {
                    Text("Enter this device's 4-digit PIN")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    // Tappable pad, not a text field: no keyboard slides up,
                    // the unlock is immediate (4th digit submits).
                    HStack(spacing: 16) {
                        ForEach(0..<4, id: \.self) { i in
                            Circle()
                                .strokeBorder(Color(hex: "#ad1457"), lineWidth: 2)
                                .background(Circle().fill(i < pin.count ? Color(hex: "#ad1457") : .clear))
                                .frame(width: 16, height: 16)
                        }
                    }

                    let keys: [[String]] = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "⌫"]]
                    VStack(spacing: 10) {
                        ForEach(keys, id: \.self) { row in
                            HStack(spacing: 10) {
                                ForEach(row, id: \.self) { key in
                                    if key.isEmpty {
                                        Color.clear.frame(width: 76, height: 60)
                                    } else {
                                        Button {
                                            tapKey(key)
                                        } label: {
                                            Text(key)
                                                .font(.system(size: 24, weight: .bold, design: .rounded))
                                                .frame(width: 76, height: 60)
                                                .foregroundStyle(Color(hex: "#ad1457"))
                                                .background(Color(hex: "#fdf2f8"), in: RoundedRectangle(cornerRadius: 12))
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                    }

                    Button("Use password instead") {
                        pinMode = false
                        error = nil
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color(hex: "#ad1457"))
                } else {
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
                }

                if let error {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                if !pinMode {
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
                }

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
            .onAppear {
                pinMode = QuickPin.isSet && !QuickPin.lockedOut
            }
        }
    }

    private func tapKey(_ key: String) {
        if key == "⌫" {
            if !pin.isEmpty { pin.removeLast() }
            return
        }
        guard pin.count < 4 else { return }
        pin += key
        if pin.count == 4 { submitPin() }
    }

    private func submitPin() {
        if QuickPin.verify(pin, childId: auth.childSlug) {
            onUnlock()
            dismiss()
            return
        }
        pin = ""
        if QuickPin.lockedOut {
            pinMode = false
            error = "Too many PIN tries. Use your password."
        } else {
            error = "That PIN didn't match. Try again."
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
                    QuickPin.resetFails()   // a proven parent clears the PIN lockout
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

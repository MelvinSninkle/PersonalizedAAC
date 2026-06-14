import SwiftUI
import AuthenticationServices

/// The whole onboarding flow, gathered in one file so the sequence reads
/// top-to-bottom: Demo → Account → Child → Child photo → Parent photo →
/// Seed Core → Done. Each screen is a small struct; the OnboardingCoordinator
/// owns navigation + the data the parent has entered so far.
struct OnboardingFlow: View {
    @Environment(AuthManager.self) private var auth
    @Environment(OnboardingCoordinator.self) private var coord

    var body: some View {
        NavigationStack {
            current
        }
        .task {
            coord.isAuthenticated = auth.isSignedIn
        }
    }

    @ViewBuilder
    private var current: some View {
        switch coord.step {
        case .demo:        OnboardingDemoView()
        case .account:     OnboardingAccountView()
        case .child:       OnboardingChildView()
        case .childPhoto:  OnboardingPhotoView(role: .child)
        case .parentPhoto: OnboardingPhotoView(role: .parent)
        case .seedCore:    OnboardingSeedView()
        case .complete:    OnboardingDoneView()
        }
    }
}

// MARK: -- Shared chrome

/// Compact brand bar shown at the top of every onboarding screen — the app
/// logo + "My World / Tap to Talk" wordmark, so each page is clearly branded.
private struct OBBrandBar: View {
    var body: some View {
        HStack(spacing: 10) {
            Image("MyWorldLogo")
                .resizable().scaledToFit()
                .frame(width: 38, height: 38)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
            VStack(alignment: .leading, spacing: 0) {
                Text("My World")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.pink))
                Text("Tap to Talk")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.pinkDeep).opacity(0.8))
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Pink-card section heading used on every onboarding screen so the rhythm
/// reads as a single flow.
private struct OBHeader: View {
    let eyebrow: String
    let title: String
    let subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(eyebrow.uppercased())
                .font(.system(size: 11, weight: .bold)).tracking(0.8)
                .foregroundStyle(Color(hex: Brand.pink))
            Text(title)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.ink))
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: Brand.muted))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Big pink "continue" button — used as the primary CTA on every step.
/// `disabled` comes before `action` so callers can still use trailing-closure
/// syntax for the action (a trailing closure must be the final argument).
private struct OBPrimaryButton: View {
    let title: String
    let busy: Bool
    var disabled: Bool = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(.white) }
                Text(title).font(.system(size: 17, weight: .bold, design: .rounded))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 14)
            .background(Color(hex: Brand.pink), in: RoundedRectangle(cornerRadius: 999))
            .foregroundStyle(.white)
            .shadow(color: Color(hex: Brand.pink).opacity(0.35), radius: 8, y: 3)
        }
        .disabled(busy || disabled)
        .opacity(disabled ? 0.5 : 1)
    }
}

// MARK: -- Step 1: Demo (space reserved)

/// The first thing a brand-new parent sees. SPACE RESERVED for the actual
/// tap-real-tiles-and-hear-the-magic demo board; this scaffold keeps the
/// pacing right and the messaging in place until that demo content lands.
private struct OnboardingDemoView: View {
    @Environment(OnboardingCoordinator.self) private var coord

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OBBrandBar()
                OBHeader(eyebrow: "Welcome",
                         title: "A board that sounds like the child it belongs to.",
                         subtitle: "Watch what My World does for a real family. Tap any tile to hear it speak in their voice.")

                // ┌──────────────────────────────────────────────┐
                // │  DEMO BOARD GOES HERE                        │
                // │  An interactive sampler — tap a tile, hear   │
                // │  it speak, see the personalized art. Until   │
                // │  the demo is built, this slot shows a static │
                // │  illustration of what the board looks like.  │
                // └──────────────────────────────────────────────┘
                placeholderCard(
                    height: 320,
                    icon: "play.rectangle.fill",
                    title: "Live demo board",
                    note: "Replace with the tappable demo. For now this slot reserves space + sets pace."
                )

                ctaRow
            }
            .padding(20)
        }
        .background(Color(hex: Brand.bg))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var ctaRow: some View {
        VStack(spacing: 10) {
            OBPrimaryButton(title: "Make this for my child", busy: false) {
                coord.go(to: .account)
            }
            Text("Free to set up. Personalized board takes about 5 minutes.")
                .font(.system(size: 12))
                .foregroundStyle(Color(hex: Brand.muted))
        }
    }
}

// MARK: -- Step 2: Account (Apple first, email second)

private struct OnboardingAccountView: View {
    enum Mode: String, CaseIterable { case login, signup }

    @Environment(AuthManager.self) private var auth
    @Environment(OnboardingCoordinator.self) private var coord
    @State private var mode: Mode = .login           // returning parents are the common case after sign-out
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var errorText: String?
    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                OBBrandBar()
                OBHeader(eyebrow: "Account",
                         title: mode == .login ? "Welcome back." : "Save your child's board.",
                         subtitle: mode == .login
                            ? "Log in to the board you already set up."
                            : "Your data stays private to your family.")

                // Log in vs. create — returning parents land here after signing
                // out and need a way back in.
                Picker("", selection: $mode) {
                    Text("Log in").tag(Mode.login)
                    Text("Create account").tag(Mode.signup)
                }
                .pickerStyle(.segmented)

                // Apple works for BOTH modes — it signs in if the account
                // exists, creates it if not. Primary per App Store Review 4.8.
                SignInWithAppleButton(mode == .login ? .signIn : .signUp) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    Task { await handleApple(result) }
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 999))

                divider

                VStack(spacing: 10) {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: Brand.line), lineWidth: 1))
                    SecureField(mode == .login ? "Password" : "Password (at least 8 characters)", text: $password)
                        .textContentType(mode == .login ? .password : .newPassword)
                        .padding(12)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: Brand.line), lineWidth: 1))
                    if mode == .signup {
                        SecureField("Confirm password", text: $confirm)
                            .textContentType(.newPassword)
                            .padding(12)
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: Brand.line), lineWidth: 1))
                    }
                }

                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                }

                OBPrimaryButton(title: emailButtonTitle, busy: busy, disabled: !emailFormValid) {
                    Task { mode == .login ? await logIn() : await createEmailAccount() }
                }
            }
            .padding(20)
        }
        .background(Color(hex: Brand.bg))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var emailButtonTitle: String {
        if busy { return mode == .login ? "Signing in…" : "Creating…" }
        return mode == .login ? "Log in with email" : "Create account"
    }
    private var emailFormValid: Bool {
        guard !email.isEmpty else { return false }
        if mode == .login { return !password.isEmpty }
        return password.count >= 8 && password == confirm
    }

    private var divider: some View {
        HStack {
            Rectangle().fill(Color(hex: Brand.line)).frame(height: 1)
            Text("or").font(.system(size: 11, weight: .bold)).foregroundStyle(Color(hex: Brand.faint))
            Rectangle().fill(Color(hex: Brand.line)).frame(height: 1)
        }
    }

    // MARK: -- Auth actions

    private func handleApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let err):
            errorText = "Apple sign-in failed: \(err.localizedDescription)"
        case .success(let authResult):
            guard let cred = authResult.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = cred.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else {
                errorText = "Couldn't read Apple identity token."
                return
            }
            busy = true
            defer { busy = false }
            let name = [cred.fullName?.givenName, cred.fullName?.familyName]
                .compactMap { $0 }.joined(separator: " ")
            do {
                let resp = try await api.signInWithApple(.init(
                    identityToken: token,
                    fullName: name.isEmpty ? nil : name,
                    email: cred.email
                ))
                await auth.refreshFromServer()
                // Brand-new account → continue onboarding; existing → straight
                // to the board / parent home.
                finishAuth(created: resp.created ?? false)
            } catch {
                errorText = "Apple sign-in failed: \(error.localizedDescription)"
            }
        }
    }

    private func logIn() async {
        busy = true; errorText = nil
        defer { busy = false }
        await auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        if auth.isSignedIn {
            finishAuth(created: false)        // existing account → no onboarding
        } else {
            errorText = auth.lastError ?? "Invalid email or password."
        }
    }

    private func createEmailAccount() async {
        busy = true; errorText = nil
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: [
                "email": email.trimmingCharacters(in: .whitespaces),
                "password": password,
                "role": "parent",
            ])
            _ = try await api.request(method: "POST", path: "/api/auth/register",
                                      body: body, contentType: "application/json")
            await auth.refreshFromServer()
            finishAuth(created: true)         // new account → onboarding continues
        } catch {
            errorText = "Could not create the account: \(error.localizedDescription)"
        }
    }

    /// After any successful auth: a brand-new account continues the onboarding
    /// flow (needsOnboarding keeps ContentView on the flow even though we're
    /// now signed in); an existing account drops out to the board / home.
    private func finishAuth(created: Bool) {
        coord.isAuthenticated = true
        coord.needsOnboarding = created
        if created { coord.go(to: .child) }
        // When created == false, ContentView re-renders (isSignedIn flipped,
        // needsOnboarding false) and shows the role switch automatically.
    }
}

// MARK: -- Step 3: Child (name + birthday + language + tier)

private struct OnboardingChildView: View {
    @Environment(OnboardingCoordinator.self) private var coord
    @State private var busy = false
    @State private var errorText: String?
    private let api = APIClient()

    private struct Lang: Identifiable { let id: String; let label: String; let comingSoon: Bool }
    private let languages: [Lang] = [
        .init(id: "en", label: "English",    comingSoon: false),
        .init(id: "es", label: "Español",    comingSoon: true),
        .init(id: "fr", label: "Français",   comingSoon: true),
        .init(id: "pt", label: "Português",  comingSoon: true),
        .init(id: "de", label: "Deutsch",    comingSoon: true),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                OBBrandBar()
                OBHeader(eyebrow: "Step 1 of 4",
                         title: "Tell us about your child.",
                         subtitle: "Their birthday lets the board start with the right vocabulary — and grow with them.")

                fieldCard("Name") {
                    TextField("e.g. Fletcher", text: Binding(
                        get: { coord.childName },
                        set: { coord.childName = $0 }
                    ))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                }

                fieldCard("Birthday") {
                    DatePicker("", selection: Binding(
                        get: { coord.birthDate },
                        set: { coord.birthDate = $0 }
                    ), in: ...Date(), displayedComponents: .date)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                }

                fieldCard("Language") {
                    Picker("", selection: Binding(
                        get: { coord.language },
                        set: { coord.language = $0 }
                    )) {
                        ForEach(languages) { l in
                            Text(l.comingSoon ? "\(l.label) — coming soon" : l.label).tag(l.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(Color(hex: Brand.pinkDeep))
                }

                fieldCard("Attention tier") {
                    Picker("", selection: Binding(
                        get: { coord.tier },
                        set: { coord.tier = $0 }
                    )) {
                        Text("Under 3").tag("under3")
                        Text("3 – 5").tag("3to5")
                        Text("5 and up").tag("5plus")
                    }
                    .pickerStyle(.segmented)
                }
                Text("Tier shapes the session length the board uses for auto-teach and games. You can change it later.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
                    .padding(.leading, 4)

                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                }

                OBPrimaryButton(title: busy ? "Saving…" : "Continue",
                                busy: busy,
                                disabled: coord.childName.trimmingCharacters(in: .whitespaces).isEmpty) {
                    Task { await save() }
                }
            }
            .padding(20)
        }
        .background(Color(hex: Brand.bg))
    }

    @ViewBuilder
    private func fieldCard<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .bold)).tracking(0.6)
                .foregroundStyle(Color(hex: Brand.muted))
            content()
                .padding(12)
                .background(.white, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: Brand.line), lineWidth: 1))
        }
    }

    private func save() async {
        busy = true; errorText = nil
        defer { busy = false }
        do {
            _ = try await api.onboardingChild(
                name: coord.childName.trimmingCharacters(in: .whitespaces),
                birthDate: coord.birthDate,
                tier: coord.tier,
                language: coord.language
            )
            coord.go(to: .childPhoto)
        } catch {
            errorText = "Could not save: \(error.localizedDescription)"
        }
    }
}

// MARK: -- Step 4 + 5: Photos with retry + illustrative before/after

/// Reused for both the child and the first grown-up. Captures a photo, calls
/// the draft endpoint, shows the stylized result, and offers three actions:
/// Looks great (commit) · Try again (retry, free) · Different photo (recapture).
private struct OnboardingPhotoView: View {
    enum Role { case child, parent }
    let role: Role

    @Environment(OnboardingCoordinator.self) private var coord
    @State private var capturedJPEG: Data?
    @State private var draftKey: String?
    @State private var draftImage: UIImage?
    @State private var attempt = 0
    @State private var busy = false
    @State private var showPicker = false
    @State private var subjectName: String = ""
    @State private var relationship: String = "mother"
    @State private var errorText: String?
    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                OBBrandBar()
                header

                // Illustrative slot — show the before/after transformation
                // so the parent knows what's about to happen. Drop in your
                // own assets at "OnboardSampleBefore" / "OnboardSampleAfter"
                // in Assets.xcassets and the placeholders disappear.
                beforeAfterCard

                if let img = draftImage {
                    previewCard(img)
                    actionButtons
                } else if capturedJPEG != nil {
                    busyCard
                } else {
                    nameField
                    captureCard
                }

                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                }
            }
            .padding(20)
        }
        .background(Color(hex: Brand.bg))
        .sheet(isPresented: $showPicker) {
            CameraPicker { data in
                showPicker = false
                if let data { Task { await draft(data) } }
            }
        }
    }

    private var header: some View {
        OBHeader(
            eyebrow: role == .child ? "Step 2 of 4" : "Step 3 of 4",
            title: role == .child
                ? "Add a photo of \(coord.childName.isEmpty ? "your child" : coord.childName)."
                : "Add a photo of one grown-up.",
            subtitle: role == .child
                ? "Their face becomes the art on every tile that's about them — feelings, actions, social phrases. Plain head-and-shoulders works best."
                : "Body parts and comfort phrases are taught with a face the child looks at all day. Pick the grown-up they see most."
        )
    }

    /// Before/after illustration card. Uses bundled assets when they exist;
    /// shows a labeled placeholder otherwise.
    private var beforeAfterCard: some View {
        HStack(spacing: 14) {
            illustrativeImage(name: "OnboardSampleBefore",
                              fallbackIcon: "person.crop.square.filled.and.at.rectangle",
                              caption: "Your photo")
            Image(systemName: "arrow.right")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color(hex: Brand.pink))
            illustrativeImage(name: "OnboardSampleAfter",
                              fallbackIcon: "paintpalette.fill",
                              caption: "Stylized for the board")
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func illustrativeImage(name: String, fallbackIcon: String, caption: String) -> some View {
        VStack(spacing: 6) {
            ZStack {
                if let ui = UIImage(named: name) {
                    Image(uiImage: ui)
                        .resizable()
                        .scaledToFill()
                } else {
                    Color(hex: "#fff7fb")
                    VStack(spacing: 4) {
                        Image(systemName: fallbackIcon)
                            .font(.system(size: 24))
                            .foregroundStyle(Color(hex: Brand.pink))
                        Text("Add asset")
                            .font(.system(size: 9))
                            .foregroundStyle(Color(hex: Brand.faint))
                        Text(name)
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(Color(hex: Brand.faint))
                    }
                }
            }
            .frame(width: 96, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: Brand.line), lineWidth: 1))
            Text(caption)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.muted))
        }
        .frame(maxWidth: .infinity)
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 12) {
            if role == .parent {
                VStack(alignment: .leading, spacing: 6) {
                    Text("NAME")
                        .font(.system(size: 11, weight: .bold)).tracking(0.6)
                        .foregroundStyle(Color(hex: Brand.muted))
                    TextField("e.g. Mama, Dada, Grandma Jane", text: $subjectName)
                        .padding(12)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: Brand.line), lineWidth: 1))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("RELATIONSHIP")
                        .font(.system(size: 11, weight: .bold)).tracking(0.6)
                        .foregroundStyle(Color(hex: Brand.muted))
                    Picker("", selection: $relationship) {
                        Text("Mother").tag("mother")
                        Text("Father").tag("father")
                        Text("Step-parent").tag("stepmother")
                        Text("Guardian").tag("guardian")
                        Text("Grandmother").tag("grandmother")
                        Text("Grandfather").tag("grandfather")
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(.white, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: Brand.line), lineWidth: 1))
                }
            }
        }
    }

    private var captureCard: some View {
        Button { showPicker = true } label: {
            VStack(spacing: 10) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(Color(hex: Brand.pink), in: Circle())
                Text("Take or choose a photo")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.ink))
                Text("About 30 seconds to render.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 28)
            .background(.white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: Brand.line), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(role == .parent && subjectName.trimmingCharacters(in: .whitespaces).isEmpty)
        .opacity(role == .parent && subjectName.trimmingCharacters(in: .whitespaces).isEmpty ? 0.45 : 1)
    }

    private var busyCard: some View {
        HStack(spacing: 12) {
            ProgressView().tint(Color(hex: Brand.pink))
            Text("Painting the portrait…")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.muted))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 22)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func previewCard(_ ui: UIImage) -> some View {
        VStack(spacing: 10) {
            Image(uiImage: ui)
                .resizable().scaledToFit()
                .frame(maxWidth: 320)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
            Text("How does this look?")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            Text("Retries are free — try a few rolls and pick the one that feels right.")
                .font(.system(size: 12))
                .foregroundStyle(Color(hex: Brand.muted))
        }
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private var actionButtons: some View {
        VStack(spacing: 10) {
            OBPrimaryButton(title: busy ? "Saving…" : "Looks great", busy: busy) {
                Task { await commit() }
            }
            HStack(spacing: 10) {
                Button {
                    Task { await retry() }
                } label: {
                    Text(busy ? "…" : "Try again")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Color(hex: Brand.nextBg), in: Capsule())
                        .foregroundStyle(Color(hex: Brand.nextInk))
                }
                .disabled(busy)
                .buttonStyle(.plain)

                Button {
                    capturedJPEG = nil
                    draftKey = nil
                    draftImage = nil
                    attempt = 0
                    showPicker = true
                } label: {
                    Text("Different photo")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Color(hex: Brand.skipBg), in: Capsule())
                        .foregroundStyle(Color(hex: Brand.pinkDeep))
                }
                .disabled(busy)
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: -- Mutations

    private func draft(_ jpeg: Data) async {
        capturedJPEG = jpeg
        busy = true; errorText = nil
        defer { busy = false }
        do {
            let key = try await api.onboardingPhotoDraft(jpeg: jpeg)
            await loadPreview(key: key)
        } catch {
            errorText = "Couldn't render the portrait: \(error.localizedDescription)"
            capturedJPEG = nil
        }
    }

    private func retry() async {
        guard let key = draftKey else { return }
        busy = true; errorText = nil
        defer { busy = false }
        attempt += 1
        do {
            let next = try await api.onboardingPhotoRetry(draftKey: key, attempt: attempt)
            await loadPreview(key: next)
        } catch {
            errorText = "Retry failed: \(error.localizedDescription)"
        }
    }

    private func commit() async {
        guard let key = draftKey else { return }
        busy = true; errorText = nil
        defer { busy = false }
        do {
            switch role {
            case .child:
                try await api.onboardingPhotoCommit(
                    draftKey: key, role: "child",
                    name: coord.childName, relationship: "self"
                )
                coord.childPortraitKey = key
                coord.go(to: .parentPhoto)
            case .parent:
                try await api.onboardingPhotoCommit(
                    draftKey: key, role: "parent",
                    name: subjectName.trimmingCharacters(in: .whitespaces),
                    relationship: relationship
                )
                coord.parentPortraitKey = key
                coord.firstGrownupName = subjectName
                coord.firstGrownupRelationship = relationship
                coord.go(to: .seedCore)
            }
        } catch {
            errorText = "Could not save: \(error.localizedDescription)"
        }
    }

    private func loadPreview(key: String) async {
        draftKey = key
        if let bytes = try? await MediaCache.shared.data(for: key) {
            draftImage = UIImage(data: bytes)
        }
    }
}

// MARK: -- Step 6: Seed Core (explicit cost framing)

private struct OnboardingSeedView: View {
    @Environment(OnboardingCoordinator.self) private var coord
    @State private var busy = false
    @State private var queued: Int?
    @State private var errorText: String?
    private let api = APIClient()

    private let coreWords = [
        "more", "help", "stop", "go", "all done", "yes", "no",
        "mine", "look", "again", "eat", "drink", "hurt",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                OBBrandBar()
                OBHeader(
                    eyebrow: "Step 4 of 4",
                    title: "Let's make the first words.",
                    subtitle: "We'll generate \(coord.childName.isEmpty ? "your child" : coord.childName)'s 13 most useful first words now. Household items — favorite cup, blanket, stuffed animal — you'll snap as you go."
                )

                wordsGrid

                noteCard

                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                }

                if let n = queued {
                    Text("Queued \(n) tiles. About 90 seconds.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: Brand.good))
                    OBPrimaryButton(title: "Open the board", busy: false) {
                        coord.go(to: .complete)
                    }
                } else {
                    OBPrimaryButton(title: busy ? "Queuing…" : "Make these words", busy: busy) {
                        Task { await seed() }
                    }
                }
            }
            .padding(20)
        }
        .background(Color(hex: Brand.bg))
    }

    private var wordsGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8)], spacing: 8) {
            ForEach(coreWords, id: \.self) { w in
                Text(w)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.pinkDeep))
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .background(.white, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: Brand.line), lineWidth: 1))
            }
        }
    }

    private var noteCard: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "creditcard.fill")
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            VStack(alignment: .leading, spacing: 4) {
                Text("These first 13 don't count against your monthly credits.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(hex: Brand.ink))
                Text("Onboarding generation is on us. Your plan covers everything you add after.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 12))
    }

    private func seed() async {
        busy = true; errorText = nil
        defer { busy = false }
        do {
            let r = try await api.onboardingSeedCore()
            queued = r.queuedCount
        } catch {
            errorText = "Could not queue the starter tiles: \(error.localizedDescription)"
        }
    }
}

// MARK: -- Done

private struct OnboardingDoneView: View {
    @Environment(OnboardingCoordinator.self) private var coord
    @Environment(DeviceMode.self) private var mode
    private let api = APIClient()

    var body: some View {
        VStack(spacing: 18) {
            OBBrandBar().padding(.horizontal, 24)
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color(hex: Brand.good))
            Text("All set.")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            Text("\(coord.childName.isEmpty ? "Your child" : coord.childName)'s board is being painted now. Open it on this device, or hand the iPad to them.")
                .font(.system(size: 14))
                .foregroundStyle(Color(hex: Brand.muted))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            Spacer()
            OBPrimaryButton(title: "Open the parent app", busy: false) {
                Task {
                    await api.onboardingComplete()
                    // Leave the flow: clearing needsOnboarding lets ContentView
                    // render the role switch / parent home.
                    coord.needsOnboarding = false
                    mode.role = .parent
                }
            }
            .padding(.horizontal, 24)
        }
        .padding(.vertical, 40)
        .background(Color(hex: Brand.bg))
    }
}

// MARK: -- Generic shared placeholder card

private func placeholderCard(height: CGFloat, icon: String, title: String, note: String) -> some View {
    VStack(spacing: 10) {
        Image(systemName: icon)
            .font(.system(size: 30))
            .foregroundStyle(Color(hex: Brand.pink))
        Text(title)
            .font(.system(size: 15, weight: .bold, design: .rounded))
            .foregroundStyle(Color(hex: Brand.ink))
        Text(note)
            .font(.system(size: 11))
            .foregroundStyle(Color(hex: Brand.faint))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
    }
    .frame(maxWidth: .infinity, minHeight: height)
    .background(Color(hex: "#fff7fb"),
                in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    .overlay(
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
            .foregroundStyle(Color(hex: Brand.line))
    )
}

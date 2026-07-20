import SwiftUI
import AuthenticationServices
import AVFoundation
import PhotosUI
import UIKit

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

// MARK: -- Art style picker (shared by the Child step)

/// Horizontal swatch row of the available style guides. The picked style id is
/// stored on the coordinator and applied to the portraits + the Core seed, so
/// the whole board shares one look. Defaults to the first style so a look is
/// always chosen; if no styles are configured the server falls back on its own.
private struct OBStylePicker: View {
    @Environment(OnboardingCoordinator.self) private var coord
    @State private var styles: [APIClient.OnboardingStyle] = []
    @State private var loading = true
    private let api = APIClient()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("BOARD ART STYLE")
                .font(.system(size: 11, weight: .bold)).tracking(0.6)
                .foregroundStyle(Color(hex: Brand.muted))
            Text("The look for the whole board — the people portraits and the first words all share it.")
                .font(.system(size: 12))
                .foregroundStyle(Color(hex: Brand.muted))

            if loading {
                HStack(spacing: 8) {
                    ProgressView().tint(Color(hex: Brand.pink))
                    Text("Loading styles…").font(.system(size: 13)).foregroundStyle(Color(hex: Brand.muted))
                }
            } else if styles.isEmpty {
                Text("Using the default style.")
                    .font(.system(size: 13)).foregroundStyle(Color(hex: Brand.muted))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(styles) { s in
                            OBStyleSwatch(style: s, selected: coord.styleGuideId == s.id) {
                                coord.styleGuideId = s.id
                                coord.styleLabel = s.label
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                // Preview board: /practice renders the FULL starter board in
                // any published style (public shared art only — no login, no
                // family data), so the parent sees the whole look, not a swatch.
                if let sid = coord.styleGuideId,
                   let url = URL(string: APIClient.defaultOrigin + "/practice?style=\(sid)") {
                    Link(destination: url) {
                        Label("See a whole board in this style", systemImage: "rectangle.grid.3x2")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color(hex: Brand.pinkDeep))
                    }
                    .padding(.top, 2)
                }
            }
        }
        .task {
            guard styles.isEmpty else { return }
            defer { loading = false }
            if let result = try? await api.onboardingStyles() {
                styles = result
                if coord.styleGuideId == nil, let first = result.first {
                    coord.styleGuideId = first.id
                    coord.styleLabel = first.label
                }
            }
        }
    }
}

/// One style swatch — its reference image with the label underneath.
private struct OBStyleSwatch: View {
    let style: APIClient.OnboardingStyle
    let selected: Bool
    let onTap: () -> Void
    @State private var image: UIImage?
    private let api = APIClient()

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 6) {
                ZStack {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        Color(hex: "#fff7fb").overlay(ProgressView())
                    }
                }
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(selected ? Color(hex: Brand.pink) : Color(hex: Brand.line),
                                lineWidth: selected ? 3 : 1)
                )
                Text(style.label)
                    .font(.system(size: 11, weight: selected ? .bold : .semibold))
                    .foregroundStyle(selected ? Color(hex: Brand.pinkDeep) : Color(hex: Brand.muted))
                    .lineLimit(1)
            }
            .frame(width: 92)
        }
        .buttonStyle(.plain)
        .task(id: style.id) {
            if image == nil, let data = try? await api.onboardingStyleImage(id: style.id) {
                image = UIImage(data: data)
            }
        }
    }
}

/// Horizontal chips of the available TTS voices. The picked voice id is stored
/// on the coordinator and saved to the child, so every generated tile (the Core
/// seed + the People portraits + anything the parent adds later) speaks in it.
/// Each chip has a ▶ that auditions the voice from its preview sample.
private struct OBVoicePicker: View {
    @Environment(OnboardingCoordinator.self) private var coord
    @State private var voices: [APIClient.OnboardingVoice] = []
    @State private var sampleText = ""
    @State private var loading = true
    @State private var player: AVAudioPlayer?
    @State private var playingId: String?
    @State private var loadingId: String?

    private let api = APIClient()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("BOARD VOICE")
                .font(.system(size: 11, weight: .bold)).tracking(0.6)
                .foregroundStyle(Color(hex: Brand.muted))
            Text("How the board talks — tap ▶ to hear each voice.")
                .font(.system(size: 12))
                .foregroundStyle(Color(hex: Brand.muted))

            if loading {
                HStack(spacing: 8) {
                    ProgressView().tint(Color(hex: Brand.pink))
                    Text("Loading voices…").font(.system(size: 13)).foregroundStyle(Color(hex: Brand.muted))
                }
            } else if voices.isEmpty {
                Text("Using the default voice.")
                    .font(.system(size: 13)).foregroundStyle(Color(hex: Brand.muted))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(voices) { v in
                            OBVoiceChip(voice: v,
                                        selected: coord.voiceId == v.id,
                                        playing: playingId == v.id,
                                        loading: loadingId == v.id,
                                        onSelect: { coord.voiceId = v.id; coord.voiceName = v.name },
                                        onPreview: { Task { await preview(v) } })
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .task {
            guard voices.isEmpty else { return }
            defer { loading = false }
            if let catalog = try? await api.onboardingVoices() {
                voices = catalog.voices
                sampleText = catalog.sampleText ?? "Hi! I can help you talk. Tap a picture and I'll say the word."
                if coord.voiceId == nil, let first = catalog.voices.first {
                    coord.voiceId = first.id
                    coord.voiceName = first.name
                }
            }
        }
    }

    @MainActor
    private func preview(_ v: APIClient.OnboardingVoice) async {
        // Second tap on the playing voice = stop.
        if playingId == v.id { player?.stop(); playingId = nil; return }
        guard loadingId == nil else { return }
        loadingId = v.id
        defer { loadingId = nil }
        do {
            // Live synthesis — the voices endpoint sends no preview URLs; this
            // is the same POST /api/tts audition the web picker performs.
            let data = try await api.onboardingVoiceSample(voiceId: v.id, text: sampleText)
            let p = try AVAudioPlayer(data: data)
            p.prepareToPlay(); p.play()
            player = p
            playingId = v.id
        } catch { /* a failed preview shouldn't block selection */ }
    }
}

/// One voice chip — name + a short descriptor, with a play/stop preview button.
private struct OBVoiceChip: View {
    let voice: APIClient.OnboardingVoice
    let selected: Bool
    let playing: Bool
    let loading: Bool
    let onSelect: () -> Void
    let onPreview: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            Button(action: onSelect) {
                VStack(spacing: 4) {
                    Image(systemName: "waveform.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(selected ? Color(hex: Brand.pink) : Color(hex: Brand.muted))
                    Text(voice.name)
                        .font(.system(size: 12, weight: selected ? .bold : .semibold))
                        .foregroundStyle(selected ? Color(hex: Brand.pinkDeep) : Color(hex: Brand.ink))
                        .lineLimit(1)
                    if !voice.meta.isEmpty {
                        Text(voice.meta).font(.system(size: 9)).lineLimit(1)
                            .foregroundStyle(Color(hex: Brand.muted))
                    }
                }
                .frame(width: 104, height: 78)
                .padding(.horizontal, 4)
                .background(selected ? Color(hex: Brand.pink).opacity(0.10) : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(selected ? Color(hex: Brand.pink) : Color(hex: Brand.line),
                                lineWidth: selected ? 3 : 1)
                )
            }
            .buttonStyle(.plain)

            Button(action: onPreview) {
                if loading {
                    ProgressView().tint(Color(hex: Brand.pink)).frame(height: 22)
                } else {
                    Image(systemName: playing ? "stop.circle.fill" : "play.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(Color(hex: Brand.pink))
                }
            }
            .buttonStyle(.plain)
        }
        .frame(width: 104)
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

                // What-happens-next card (the tappable in-app demo is a
                // future build; until then this sells the promise without
                // shipping a visible "replace me" placeholder).
                VStack(alignment: .leading, spacing: 14) {
                    demoPoint(icon: "camera.fill",
                              title: "Photograph their world",
                              note: "Their snacks, their toys, their people — each photo becomes a talking tile.")
                    demoPoint(icon: "paintpalette.fill",
                              title: "Drawn in the style they love",
                              note: "Their face stays their face; the whole board shares one look.")
                    demoPoint(icon: "speaker.wave.2.fill",
                              title: "Tap a tile, it talks",
                              note: "In the voice you pick — plus listening, teaching, and game modes as they grow.")
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color(hex: Brand.line), lineWidth: 1))

                ctaRow
            }
            .padding(20)
        }
        .background(Color(hex: Brand.bg))
        // (helper lives below ctaRow)
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
            // Returning families skip the pitch — the account step defaults to
            // its "Welcome back" login mode, so this is a straight shot in.
            Button {
                coord.go(to: .account)
            } label: {
                (Text("Already have a board? ") + Text("Log in").bold().underline())
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: Brand.pinkDeep))
            }
            .buttonStyle(.plain)
            .padding(.top, 6)
        }
    }

    private func demoPoint(icon: String, title: String, note: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(Color(hex: Brand.pink), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.ink))
                Text(note)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(hex: Brand.muted))
            }
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
    @State private var inviteCode = ""
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

                // The COPPA/consent anchor — required before EITHER create
                // path (Apple or email). Log-ins don't need it.
                if mode == .signup {
                    // Invite code applies to BOTH create paths (Apple and
                    // email), so it sits above the Apple button. The server
                    // is the gate — an empty field just fails there with the
                    // same friendly message.
                    TextField("Invite code", text: $inviteCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: Brand.line), lineWidth: 1))
                    (Text("My World is invite-only during early access. No code yet? Join the waitlist at ")
                     + Text("our website").underline()
                     + Text("."))
                        .font(.system(size: 12))
                        .foregroundStyle(Color(hex: Brand.muted))
                        .onTapGesture {
                            if let url = URL(string: "\(APIClient.defaultOrigin)/#waitlist") {
                                UIApplication.shared.open(url)
                            }
                        }
                    Toggle(isOn: $consented) {
                        (Text("I'm the parent or legal guardian (or a caregiver with their permission), I'm 18+, and I agree to the ")
                         + Text("Terms of Service").underline()
                         + Text(" and ")
                         + Text("Privacy Policy").underline()
                         + Text(". Photos I upload are used only to illustrate our board."))
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color(hex: Brand.muted))
                    }
                    .toggleStyle(.switch)
                    .tint(Color(hex: Brand.pink))
                    .onTapGesture { }   // let the links below take real taps
                    HStack(spacing: 14) {
                        Link("Terms of Service", destination: URL(string: "\(APIClient.defaultOrigin)/terms")!)
                        Link("Privacy Policy", destination: URL(string: "\(APIClient.defaultOrigin)/privacy")!)
                    }
                    .font(.system(size: 12, weight: .semibold))
                }

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
                .disabled(mode == .signup && !consented)
                .opacity(mode == .signup && !consented ? 0.45 : 1)

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
        if mode == .signup && !consented { return false }
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
                    email: cred.email,
                    inviteCode: inviteCode.trimmingCharacters(in: .whitespaces)
                ))
                await auth.refreshFromServer()
                // Brand-new account → continue onboarding; existing → straight
                // to the board / parent home.
                finishAuth(created: resp.created ?? false)
            } catch {
                errorText = friendlyAuthError(error, fallback: "Apple sign-in failed: \(error.localizedDescription)")
            }
        }
    }

    @State private var consented = false

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
        guard consented else {
            errorText = "Please confirm the consent switch above — it covers the Terms, Privacy Policy, and how photos are used."
            return
        }
        busy = true; errorText = nil
        defer { busy = false }
        do {
            // selfSignup:true routes to the open parent path server-side —
            // without it register.js treats this as an admin-only call and
            // rejects every anonymous create.
            let body = try JSONSerialization.data(withJSONObject: [
                "email": email.trimmingCharacters(in: .whitespaces),
                "password": password,
                "selfSignup": true,
                "consent": true,
                "consentVersion": "2026-07",
                "inviteCode": inviteCode.trimmingCharacters(in: .whitespaces),
            ])
            _ = try await api.request(method: "POST", path: "/api/auth/register",
                                      body: body, contentType: "application/json")
            await auth.refreshFromServer()
            finishAuth(created: true)         // new account → onboarding continues
        } catch {
            errorText = friendlyAuthError(error, fallback: "Could not create the account: \(error.localizedDescription)")
        }
    }

    /// Auth errors come back as JSON {error, detail} inside a badStatus body —
    /// show the human sentence ("Enter the invite code you were given…"), not
    /// the raw JSON blob.
    private func friendlyAuthError(_ error: Error, fallback: String) -> String {
        if case let APIError.badStatus(_, body) = error,
           let data = body.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let d = obj["detail"] as? String, !d.isEmpty { return d }
            if let e = obj["error"] as? String, !e.isEmpty { return e }
        }
        return fallback
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
    @State private var favoriteColor = "#ff1493"
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

                // Favorite color → the banner color everywhere (§1); the server
                // computes the text contrast by luminance, one rule for all apps.
                VStack(alignment: .leading, spacing: 6) {
                    Text("WHAT IS YOUR CHILD'S FAVORITE COLOR?")
                        .font(.system(size: 11, weight: .bold)).tracking(0.6)
                        .foregroundStyle(Color(hex: Brand.muted))
                    Text("It becomes their banner color across the whole app. You can change it later.")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(hex: Brand.muted))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(["#ff1493", "#ef4444", "#f59e0b", "#facc15", "#22c55e",
                                     "#0ea5e9", "#3b82f6", "#8b5cf6", "#111827"], id: \.self) { hex in
                                Button {
                                    favoriteColor = hex
                                } label: {
                                    Circle()
                                        .fill(Color(hex: hex))
                                        .frame(width: 36, height: 36)
                                        .overlay(Circle().stroke(
                                            favoriteColor == hex ? Color(hex: Brand.ink) : Color.black.opacity(0.15),
                                            lineWidth: favoriteColor == hex ? 3 : 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }

                OBStylePicker()
                OBVoicePicker()

                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                }

                // Stays ENABLED: tapping with something missing names the exact
                // field (a disabled button explains nothing to a stressed parent).
                OBPrimaryButton(title: busy ? "Saving…" : "Continue", busy: busy) {
                    if coord.styleGuideId == nil { errorText = "You need to select a style."; return }
                    if coord.voiceId == nil { errorText = "Please select a voice."; return }
                    if coord.childName.trimmingCharacters(in: .whitespaces).isEmpty {
                        errorText = "Please enter your child's name."; return
                    }
                    errorText = nil
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
                language: coord.language,
                voiceId: coord.voiceId,
                styleGuideId: coord.styleGuideId,
                favoriteColor: favoriteColor
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
    @State private var genStartedAt: Date?
    @State private var attempt = 0
    @State private var busy = false
    @State private var showPicker = false
    @State private var showLibrary = false
    @State private var showSourceChoice = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var subjectName: String = ""
    @State private var relationship: String = "mother"
    @State private var errorText: String?
    /// How many grown-ups committed so far, and whether to show the "add another
    /// grown-up?" choice between them (the parent step is repeatable).
    @State private var addedGrownups = 0
    @State private var showAddMore = false
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

                if role == .parent && showAddMore {
                    addMoreCard
                } else if let img = draftImage {
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
        // fullScreenCover, NOT sheet: an iPad form-sheet camera renders a
        // black preview (see CameraPicker's header comment).
        .fullScreenCover(isPresented: $showPicker) {
            CameraCapture { data in
                showPicker = false
                if let data { Task { await draft(data) } }
            }
            .ignoresSafeArea()
        }
        // Let the parent choose the camera OR their photo library (the bug was
        // that this went straight to the camera with no library option).
        .confirmationDialog("Add a photo", isPresented: $showSourceChoice, titleVisibility: .visible) {
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take Photo") { showPicker = true }
            }
            Button("Choose from Library") { showLibrary = true }
            Button("Cancel", role: .cancel) {}
        }
        .photosPicker(isPresented: $showLibrary, selection: $libraryItem, matching: .images)
        .onChange(of: libraryItem) { _, item in
            guard let item else { return }
            Task {
                let raw = try? await item.loadTransferable(type: Data.self)
                libraryItem = nil
                if let raw, let jpeg = downscaleJPEG(raw, maxDim: 1024, quality: 0.85) {
                    await draft(jpeg)
                }
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

    /// Before/after illustration card. Renders ONLY when the bundled sample
    /// assets exist — a dashed "Add asset" box shipped to real parents until
    /// this guard (assets still aren't in the catalog; card self-hides).
    @ViewBuilder
    private var beforeAfterCard: some View {
        if UIImage(named: "OnboardSampleBefore") != nil,
           UIImage(named: "OnboardSampleAfter") != nil {
            beforeAfterContent
        }
    }

    private var beforeAfterContent: some View {
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
        Button {
            // Field-specific gate instead of a mute disabled card (§3).
            if role == .parent && subjectName.trimmingCharacters(in: .whitespaces).isEmpty {
                errorText = "Please enter their name first."
            } else {
                errorText = nil
                showSourceChoice = true
            }
        } label: {
            VStack(spacing: 10) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(Color(hex: Brand.pink), in: Circle())
                Text("Take or choose a photo")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.ink))
                Text("Rendering takes 1–5 minutes.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 28)
            .background(.white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: Brand.line), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    /// Elapsed ticker (§2): a long render must read as WORKING, not broken.
    /// The timeline dies with this card — failures return to the capture
    /// card, so the timer can never run forever over a dead request.
    private var busyCard: some View {
        VStack(spacing: 6) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let s = max(0, Int(context.date.timeIntervalSince(genStartedAt ?? context.date)))
                HStack(spacing: 12) {
                    ProgressView().tint(Color(hex: Brand.pink))
                    Text("Painting the portrait… \(s >= 60 ? "\(s / 60)m " : "")\(s % 60)s")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color(hex: Brand.muted))
                }
            }
            Text("This may take anywhere from 1 to 5 minutes — don't be alarmed.")
                .font(.system(size: 12))
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
        genStartedAt = Date()
        busy = true; errorText = nil
        defer { busy = false; genStartedAt = nil }
        do {
            // The style sample shows kids — tell the server which portrait this
            // is so grown-ups get adult proportions, not the child eye treatment.
            let key = try await api.onboardingPhotoDraft(jpeg: jpeg, styleGuideId: coord.styleGuideId,
                                                         subject: role == .child ? "child" : "adult")
            await loadPreview(key: key)
        } catch {
            errorText = "Couldn't render the portrait: \(error.localizedDescription)"
            capturedJPEG = nil
        }
    }

    private func retry() async {
        guard let key = draftKey else { return }
        genStartedAt = Date()
        busy = true; errorText = nil
        defer { busy = false; genStartedAt = nil }
        attempt += 1
        do {
            let next = try await api.onboardingPhotoRetry(draftKey: key, attempt: attempt, styleGuideId: coord.styleGuideId,
                                                          subject: role == .child ? "child" : "adult")
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
                if addedGrownups == 0 {
                    coord.parentPortraitKey = key
                    coord.firstGrownupName = subjectName
                    coord.firstGrownupRelationship = relationship
                }
                addedGrownups += 1
                // Repeatable: offer to add more grown-ups (other parent, sibling,
                // grandparent, nanny) before moving on. Each becomes a face the
                // taxonomy can anchor on.
                resetCapture()
                showAddMore = true
            }
        } catch {
            errorText = "Could not save: \(error.localizedDescription)"
        }
    }

    private func resetCapture() {
        capturedJPEG = nil; draftKey = nil; draftImage = nil
        attempt = 0; subjectName = ""; relationship = "mother"; errorText = nil
    }

    private var addMoreCard: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 44)).foregroundStyle(Color(hex: Brand.good))
            Text(addedGrownups == 1 ? "Grown-up added!" : "\(addedGrownups) grown-ups added!")
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            Text("Add anyone else the child sees a lot — the other parent, a sibling, a grandparent, a nanny. Each face anchors the tiles about them. You can always add more later from Family & people.")
                .font(.system(size: 13)).foregroundStyle(Color(hex: Brand.muted))
                .multilineTextAlignment(.center).padding(.horizontal, 8)
            OBPrimaryButton(title: "Add another grown-up", busy: false) { showAddMore = false }
            Button("Continue") { coord.go(to: .seedCore) }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
                .padding(.top, 2)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(.white, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func loadPreview(key: String) async {
        draftKey = key
        // Downsampled decode: this can be a fresh 12 MP camera photo, which
        // costs ~48 MB of RAM decoded at full resolution (jetsam territory).
        draftImage = await MediaCache.shared.image(for: key, maxPixel: 1024)
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

                if !coord.styleLabel.isEmpty {
                    Label("In your \(coord.styleLabel) style", systemImage: "paintpalette.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: Brand.pinkDeep))
                }

                wordsGrid

                noteCard

                if let e = errorText {
                    Text(e).font(.footnote).foregroundStyle(.red)
                }

                if let n = queued {
                    Text("Queued \(n) tiles. About 90 seconds.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: Brand.good))

                    // The captive wait is when a parent actually reads — use it
                    // to fit the board's behavior to this child (same questions
                    // as the web onboarding's board-behavior wizard).
                    OBSettingsWizard(childName: coord.childName)

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
                Text("Your first month's credits build the whole board.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(hex: Brand.ink))
                Text("100+ tiles and two family portraits, personalized up front (Pro finishes with ⭐50 to spare). Cancel anytime — everything you make stays yours, forever.")
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
            let r = try await api.onboardingSeedCore(styleGuideId: coord.styleGuideId)
            queued = r.queuedCount
        } catch {
            // No membership yet → the join step, not a failure. The server's
            // 402 carries the human sentence; surface it instead of raw JSON.
            if case let APIError.badStatus(code, body) = error, code == 402,
               body.contains("membership_required") {
                errorText = "One step left: join My World Plus ($9.99/mo) or Pro ($19.99/mo) in Credits & Store — your first month's credits build the whole personalized board. Your setup is saved; come back here and try again after joining."
            } else {
                errorText = "Could not queue the starter tiles: \(error.localizedDescription)"
            }
        }
    }
}

// MARK: -- Board-behavior wizard (seed wait)

/// Five plain-language questions asked while the starter tiles paint — the
/// iOS twin of onboard.html's #bw-setup. Each maps onto a parent-writable
/// synced Display setting the board already honors (doubleTapTeach,
/// tapInterrupt, toolSentence, toolListen, easyClose); every answer saves
/// immediately via the merge-safe child-settings write, and the same toggles
/// live under ⚙ Display settings afterwards.
private struct OBSettingsWizard: View {
    let childName: String
    @State private var childId: String?
    @State private var started = false
    @State private var declined = false
    @State private var index = 0
    @State private var saving = false
    @State private var errorText: String?
    private let api = APIClient()

    private struct Choice { let label: String; let key: String; let value: Bool }
    private struct Question { let title: String; let body: String; let choices: [Choice] }

    private var name: String { childName.isEmpty ? "your child" : childName }

    private var questions: [Question] {
        [
            Question(
                title: "Does \(name) need to learn what words mean, or mostly say them?",
                body: "With “Tap again to learn” on, a tap speaks the word — and a quick second tap teaches a fun fact about it, up to three facts, before wrapping back to the word. Great for kids still building meanings. If your child mainly needs their words spoken, leave it off — taps stay simple and fast.",
                choices: [
                    Choice(label: "🎓 Still learning meanings — turn on Tap again to learn", key: "doubleTapTeach", value: true),
                    Choice(label: "🗣 They know their words — keep taps simple", key: "doubleTapTeach", value: false),
                ]),
            Question(
                title: "If a new tile is tapped while another is still talking…",
                body: "“Let each word finish” is calmer for kids who tap the same button over and over — every word plays to the end instead of restarting. “The new tap wins” feels snappier for quick communicators.",
                choices: [
                    Choice(label: "🌊 Let each word finish", key: "tapInterrupt", value: false),
                    Choice(label: "⚡ The new tap wins — talk right away", key: "tapInterrupt", value: true),
                ]),
            Question(
                title: "Is \(name) starting to put words together?",
                body: "The ✏️ sentence builder in the board header lets a child stage several tiles and play them back as one sentence. If your child is at single words today, hide it — fewer buttons, less clutter. It comes back with one toggle whenever they’re ready.",
                choices: [
                    Choice(label: "✏️ Yes — show the sentence builder", key: "toolSentence", value: true),
                    Choice(label: "🔤 Single words for now — hide it", key: "toolSentence", value: false),
                ]),
            Question(
                title: "Want the board to show the words \(name) hears?",
                body: "Listening mode (the ear in the board header) captions grown-ups’ speech as tappable words, so your child connects what they hear to their tiles. Bad-word censoring is on by default. Hide it if it would only be a distraction right now.",
                choices: [
                    Choice(label: "👂 Keep Listening mode", key: "toolListen", value: true),
                    Choice(label: "🙈 Hide it for now", key: "toolListen", value: false),
                ]),
            Question(
                title: "How should the ✕ close button work in games and slideshows?",
                body: "Hold-to-close is kid-proof: a quick mash does nothing; only a deliberate hold exits. Quick tap is instant — better for older kids who close things on purpose. (You can tune the hold length later in Display settings.)",
                choices: [
                    Choice(label: "🛡 Hold to close (kid-proof)", key: "easyClose", value: false),
                    Choice(label: "⚡ Quick tap closes right away", key: "easyClose", value: true),
                ]),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if declined {
                Text("No problem — the same choices live in ⚙ Display settings, with the same plain-language explanations.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
            } else if !started {
                Text("While the tiles paint — five quick questions")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.ink))
                Text("Every child uses their talker differently. Answer these now and \(name)'s board behaves the right way from day one. Everything can be changed later under ⚙ Display settings.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
                HStack(spacing: 10) {
                    Button("Let's do it") { started = true }
                        .font(.system(size: 13, weight: .bold))
                        .buttonStyle(.borderedProminent)
                        .tint(Color(hex: Brand.pink))
                    Button("Maybe later") { declined = true }
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: Brand.muted))
                }
            } else if index < questions.count {
                let q = questions[index]
                Text("Question \(index + 1) of \(questions.count)")
                    .font(.system(size: 11, weight: .bold)).tracking(0.4)
                    .foregroundStyle(Color(hex: Brand.muted))
                Text(q.title)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.ink))
                Text(q.body)
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
                ForEach(q.choices, id: \.label) { c in
                    Button {
                        Task { await answer(c) }
                    } label: {
                        Text(c.label)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color(hex: Brand.pinkDeep))
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 10).padding(.horizontal, 12)
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12)
                                .stroke(Color(hex: Brand.line), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(saving)
                }
                Button("Skip — keep the default") { index += 1; errorText = nil }
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: Brand.muted))
                    .disabled(saving)
                if saving {
                    HStack(spacing: 6) {
                        ProgressView().tint(Color(hex: Brand.pink))
                        Text("Saving…").font(.system(size: 12)).foregroundStyle(Color(hex: Brand.muted))
                    }
                }
                if let e = errorText {
                    Text(e).font(.system(size: 12)).foregroundStyle(.red)
                }
            } else {
                Label("Board behavior saved — change any of these anytime under ⚙ Display settings.",
                      systemImage: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(hex: Brand.good))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 14))
        .task {
            // The child's slug comes back on the onboarding state — the flow
            // itself never stored it (each step posts server-side).
            if childId == nil, let st = try? await api.onboardingState() {
                childId = st.childId
            }
        }
    }

    private func answer(_ c: Choice) async {
        guard let id = childId, !id.isEmpty else {
            errorText = "Still connecting — give it a second and tap again."
            if let st = try? await api.onboardingState() { childId = st.childId }
            return
        }
        saving = true
        defer { saving = false }
        if await api.updateChildSettings(childId: id, patch: [c.key: c.value]) {
            index += 1
            errorText = nil
        } else {
            errorText = "Could not save — check the connection and tap again."
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

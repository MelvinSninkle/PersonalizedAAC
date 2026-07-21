import SwiftUI
import PhotosUI
import UIKit

/// The parent app home screen (PRD §4.1). A grid of clearly-labeled entry
/// points, each opening its own focused screen. Built for a parent out in the
/// world — a museum, a restaurant — who wants to act fast: every action is at
/// most one tap from here. Phone-first; the grid relaxes to more columns on
/// iPad via adaptive columns rather than separate layouts.
struct ParentHomeView: View {
    @Environment(AuthManager.self)  private var auth
    @Environment(BoardStore.self)   private var board
    @Environment(DeviceMode.self)   private var mode
    @Environment(AddTileQueue.self) private var addQueue
    @Environment(ParentLive.self)   private var parentLive

    @State private var showAddTile  = false
    @State private var showQuickBoard = false
    @State private var showSettings = false
    @State private var showFacilitator = false
    /// Board-build progress (server-side seed jobs still rendering).
    @State private var buildStatus: APIClient.SeedStatus?
    /// Live credit balance for the Credits & Store card's yellow badge —
    /// the parent always knows what they have before they spend.
    @State private var creditBalance: Int?
    /// Renders that failed every attempt — shown as an alert card with
    /// one-tap retry (word redraws: first free; failed photo adds: no charge).
    @State private var problems: [APIClient.ProblemEntry] = []
    @State private var problemBusy: Set<String> = []
    /// Support notices ("we've opened your board" / the team's response) —
    /// shown above everything else until "Got it" acks them server-side.
    @State private var supportNotices: [APIClient.SupportNotice] = []

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 14)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    brandedHeader

                    ForEach(supportNotices) { n in supportNoticeCard(n) }
                    if !problems.isEmpty { problemsCard }

                    LazyVGrid(columns: columns, spacing: 14) {
                        navCard(icon: "star.fill", tint: "#f59e0b",
                                title: "Credits & Store",
                                subtitle: "Credits, packs & the word shop",
                                badge: creditBalance.map { "⭐ \($0)" }) { StoreView() }

                        homeCard(icon: "camera.fill", tint: "#ff1493",
                                 title: "Add a tile",
                                 subtitle: "Snap it, it's on the board") { showAddTile = true }

                        navCard(icon: "text.bubble.fill", tint: "#3b82f6",
                                title: "Message the board",
                                subtitle: "Your words play as the child's tiles") { MessageBoardView() }

                        homeCard(icon: "square.grid.3x3.fill", tint: "#14b8a6",
                                 title: "Quick board",
                                 subtitle: "The child can talk on this device") { showQuickBoard = true }

                        // (The "Family & people" card is gone — everything it did
                        // is reachable from Add a tile's People flow. Its screen
                        // still backs the header's "Add your child" fallback.)
                        navCard(icon: "waveform.circle.fill", tint: "#ef4444",
                                title: "Listening mode",
                                subtitle: "Speech near the tablet becomes tiles") { ListeningModeView() }

                        navCard(icon: "gamecontroller.fill", tint: "#8b5cf6",
                                title: "Start a game",
                                subtitle: "Runs on the child's iPad") { StartGameView() }

                        navCard(icon: "chart.bar.fill", tint: "#10b981",
                                title: "Stats",
                                subtitle: "Progress & mastery") { StatsView() }

                        navCard(icon: "clock.fill", tint: "#f97316",
                                title: "Schedules",
                                subtitle: "Prompts & reminders") { SchedulesView() }

                        navCard(icon: "photo.on.rectangle.angled", tint: "#fb7185",
                                title: "Album",
                                subtitle: "Every picture, every year") { AlbumView() }

                        navCard(icon: "sparkles.rectangle.stack.fill", tint: "#06b6d4",
                                title: "Auto-teach",
                                subtitle: "Hands-off slideshow + daily game") { AutoTeachView() }
                    }

                    if addQueue.hasActiveJobs {
                        Label("Tiles are rendering. They'll land on the board on their own.",
                              systemImage: "hourglass")
                            .font(.footnote)
                            .foregroundStyle(Color(hex: "#9d174d"))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(Color(hex: "#fce4ec"), in: Capsule())
                    }

                    // Board build in progress (onboarding seed jobs) — the build
                    // is server-side; this is purely informational.
                    if let s = buildStatus, s.active {
                        let txt = s.render.done < s.render.total
                            ? "Making \(childPossessive(auth.user?.slug)) words… \(s.render.done) of \(s.render.total)"
                            : "Adding \(childPossessive(auth.user?.slug)) voice… \(s.voice.done) of \(s.voice.total)"
                        Label("\(txt). It keeps going even if you close the app.",
                              systemImage: "paintbrush.pointed.fill")
                            .font(.footnote)
                            .foregroundStyle(Color(hex: "#9d174d"))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(Color(hex: "#fce4ec"), in: Capsule())
                    }
                }
                .padding(16)
            }
            .background(Color(hex: "#fff7fb"))
            // The home screen owns its header (gear lives in the branded card),
            // so the empty navigation bar — and its dead space — goes away.
            // Pushed screens still show their own bars + back buttons.
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $showAddTile) {
                AddTileView { showAddTile = false }
            }
            .fullScreenCover(isPresented: $showQuickBoard) {
                QuickBoardView { showQuickBoard = false }
            }
            .sheet(isPresented: $showSettings) {
                ParentSettingsView()
            }
            .task {
                // Hydrate the board once so Quick Board / game scopes / message
                // previews have data without each screen re-syncing.
                await board.refresh(childId: auth.childSlug)
                // App-wide live poller — drives the auto-popping facilitator
                // overlay from anywhere in the parent app.
                parentLive.start(childId: auth.childSlug)
                // Real child name for the title + board-build progress banner.
                ChildNames.shared.refresh(auth.childSlug)
                creditBalance = try? await APIClient().storeBalance()
                problems = await APIClient().storeProblems(childId: auth.childSlug)
                supportNotices = await APIClient().storeSupportNotices(childId: auth.childSlug)
                await watchBuildProgress()
            }
            // PRD: when a facilitated game session starts on the iPad — from
            // here, from the child's tablet, from the web console, or from a
            // scheduled game nudge — the adult UI loads automatically over
            // whatever the parent is doing.
            .onChange(of: parentLive.isRunning) { _, running in
                showFacilitator = running
            }
            .fullScreenCover(isPresented: $showFacilitator) {
                FacilitatorView()
            }
        }
    }

    /// Poll seed progress while a board build is running (12s cadence, stops
    /// itself when the queue drains).
    private func watchBuildProgress() async {
        while !Task.isCancelled {
            let s = await APIClient().seedStatus(childId: auth.childSlug)
            buildStatus = s
            guard let s, s.active else { return }
            try? await Task.sleep(nanoseconds: 12_000_000_000)
        }
    }

    /// Branded header — one compact row: app icon, "My World: <child>", the
    /// Tap-to-Talk tagline, and the settings gear (which used to float in a
    /// mostly-empty navigation bar above — the bar is hidden now, so the grid
    /// starts higher). When no child is set up yet, a CTA appears instead of
    /// the name.
    /// 🛠/✅ Support notice: the team opened the board (with the family's
    /// permission — they filed the case) or sent their response. Persists
    /// until "Got it" acks it server-side; only the requesting account sees it.
    private func supportNoticeCard(_ n: APIClient.SupportNotice) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(n.kind == "response" ? "Your request is done" : "We’re on it",
                  systemImage: n.kind == "response" ? "checkmark.seal.fill" : "wrench.and.screwdriver.fill")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
            Text(n.text)
                .font(.system(size: 13))
                .foregroundStyle(Color(hex: "#374151"))
            HStack {
                Spacer()
                Button {
                    let id = n.id
                    supportNotices.removeAll { $0.id == id }
                    Task { await APIClient().storeSupportAck(childId: auth.childSlug, noticeId: id) }
                } label: {
                    Text("Got it")
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 16).padding(.vertical, 7)
                        .background(Color(hex: "#ad1457"), in: Capsule())
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: "#fdf2f8"), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
    }

    /// ⚠️ Pictures that failed every render attempt — the parent's alert with
    /// one-tap retry. Word tiles re-render (first retry per tile free, then
    /// credits — server-enforced); failed photo adds restart at no charge
    /// (they were paid at enqueue and never delivered).
    private var problemsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("\(problems.count) picture\(problems.count == 1 ? "" : "s") didn’t finish",
                  systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#b45309"))
            Text("The image maker hit a snag on these. Retrying is safe: failed photo adds never re-charge, and each word’s first redraw is free.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            ForEach(problems) { p in
                HStack {
                    Text(p.label)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                    Spacer()
                    Button {
                        Task { await retryProblem(p) }
                    } label: {
                        Text(problemBusy.contains(p.id) ? "Retrying…"
                             : p.kind == "add" ? "Try again (no charge)"
                             : (p.freeRetryUsed == true ? "Try again ⭐1" : "Try again (free)"))
                            .font(.system(size: 13, weight: .bold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Color(hex: "#b45309"), in: Capsule())
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .disabled(problemBusy.contains(p.id))
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: "#fef3c7"), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: "#f59e0b"), lineWidth: 1))
    }

    private func retryProblem(_ p: APIClient.ProblemEntry) async {
        problemBusy.insert(p.id)
        defer { problemBusy.remove(p.id) }
        let api = APIClient()
        var ok = false
        if p.kind == "add", let jobId = p.jobId {
            ok = await api.storeRearmAdd(childId: auth.childSlug, jobId: jobId)
        } else if let itemId = p.itemId {
            ok = (try? await api.storeRetry(childId: auth.childSlug, itemId: itemId)) != nil
        }
        if ok { problems.removeAll { $0.id == p.id } }   // retry re-arms the job → alert clears
    }

    private var brandedHeader: some View {
        let name = prettyChildName(auth.user?.slug)
        return VStack(spacing: 12) {
            HStack(spacing: 12) {
                Image("MyWorldLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 54, height: 54)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(color: .black.opacity(0.15), radius: 5, y: 2)
                VStack(alignment: .leading, spacing: 0) {
                    Text(name.isEmpty ? "My World" : "My World: \(name)")
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: "#ff1493"))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text("Tap to Talk")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color(hex: "#ad1457").opacity(0.8))
                }
                Spacer()
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 19))
                        .foregroundStyle(Color(hex: "#ff1493"))
                        .padding(10)
                        .background(Color.white.opacity(0.75), in: Circle())
                }
                .buttonStyle(.plain)
            }
            if name.isEmpty {
                NavigationLink { PeopleManagerView() } label: {
                    Label("Add your child", systemImage: "person.crop.circle.badge.plus")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color(hex: "#ff1493"), in: Capsule())
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: [Color(hex: "#fff0f6"), Color(hex: "#ffe4ef")],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 22)
        )
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
    }

    private func homeCard(icon: String, tint: String, title: String, subtitle: String,
                          action: @escaping () -> Void) -> some View {
        Button(action: action) { cardLabel(icon: icon, tint: tint, title: title, subtitle: subtitle) }
            .buttonStyle(.plain)
    }

    private func navCard<D: View>(icon: String, tint: String, title: String, subtitle: String,
                                  badge: String? = nil,
                                  @ViewBuilder destination: @escaping () -> D) -> some View {
        NavigationLink { destination() } label: { cardLabel(icon: icon, tint: tint, title: title, subtitle: subtitle, badge: badge) }
            .buttonStyle(.plain)
    }

    private func cardLabel(icon: String, tint: String, title: String, subtitle: String, badge: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 26))
                .foregroundStyle(Color(hex: tint))
            Text(title)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(.primary)
            Text(subtitle)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            if let badge {
                Text(badge)
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(hex: "#92400e"))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color(hex: "#fde68a"), in: Capsule())
                    .padding(8)
            }
        }
    }
}

/// Parent-side settings: vocabulary level (band + unlock), device mode switch,
/// account actions. The deep configuration (organize board, style guides…)
/// stays on the web dashboard by design.
struct ParentSettingsView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(DeviceMode.self)  private var mode
    @Environment(AccessPrefs.self) private var access
    @Environment(\.dismiss) private var dismiss

    @State private var band: APIClient.BandStatus?
    // Listening display filter (E8) — synced child settings, editable here
    // so a parent can flip them right on the device. Seeded in .task;
    // `listenLoaded` keeps the seed from firing the save onChange.
    @State private var listenCensor = true
    @State private var listenTilesOnly = false
    @State private var listenLoaded = false
    @State private var listenMsg: String?
    @State private var advancing = false
    @State private var advanceMsg: String?
    @State private var squaring = false
    @State private var squareMsg: String?
    @State private var showDeleteConfirm = false
    @State private var deleteText = ""
    @State private var deleting = false
    @State private var deleteError: String?
    @State private var showChangePw = false
    // Help & support: request-support / report-a-bug (consented board access).
    @State private var showSupport = false
    @State private var supportKind = "support"
    @State private var supportText = ""
    @State private var supportMsg: String?
    @State private var curPw = ""
    @State private var newPw = ""
    @State private var pwMsg: String?

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            Form {
                ArtStyleSection()

                Section("Vocabulary level") {
                    if let b = band {
                        LabeledContent("Showing", value: bandLabel(b.current))
                        if let next = b.next {
                            if let m = b.mastery, b.readyToAdvance == true {
                                Text("\(m.correct) of \(m.total) recent answers correct. Looks ready to grow.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Button(advancing ? "Unlocking…" : "Unlock \(bandLabel(next))") {
                                Task {
                                    advancing = true
                                    defer { advancing = false }
                                    do { try await api.advanceBand(childId: auth.childSlug); band = try? await api.bandStatus(childId: auth.childSlug); advanceMsg = "Unlocked." }
                                    catch { advanceMsg = "Could not unlock: \(error.localizedDescription)" }
                                }
                            }
                            .disabled(advancing)
                        } else {
                            Text("Top vocabulary band reached.").font(.footnote).foregroundStyle(.secondary)
                        }
                        if let msg = advanceMsg { Text(msg).font(.footnote).foregroundStyle(.secondary) }
                    } else {
                        Text("Loading…").foregroundStyle(.secondary)
                    }
                }
                Section("Listening") {
                    Toggle("Hide bad words", isOn: $listenCensor)
                        .onChange(of: listenCensor) { _, v in saveListen(["listenCensor": v]) }
                    Text("Curse words and slurs someone says nearby show as \u{201C}Bad Word\u{201D} in the listening bar instead of the word itself.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Toggle("Only show words with tiles", isOn: $listenTilesOnly)
                        .onChange(of: listenTilesOnly) { _, v in saveListen(["listenTilesOnly": v]) }
                    Text("Spoken words that aren't on the board don't appear at all.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let listenMsg { Text(listenMsg).font(.footnote).foregroundStyle(.red) }
                }
                // Admin-only rescue for older boards with stray aspect flags —
                // new boards are always square, so parents never need this.
                if auth.user?.role == "admin" {
                    Section("Board (admin)") {
                        Button {
                            Task {
                                squaring = true; defer { squaring = false }
                                do {
                                    let r = try await api.squareAllTiles(childId: auth.childSlug)
                                    squareMsg = "Squared \(r.squared) tile\(r.squared == 1 ? "" : "s")."
                                        + (r.posters > 0 ? " Kept \(r.posters) poster\(r.posters == 1 ? "" : "s")." : "")
                                } catch { squareMsg = "Couldn't update: \(error.localizedDescription)" }
                            }
                        } label: {
                            Label(squaring ? "Making tiles square…" : "Make all tiles square", systemImage: "square.dashed")
                        }
                        .disabled(squaring)
                        Text("Crops every tile to a square. Tiles in a folder named TV / Movies / Shows keep their poster shape.")
                            .font(.footnote).foregroundStyle(.secondary)
                        if let squareMsg { Text(squareMsg).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                Section("This device") {
                    Button {
                        mode.role = .childBoard
                        dismiss()
                    } label: {
                        Label("Use as the child's board", systemImage: "hand.tap.fill")
                    }
                    Link(destination: webDashboardURL) {
                        Label("Full dashboard on the web", systemImage: "safari")
                    }
                }
                Section("Help & support") {
                    // Filing a case IS the consent for the team to open and
                    // edit the board — the alert message spells that out.
                    Button("🛟 Request support…") { supportKind = "support"; supportText = ""; showSupport = true }
                    Button("🐛 Report a bug…") { supportKind = "bug"; supportText = ""; showSupport = true }
                    if let m = supportMsg {
                        Text(m).font(.footnote)
                            .foregroundStyle(m.hasPrefix("Sent") ? Color(hex: "#047857") : .secondary)
                    }
                }
                Section("Account") {
                    if let u = auth.user { LabeledContent("Email", value: u.email) }
                    // The password doubles as the board's edit-unlock gate, so
                    // changing it in-app matters — no detour to the website.
                    Button("Change password…") { pwMsg = nil; showChangePw = true }
                    if let m = pwMsg {
                        Text(m).font(.footnote)
                            .foregroundStyle(m.hasPrefix("Password updated") ? Color(hex: "#047857") : .red)
                    }
                    Button("Sign out", role: .destructive) {
                        Task { await auth.signOut(); dismiss() }
                    }
                    // Apple requires in-app account deletion (5.1.1(v)) since
                    // accounts are created in-app. Same endpoint as the web
                    // dashboard: removes the account and EVERYTHING with it.
                    Button("Delete account…", role: .destructive) { showDeleteConfirm = true }
                    if let msg = deleteError {
                        Text(msg).font(.footnote).foregroundStyle(.red)
                    }
                }
                Section {
                    HStack(spacing: 16) {
                        Link("Terms of Service", destination: URL(string: "\(APIClient.defaultOrigin)/terms")!)
                        Link("Privacy Policy", destination: URL(string: "\(APIClient.defaultOrigin)/privacy")!)
                    }
                    .font(.footnote)
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .task {
                band = try? await api.bandStatus(childId: auth.childSlug)
                let s = await api.childSettings(childId: auth.childSlug)
                listenCensor = (s["listenCensor"] as? Bool) ?? true
                listenTilesOnly = (s["listenTilesOnly"] as? Bool) ?? false
                listenLoaded = true
            }
            .alert("Change password", isPresented: $showChangePw) {
                SecureField("Current password", text: $curPw)
                SecureField("New password (8+ characters)", text: $newPw)
                Button("Cancel", role: .cancel) { curPw = ""; newPw = "" }
                Button("Save") { Task { await changePassword() } }
            } message: {
                Text("This password also unlocks board editing on the child's device.")
            }
            .alert(supportKind == "bug" ? "Report a bug" : "Request support", isPresented: $showSupport) {
                TextField(supportKind == "bug" ? "What went wrong?" : "What do you need help with?", text: $supportText)
                Button("Cancel", role: .cancel) { supportText = "" }
                Button("Send") { Task { await sendSupport() } }
            } message: {
                // Mirrors api/_lib/support.js CONFIRM_COPY — the disclosure IS the consent.
                Text("By sending, you give the My World team permission to open and edit your child's board to investigate and fix this. You'll get a notice here when we start, and another when we're done. Responses can take up to 48 hours.")
            }
            .alert("Delete this account?", isPresented: $showDeleteConfirm) {
                TextField("Type DELETE to confirm", text: $deleteText)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                Button("Cancel", role: .cancel) { deleteText = "" }
                Button("Delete everything", role: .destructive) {
                    Task { await deleteAccount() }
                }
            } message: {
                Text("Permanently deletes this account and everything on the board: every tile, photo, generated image, recording, and all history. This cannot be undone.")
            }
        }
    }

    private func sendSupport() async {
        let text = supportText.trimmingCharacters(in: .whitespacesAndNewlines)
        supportText = ""
        guard !text.isEmpty else { supportMsg = "Tell us a little about the problem first."; return }
        do {
            let r = try await api.storeSupportCreate(childId: auth.childSlug, kind: supportKind, message: text)
            supportMsg = r.note ?? "Sent! We'll get back to you within 48 hours."
        } catch let APIError.badStatus(_, body) {
            supportMsg = body.contains("too_many_open_cases")
                ? "You already have open requests. We'll get to them within 48 hours."
                : "Couldn't send. Check the connection and try again."
        } catch {
            supportMsg = "Couldn't send: \(error.localizedDescription)"
        }
    }

    private func changePassword() async {
        let cur = curPw, next = newPw
        curPw = ""; newPw = ""
        guard next.count >= 8 else { pwMsg = "New password must be at least 8 characters."; return }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["currentPassword": cur, "newPassword": next])
            _ = try await api.request(method: "POST", path: "/api/auth/change-password",
                                      body: body, contentType: "application/json")
            pwMsg = "Password updated."
        } catch let APIError.badStatus(_, bodyStr) {
            pwMsg = bodyStr.contains("incorrect") ? "Current password is incorrect."
                  : "Couldn't change it: \(String(bodyStr.prefix(100)))"
        } catch {
            pwMsg = "Couldn't change it: \(error.localizedDescription)"
        }
    }

    private func deleteAccount() async {
        guard deleteText.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE" else {
            deleteError = "Type DELETE (all caps) to confirm."
            deleteText = ""
            return
        }
        deleting = true
        defer { deleting = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["confirm": "DELETE"])
            _ = try await api.request(method: "POST", path: "/api/auth/delete-account",
                                      body: body, contentType: "application/json")
            await auth.signOut()
            dismiss()
        } catch {
            deleteError = "Couldn't delete: \(error.localizedDescription)"
        }
        deleteText = ""
    }

    /// Merge-write one listening toggle; on failure re-seed from the server
    /// so the switch snaps back to the truth instead of lying.
    private func saveListen(_ patch: [String: Any]) {
        guard listenLoaded else { return }
        Task {
            if await api.updateChildSettings(childId: auth.childSlug, patch: patch) {
                listenMsg = nil
                access.refresh()   // the board applies it without a relaunch
            } else {
                listenMsg = "Couldn't save. Check your connection."
                let s = await api.childSettings(childId: auth.childSlug)
                listenLoaded = false
                listenCensor = (s["listenCensor"] as? Bool) ?? true
                listenTilesOnly = (s["listenTilesOnly"] as? Bool) ?? false
                listenLoaded = true
            }
        }
    }

    private var webDashboardURL: URL {
        URL(string: "\(APIClient.defaultOrigin)/parent/\(auth.user?.slug ?? auth.childSlug)")!
    }
}

// MARK: -- Art style (parent settings section)

/// The parent-facing window into the art-style machine, native twin of the
/// web dashboard's style gallery (/api/parent/style): see the current style
/// and the EXACT reference images every picture is drawn from, switch to
/// another built-in style, or upload your own references. Every change warns
/// that tiles already on the board keep their current pictures — new art
/// follows the new style, so a switch means a mixed board until tiles are
/// remade (same copy as the web).
struct ArtStyleSection: View {
    @Environment(AuthManager.self) private var auth

    @State private var overview: APIClient.StyleOverview?
    @State private var loaded = false
    @State private var msg: String?
    @State private var switching = false
    // Own-reference upload: which slot, then the picked photo.
    @State private var uploadKind: String?          // "main" | "person" | "stuff"
    @State private var pendingUploadKind: String?   // confirmed, awaiting photo
    @State private var showPhotoPicker = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var uploading = false

    private let api = APIClient()

    var body: some View {
        Section {
            if let ov = overview {
                if let cur = ov.styleGuide {
                    LabeledContent("Current style") {
                        Text(cur.label + (cur.source == "family" ? " (your own)" : ""))
                    }
                    // The three references renders are drawn from.
                    HStack(spacing: 12) {
                        StyleRefThumb(title: "Style", path: cur.refs?.main)
                        StyleRefThumb(title: "Person", path: cur.refs?.person)
                        StyleRefThumb(title: "Objects", path: cur.refs?.stuff)
                    }
                } else {
                    Text("No style set yet. Pick one below.").foregroundStyle(.secondary)
                }
                if !ov.styles.isEmpty {
                    NavigationLink("Switch to another style…") {
                        // The confirm alert lives INSIDE the list: presenting
                        // an alert from here mid-pop can silently no-op
                        // (Andrew's "the switch didn't take"). onPick fires
                        // only AFTER the user confirmed.
                        StyleSwitcherList(styles: ov.styles,
                                          currentId: ov.styleGuide?.id,
                                          onPick: { s in Task { await confirmSwitch(to: s) } })
                    }
                }
                // Presentation modifiers (.alert / .photosPicker) MUST hang
                // off this concrete row, never the Section: a Form Section
                // isn't a stable presentation anchor, and the UIKit-backed
                // photo picker crashed the app when presented from one.
                Menu {
                    Button("Style scene (the overall look)") { pendingUploadKind = "main" }
                    Button("Person reference") { pendingUploadKind = "person" }
                    Button("Objects reference") { pendingUploadKind = "stuff" }
                } label: {
                    Label(uploading ? "Uploading…" : "Upload your own reference…",
                          systemImage: "photo.badge.plus")
                }
                .disabled(uploading)
                // Own-upload warning BEFORE the photo picker opens.
                .alert("Use your own reference?",
                       isPresented: Binding(get: { pendingUploadKind != nil },
                                            set: { if !$0 { pendingUploadKind = nil } })) {
                    Button("Cancel", role: .cancel) { pendingUploadKind = nil }
                    Button("Choose a photo") {
                        uploadKind = pendingUploadKind
                        pendingUploadKind = nil
                        // Let the alert finish dismissing before the picker
                        // presents — presenting during the dismissal is the
                        // other half of the crash.
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 300_000_000)
                            showPhotoPicker = true
                        }
                    }
                } message: {
                    Text("New pictures will be drawn to match it. Tiles already on the board don't change, so the board can look inconsistent until you remake them.")
                }
                .photosPicker(isPresented: $showPhotoPicker, selection: $libraryItem, matching: .images)
                .onChange(of: libraryItem) { _, item in
                    guard let item else { return }
                    Task { await uploadRef(item) }
                }
                if let msg { Text(msg).font(.footnote).foregroundStyle(.secondary) }
            } else {
                Text(loaded ? "Couldn't load styles. Check your connection." : "Loading…")
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Art style")
        } footer: {
            Text("Every generated picture is drawn while looking at these references. Changes apply to NEW pictures only. Tiles already on the board keep their current art.")
        }
        .task { await load() }
    }

    private func load() async {
        overview = await api.styleOverview(childId: auth.childSlug)
        loaded = true
    }

    private func confirmSwitch(to pick: APIClient.StyleGuideInfo) async {
        switching = true
        defer { switching = false }
        msg = "Switching to \u{201C}\(pick.label)\u{201D}…"
        if await api.setStyle(childId: auth.childSlug, styleGuideId: pick.id) {
            msg = "Style switched. New pictures use \u{201C}\(pick.label)\u{201D} from now on."
            await load()
        } else {
            msg = "Couldn't switch to \u{201C}\(pick.label)\u{201D}. Check your connection and try again."
        }
    }

    private func uploadRef(_ item: PhotosPickerItem) async {
        let kind = uploadKind ?? "main"
        libraryItem = nil
        uploadKind = nil
        uploading = true
        defer { uploading = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                msg = "Couldn't read that photo."; return
            }
            let key = try await api.uploadBlob(data, kind: "styleref", ext: "jpg",
                                               contentType: "image/jpeg")
            if await api.setStyleRef(childId: auth.childSlug, kind: kind, blobKey: key) {
                msg = "Reference saved. New pictures follow it from now on."
                await load()
            } else {
                msg = "Couldn't save the reference. Check your connection."
            }
        } catch {
            msg = "Upload failed: \(error.localizedDescription)"
        }
    }
}

/// One labeled reference thumbnail, fetched through the authenticated
/// /api/parent/style?image= stream (never a raw blob URL).
struct StyleRefThumb: View {
    let title: String
    let path: String?
    @State private var image: UIImage?

    var body: some View {
        VStack(spacing: 4) {
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(hex: "#fce4ec"))
                        .overlay(Text(path == nil ? "—" : "…")
                            .font(.caption).foregroundStyle(.secondary))
                }
            }
            .frame(width: 72, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }
        .task(id: path) {
            image = nil
            guard let path else { return }
            if let data = await APIClient().imageData(path: path) {
                image = UIImage(data: data)
            }
        }
    }
}

/// The template picker — every public style with its polished preview.
/// The mixed-styles confirm alert is presented HERE (not by the parent
/// screen): presenting from a view that's mid-navigation-pop can silently
/// drop the alert, which read as "the switch didn't take". onPick fires
/// only after the user confirms; then the list dismisses itself.
struct StyleSwitcherList: View {
    let styles: [APIClient.StyleGuideInfo]
    let currentId: Int?
    let onPick: (APIClient.StyleGuideInfo) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pending: APIClient.StyleGuideInfo?

    var body: some View {
        List(styles, id: \.id) { s in
            Button {
                guard s.id != currentId else { return }
                pending = s
            } label: {
                HStack(spacing: 12) {
                    StyleRefThumb(title: "", path: s.previewUrl ?? s.refs?.main)
                        .frame(width: 56)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.label).foregroundStyle(.primary)
                        if let d = s.description, !d.isEmpty {
                            Text(d).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer()
                    if s.id == currentId {
                        Image(systemName: "checkmark").foregroundStyle(.tint)
                    }
                }
            }
        }
        .navigationTitle("Built-in styles")
        .navigationBarTitleDisplayMode(.inline)
        // The web dashboard's exact warning copy.
        .alert("Draw new pictures in \u{201C}\(pending?.label ?? "")\u{201D}?",
               isPresented: Binding(get: { pending != nil },
                                    set: { if !$0 { pending = nil } })) {
            Button("Cancel", role: .cancel) { pending = nil }
            Button("Switch style") {
                if let p = pending { pending = nil; onPick(p); dismiss() }
            }
        } message: {
            Text("Tiles already on the board keep their current pictures. The board will mix styles until you remake them from each tile's editor. New pictures use the new style right away.")
        }
    }
}

// MARK: -- Family & people

/// Parent-accessible manager for the reference people whose faces anchor the
/// tiles about them — the child (self), family, caregivers, the new doctor. The
/// child + first grown-up are captured at signup; this is where you add the rest
/// or replace a photo anytime. Adding a person runs the durable server pipeline
/// (section=people), which renders a style-consistent portrait, registers the
/// person, and drops their tile on the board.
///
/// Lives in this already-tracked file so it builds without re-running xcodegen.
struct PeopleManagerView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(BoardStore.self)  private var board

    @State private var persons: [APIClient.Person] = []
    @State private var loading = true
    @State private var editing: PersonDraft?
    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Text("These faces anchor every tile about each person: feelings, actions, body parts, social phrases. Add a clear head-and-shoulders photo of each one.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)

                if loading {
                    ProgressView().padding(.top, 20)
                } else {
                    // No child registered yet (interrupted onboarding) — the
                    // home header's "Add your child" CTA lands here, so give it
                    // a dedicated button that creates the is_self person.
                    if !persons.contains(where: { $0.isSelf }) {
                        Button {
                            var d = PersonDraft()
                            d.isSelf = true
                            editing = d
                        } label: {
                            Label("Add your child", systemImage: "figure.child")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(Color(hex: "#ad1457")).foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                    }
                    ForEach(persons) { p in
                        Button { editing = PersonDraft(p) } label: { personRow(p) }
                            .buttonStyle(.plain)
                    }
                }

                Button { editing = PersonDraft() } label: {
                    Label("Add a person", systemImage: "person.crop.circle.badge.plus")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color(hex: "#ff1493")).foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
            .padding(16)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle("Family & people")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { draft in
            PersonEditorSheet(draft: draft, childId: auth.childSlug) {
                editing = nil
                // Refresh the cached child name too — the home header shows
                // "My World: <name>" the moment the child is registered.
                ChildNames.shared.refresh(auth.childSlug)
                Task { await load(); await board.refresh(childId: auth.childSlug) }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func personRow(_ p: APIClient.Person) -> some View {
        HStack(spacing: 14) {
            Group {
                if let key = p.referenceKey, !key.isEmpty {
                    MediaImage(blobKey: key)
                } else {
                    Color(hex: "#fce4ec").overlay(
                        Image(systemName: "person.fill").foregroundStyle(Color(hex: "#ec4899")))
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color(hex: "#f3c6da"), lineWidth: 1))

            VStack(alignment: .leading, spacing: 2) {
                Text(p.displayName)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(.primary)
                Text(p.isSelf ? "The child" : relationshipLabel(p.relationship))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
            if p.referenceKey == nil {
                Text("No photo").font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(hex: "#b91c6b"))
            }
            Image(systemName: "chevron.right").font(.system(size: 13)).foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(.white, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6da"), lineWidth: 1))
    }

    private func load() async {
        loading = true; defer { loading = false }
        if let result = try? await api.listPersons(childId: auth.childSlug) { persons = result }
    }
}

/// Editable draft for the add/edit sheet. Identifiable so it drives `.sheet(item:)`.
struct PersonDraft: Identifiable {
    let id = UUID()
    var personId: Int?
    var name: String = ""
    var relationship: String = "mother"
    var isSelf: Bool = false
    var referenceKey: String?
    init() {}
    init(_ p: APIClient.Person) {
        personId = p.id; name = p.displayName; relationship = p.relationship
        isSelf = p.isSelf; referenceKey = p.referenceKey
    }
}

/// Add or edit one person: name, relationship, and a photo that becomes their
/// style-consistent portrait + tile via the durable pipeline.
private struct PersonEditorSheet: View {
    let draft: PersonDraft
    let childId: String
    let onDone: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(BoardStore.self) private var board

    @State private var name: String
    @State private var relationship: String
    @State private var capturedJPEG: Data?
    /// Keep the exact photo instead of drawing the portrait in the board's
    /// art style. Default OFF (restyle) — matching the board is the norm;
    /// free tier is locked ON (styling is a membership perk; as-is is free).
    @State private var useAsIs = false
    @State private var confirmPortrait = false
    @State private var showCamera = false
    @State private var showLibrary = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var saving = false
    @State private var errorText: String?

    private let api = APIClient()
    // Curated subset of the canonical relationship taxonomy (server-validated).
    private let options: [(String, String)] = [
        ("mother", "Mother"), ("father", "Father"), ("sister", "Sister"), ("brother", "Brother"),
        ("grandmother", "Grandmother"), ("grandfather", "Grandfather"), ("aunt", "Aunt"), ("uncle", "Uncle"),
        ("stepmother", "Stepmother"), ("stepfather", "Stepfather"), ("guardian", "Guardian"),
        ("family_friend", "Family friend"), ("caregiver", "Caregiver"), ("other", "Other"),
    ]

    init(draft: PersonDraft, childId: String, onDone: @escaping () -> Void) {
        self.draft = draft; self.childId = childId; self.onDone = onDone
        _name = State(initialValue: draft.name)
        _relationship = State(initialValue: draft.isSelf ? "self" : draft.relationship)
    }

    private var isNew: Bool { draft.personId == nil }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#fff7fb").ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        photoCard
                        field("Name")
                        TextField("e.g. Grandma Jane, Dr. Lee", text: $name)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()

                        if !draft.isSelf {
                            field("Relationship")
                            Picker("Relationship", selection: $relationship) {
                                ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
                            }
                            .pickerStyle(.menu)
                            .tint(Color(hex: "#ad1457"))
                        }

                        if let errorText {
                            Text(errorText).font(.system(size: 14)).foregroundStyle(.red)
                        }

                        if !isNew {
                            Button(role: .destructive) { Task { await deletePerson() } } label: {
                                Label("Remove this person", systemImage: "trash")
                                    .font(.system(size: 15, weight: .semibold))
                                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                                    .background(Color.red.opacity(0.1)).foregroundStyle(.red)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain).padding(.top, 6)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle(isNew ? "Add a person" : "Edit person")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    if saving { ProgressView() }
                    else {
                        Button("Save") {
                            // Confirm-before-spend: a styled family portrait
                            // is the ⭐5 keystone render; as-is stays free.
                            if capturedJPEG != nil && !useAsIs { confirmPortrait = true }
                            else { Task { await save() } }
                        }
                        .font(.system(size: 16, weight: .bold))
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty
                                  || (isNew && capturedJPEG == nil))
                    }
                }
            }
            .alert("Use ⭐5?", isPresented: $confirmPortrait) {
                Button("OK") { Task { await save() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("A family portrait drawn in the board's style uses ⭐5 (our best likeness model). \u{201C}Use my photo as-is\u{201D} is free.")
            }
            // fullScreenCover, NOT sheet: an iPad form-sheet camera renders a
            // black preview (see CameraPicker's header comment).
            .fullScreenCover(isPresented: $showCamera) {
                CameraCapture { data in
                    showCamera = false
                    if let data { capturedJPEG = data }
                }
                .ignoresSafeArea()
            }
            .photosPicker(isPresented: $showLibrary, selection: $libraryItem, matching: .images)
            .onChange(of: libraryItem) { _, item in
                guard let item else { return }
                Task {
                    if let raw = try? await item.loadTransferable(type: Data.self),
                       let jpeg = downscaleJPEG(raw, maxDim: 1024, quality: 0.85) { capturedJPEG = jpeg }
                    libraryItem = nil
                }
            }
        }
    }

    private var photoCard: some View {
        VStack(spacing: 10) {
            ZStack {
                if let data = capturedJPEG, let img = UIImage(data: data) {
                    Image(uiImage: img).resizable().scaledToFill()
                } else if let key = draft.referenceKey, !key.isEmpty {
                    MediaImage(blobKey: key)
                } else {
                    Color(hex: "#fce4ec").overlay(
                        Image(systemName: "person.fill").font(.system(size: 40)).foregroundStyle(Color(hex: "#ec4899")))
                }
            }
            .frame(width: 140, height: 140)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color(hex: "#f3c6da"), lineWidth: 2))

            HStack(spacing: 10) {
                Button { showCamera = true } label: { photoBtn("Take photo", "camera.fill") }.buttonStyle(.plain)
                Button { showLibrary = true } label: { photoBtn("Choose photo", "photo.on.rectangle") }.buttonStyle(.plain)
            }
            Text(isNew ? "A clear head-and-shoulders photo works best. Only upload someone who's given you permission. It's used solely to draw their tile."
                       : "Pick a new photo to replace their portrait, or leave it.")
                .font(.system(size: 12)).foregroundStyle(.secondary)

            // The same keep-vs-restyle ask every image add gets. Default =
            // drawn in the board's art style so the person matches the board.
            if capturedJPEG != nil {
                Toggle(isOn: $useAsIs) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Use my photo as-is")
                            .font(.system(size: 14, weight: .semibold))
                        Text(useAsIs ? "The photo itself becomes the tile. Free."
                                     : "Drawn as a portrait in the board's art style, ⭐5.")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                }
                .tint(Color(hex: "#ff1493"))
                .disabled(!board.stylingAllowed)
                if !board.stylingAllowed {
                    Text("Styled portraits are part of My World memberships. The exact photo (free) is used on the free plan.")
                        .font(.system(size: 11)).foregroundStyle(Color(hex: "#ad1457"))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .task { if !board.stylingAllowed { useAsIs = true } }
    }

    private func photoBtn(_ text: String, _ icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.system(size: 14, weight: .semibold))
            .padding(.horizontal, 14).padding(.vertical, 9)
            .foregroundStyle(Color(hex: "#ad1457"))
            .background(Color(hex: "#fce4ef"), in: Capsule())
    }

    private func field(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .bold)).foregroundStyle(Color(hex: "#999"))
    }

    @MainActor
    private func save() async {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        saving = true; errorText = nil
        defer { saving = false }
        do {
            // 1) Structured fields first so the person exists immediately.
            _ = try await api.upsertPerson(id: draft.personId, displayName: trimmed,
                                           relationship: draft.isSelf ? "self" : relationship,
                                           childId: childId)
            // 2) New photo → durable pipeline renders the portrait, registers the
            //    person's reference, and drops/updates their People tile. No
            //    model is sent on purpose: the server routes people through the
            //    SAME keystone-portrait pipeline as the Portrait Lab (style
            //    guide attached, likeness prompt, best likeness model).
            //    "Use my photo as-is" rides the raw path — no restyle, free.
            if let jpeg = capturedJPEG {
                _ = try await api.createTileJob(
                    photoJPEG: jpeg, label: trimmed, detail: "", section: "people",
                    categoryId: nil, style: ArtStyle.soft.prompt, styleGuideId: nil,
                    model: "", bg: "pink", keepAspect: false,
                    needsReview: false, emotion: "default", childId: childId,
                    relationship: draft.isSelf ? nil : relationship,
                    raw: useAsIs)
            }
            dismiss(); onDone()
        } catch {
            errorText = friendly(error)
        }
    }

    @MainActor
    private func deletePerson() async {
        guard let id = draft.personId else { return }
        saving = true; defer { saving = false }
        await api.deletePerson(id: id, childId: childId)
        dismiss(); onDone()
    }

    private func friendly(_ error: Error) -> String {
        if let api = error as? APIError {
            switch api {
            case .badStatus(let status, let body):
                if status == 402 || body.contains("not_enough_credits") {
                    return "You're out of image credits. Open Credits & Store below to add more."
                }
                return body.isEmpty ? "Server error." : String(body.prefix(160))
            case .notAuthenticated: return "Signed out. Log in and try again."
            case .transport(let e): return "Network problem: \(e.localizedDescription)"
            case .invalidResponse:  return "Unexpected server response."
            case .decoding:         return "Couldn't read the server's response."
            }
        }
        return error.localizedDescription
    }
}

/// Display label for a stored relationship value (mirrors the server taxonomy).
func relationshipLabel(_ value: String) -> String {
    switch value {
    case "mother": return "Mother";           case "father": return "Father"
    case "sister": return "Sister";           case "brother": return "Brother"
    case "grandmother": return "Grandmother"; case "grandfather": return "Grandfather"
    case "aunt": return "Aunt";               case "uncle": return "Uncle"
    case "cousin": return "Cousin"
    case "stepmother": return "Stepmother";   case "stepfather": return "Stepfather"
    case "guardian": return "Guardian";       case "family_friend": return "Family friend"
    case "caregiver": return "Caregiver";     case "pet": return "Pet"
    case "self": return "The child"
    default: return value.isEmpty ? "Other" : value.capitalized
    }
}

/// Human label for an acquisition-age band id. Shared by settings + stats.
func bandLabel(_ band: String?) -> String {
    switch band {
    case "12-18m": return "12–18 months · first words"
    case "18-30m": return "18–30 months · vocabulary burst"
    case "2-3y":   return "2–3 years · sentences"
    case "3-4y":   return "3–4 years · grammar"
    case "4y+":    return "4 years and up"
    default:        return "every band"
    }
}

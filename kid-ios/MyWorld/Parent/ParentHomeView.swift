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

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 14)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    brandedHeader

                    LazyVGrid(columns: columns, spacing: 14) {
                        navCard(icon: "star.fill", tint: "#f59e0b",
                                title: "Credits & Store",
                                subtitle: "Credits, packs & the word shop") { StoreView() }

                        homeCard(icon: "camera.fill", tint: "#ff1493",
                                 title: "Add a tile",
                                 subtitle: "Snap it, it's on the board") { showAddTile = true }

                        navCard(icon: "text.bubble.fill", tint: "#3b82f6",
                                title: "Message the board",
                                subtitle: "Type it — or turn on listening") { MessageBoardView() }

                        homeCard(icon: "square.grid.3x3.fill", tint: "#14b8a6",
                                 title: "Quick board",
                                 subtitle: "The child can talk on this device") { showQuickBoard = true }

                        navCard(icon: "person.2.crop.square.stack.fill", tint: "#a855f7",
                                title: "Family & people",
                                subtitle: "Faces that anchor their tiles") { PeopleManagerView() }

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
                        Label("Tiles are rendering — they'll land on the board on their own.",
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
                        Label("\(txt) — keeps going even if you close the app.",
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
                                  @ViewBuilder destination: @escaping () -> D) -> some View {
        NavigationLink { destination() } label: { cardLabel(icon: icon, tint: tint, title: title, subtitle: subtitle) }
            .buttonStyle(.plain)
    }

    private func cardLabel(icon: String, tint: String, title: String, subtitle: String) -> some View {
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
    }
}

/// Parent-side settings: vocabulary level (band + unlock), device mode switch,
/// account actions. The deep configuration (organize board, style guides…)
/// stays on the web dashboard by design.
struct ParentSettingsView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(DeviceMode.self)  private var mode
    @Environment(\.dismiss) private var dismiss

    @State private var band: APIClient.BandStatus?
    @State private var advancing = false
    @State private var advanceMsg: String?
    @State private var squaring = false
    @State private var squareMsg: String?

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            Form {
                Section("Vocabulary level") {
                    if let b = band {
                        LabeledContent("Showing", value: bandLabel(b.current))
                        if let next = b.next {
                            if let m = b.mastery, b.readyToAdvance == true {
                                Text("\(m.correct) of \(m.total) recent answers correct — looks ready to grow.")
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
                Section("Account") {
                    if let u = auth.user { LabeledContent("Email", value: u.email) }
                    Button("Sign out", role: .destructive) {
                        Task { await auth.signOut(); dismiss() }
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .task { band = try? await api.bandStatus(childId: auth.childSlug) }
        }
    }

    private var webDashboardURL: URL {
        URL(string: "\(APIClient.defaultOrigin)/parent/\(auth.user?.slug ?? auth.childSlug)")!
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
                Text("These faces anchor every tile about each person — feelings, actions, body parts, social phrases. Add a clear head-and-shoulders photo of each one.")
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

    @State private var name: String
    @State private var relationship: String
    @State private var capturedJPEG: Data?
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
                        Button("Save") { Task { await save() } }
                            .font(.system(size: 16, weight: .bold))
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty
                                      || (isNew && capturedJPEG == nil))
                    }
                }
            }
            .sheet(isPresented: $showCamera) {
                CameraPicker { data in
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
            Text(isNew ? "A clear head-and-shoulders photo works best."
                       : "Pick a new photo to replace their portrait, or leave it.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
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
            //    person's reference, and drops/updates their People tile.
            if let jpeg = capturedJPEG {
                _ = try await api.createTileJob(
                    photoJPEG: jpeg, label: trimmed, detail: "", section: "people",
                    categoryId: nil, style: ArtStyle.soft.prompt, styleGuideId: nil,
                    model: ImageModel.nanoBanana.apiValue, bg: "pink", keepAspect: false,
                    needsReview: false, emotion: "default", childId: childId,
                    relationship: draft.isSelf ? nil : relationship)
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
                    return "You're out of image credits — open Credits & Store below to add more."
                }
                return body.isEmpty ? "Server error." : String(body.prefix(160))
            case .notAuthenticated: return "Signed out — log in and try again."
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

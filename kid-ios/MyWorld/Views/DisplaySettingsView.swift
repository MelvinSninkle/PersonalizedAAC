import SwiftUI

/// "⚙ Display" modal — mirrors the web app's Display Settings panel, in the
/// same canonical themed order every surface shares (most common first):
/// Board look → Board tools → Touch & play → Listening → Safety & unlock.
/// Board-look edits go through @Observable bindings so changes are live and
/// persist via DisplayPrefs.save() (UserDefaults + synced kidDisplay); the
/// themed toggles below are ROOT child-settings keys, merge-written the same
/// way ParentSettingsView saves listening (updateChildSettings + refresh()).
struct DisplaySettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(BoardStore.self) private var board
    @Environment(AuthManager.self) private var auth
    @Environment(AccessPrefs.self) private var access
    @Environment(DeviceMode.self) private var mode

    @State private var refreshing = false

    // Synced root-key toggles — seeded in .task; `syncedLoaded` keeps the
    // seed from firing the save onChange (the ParentSettingsView pattern).
    @State private var toolListen = true
    @State private var toolTeach = true
    @State private var toolPlay = true
    @State private var toolSentence = true
    @State private var sentenceDrag = false
    @State private var tapInterrupt = false
    @State private var doubleTapTeach = false
    @State private var teachTapSec = 2.0     // tap-to-learn rapid-tap window
    @State private var listenCensor = true
    @State private var listenTilesOnly = false
    @State private var repeatCount = 2       // #12: 0 off / 2 / 3 in a row
    @State private var suggestListening = false   // #10 consent (off by default)
    @State private var easyClose = false
    @State private var exitHoldSec = 1.2     // ✕ hold length when easyClose off
    @State private var easyUnlock = false
    @State private var syncedLoaded = false
    @State private var syncedMsg: String?
    @State private var syncedMsgIsError = false
    /// True when the seed came from the on-device cache with no server reach —
    /// the toggles still work; flips queue and sync when the network returns.
    @State private var offlineSeed = false
    /// #B: the onboarding setup questions, launchable for existing accounts.
    @State private var showWizard = false
    // easyUnlock enable = re-type the account password first (E6b, exactly
    // like the web Display modal). Turning it OFF is friction-free.
    @State private var confirmEasyUnlock = false
    @State private var unlockPassword = ""
    // The last server-confirmed easyUnlock value. onChange only reacts when
    // the toggle DIFFERS from this, which makes seeding, snap-backs, and the
    // confirmed enable all inert without a consumable suppress flag. (The old
    // one-shot suppressUnlockChange flag raced the async seed: opening the
    // panel with easyUnlock ON re-fired onChange after syncedLoaded was
    // already true, snapping the switch off and popping the password dialog —
    // and desyncing the switch from the server so the gate couldn't be
    // re-enabled.)
    @State private var serverEasyUnlock = false
    // Sign-out is disruptive on the child's device (the board goes away until
    // a parent signs back in) — always confirm.
    @State private var confirmSignOut = false
    // #17 quick-unlock PIN management (per-device; see QuickPin).
    @State private var pinIsSet = QuickPin.isSet
    @State private var showPinSheet = false
    @State private var pinRemoveMode = false

    private let columnChoices = [1, 2, 3, 4, 5, 6, 7, 8]
    private let api = APIClient()

    var body: some View {
        @Bindable var prefs = prefs
        NavigationStack {
            Form {
                Section {
                    Button {
                        Task {
                            refreshing = true
                            await board.refresh(childId: auth.childSlug)
                            prefs.reloadFromServer()
                            refreshing = false
                        }
                    } label: {
                        HStack {
                            Image(systemName: refreshing ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                            Text(refreshing ? "Refreshing…" : "Refresh board")
                        }
                    }
                    .disabled(refreshing)
                } footer: {
                    Text("Pull the latest tiles, categories, and settings after you make changes in the parent dashboard.")
                }

                // Grouped drill-down — the SAME structure as the parent app's
                // settings (owner's call): a short top level pushing detail
                // screens, plain labels.
                Section {
                    NavigationLink("Board look") { lookGroup }
                    NavigationLink("Tools & touch") { toolsGroup }
                    NavigationLink("Listening") { listenGroup }
                    NavigationLink("Safety & unlock") { safetyGroup }
                    NavigationLink("Device & account") { deviceGroup }
                } footer: {
                    Text("Board look is saved on this device. Everything else follows your child on every device this board is used on."
                         + (offlineSeed ? "\n\nYou're offline right now — changes still work, save on this device, and sync when the connection returns." : ""))
                }

                // The five onboarding setup questions stay at the top level —
                // a single discoverable action, not a settings category.
                Section {
                    Button {
                        showWizard = true
                    } label: {
                        Label("Run the 5 setup questions", systemImage: "wand.and.stars")
                    }
                } header: {
                    Text("Set up the board together")
                } footer: {
                    Text("The same five questions new families answer during onboarding — learning taps, interruptions, the sentence builder, listening, and the close button. Answers save as you go; everything stays changeable right here.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.bold()
                }
            }
            .task { await seedSynced() }
            .sheet(isPresented: $showWizard, onDismiss: {
                // The wizard saved real keys — re-seed so the toggles agree,
                // and let the live board apply them without a relaunch.
                Task { syncedLoaded = false; await seedSynced(); access.refresh() }
            }) {
                NavigationStack {
                    ScrollView {
                        OBSettingsWizard(childName: "", standalone: true, childId: auth.childSlug)
                            .padding()
                    }
                    .navigationTitle("Setup questions")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { showWizard = false }.bold()
                        }
                    }
                }
            }
        }
    }

    // ── Board look (per-device + follows via kidDisplay) ────────────────────
    private var lookGroup: some View {
        @Bindable var prefs = prefs
        return Form {
            Section("Labels") {
                Toggle("Hide all labels", isOn: $prefs.hideLabels)
            }
            Section("Tiles across") {
                Stepper("People: \(prefs.acrossPeople)", value: $prefs.acrossPeople, in: 1...8)
                Stepper("Nouns: \(prefs.acrossNouns)",   value: $prefs.acrossNouns,  in: 1...8)
                Stepper("Verbs: \(prefs.acrossVerbs)",   value: $prefs.acrossVerbs,  in: 1...8)
            }
            Section("Show sections") {
                Toggle("People",            isOn: $prefs.showPeople)
                Toggle("Nouns",             isOn: $prefs.showNouns)
                Toggle("Verbs",             isOn: $prefs.showVerbs)
                Toggle("Needs (bottom row)", isOn: $prefs.showNeeds)
            }
            Section("Section colors") {
                ColorRow(label: "People", hex: $prefs.colorPeople)
                ColorRow(label: "Nouns",  hex: $prefs.colorNouns)
                ColorRow(label: "Verbs",  hex: $prefs.colorVerbs)
                ColorRow(label: "Needs",  hex: $prefs.colorNeeds)
            }
            // #15: per-device low-vision enlargement (screen sizes differ,
            // so this deliberately does NOT sync — same as the web board).
            Section {
                Picker("Listening tiles", selection: $prefs.listenTileSize) {
                    Text("Normal").tag(0)
                    Text("Bigger (+50%)").tag(1)
                    Text("Biggest (+100%)").tag(2)
                }
                Picker("Top-row buttons", selection: $prefs.topButtonSize) {
                    Text("Normal").tag(0)
                    Text("Bigger (+50%)").tag(1)
                    Text("Biggest (+100%)").tag(2)
                }
            } header: {
                Text("Bigger sizes (low vision)")
            } footer: {
                Text("Make the listening word strip or the header buttons easier to see and tap. Saved on this device only.")
            }
            Section("Header colors") {
                ColorRow(label: "Background", hex: $prefs.colorHeaderBg)
                ColorRow(label: "Text",       hex: $prefs.colorHeaderText)
            }
            Section {
                Button("Reset look to defaults") { prefs.resetToDefaults() }
            }
        }
        .navigationTitle("Board look")
        .navigationBarTitleDisplayMode(.inline)
    }

    // ── Tools & touch (synced) ──────────────────────────────────────────────
    private var toolsGroup: some View {
        Form {
            Section {
                Toggle("🎙 Listening (live word strip)", isOn: $toolListen)
                    .onChange(of: toolListen) { _, v in saveSynced(["toolListen": v]) }
                Toggle("📖 Teach (word slideshows)", isOn: $toolTeach)
                    .onChange(of: toolTeach) { _, v in saveSynced(["toolTeach": v]) }
                Toggle("🙋 Play (find-the-word game)", isOn: $toolPlay)
                    .onChange(of: toolPlay) { _, v in saveSynced(["toolPlay": v]) }
                Toggle("✏️ Sentence mode", isOn: $toolSentence)
                    .onChange(of: toolSentence) { _, v in saveSynced(["toolSentence": v]) }
                // Drag staging (#13/#34): natural pick-up-and-drop onto the
                // top bar, alongside the pencil's tap-to-add. Only shown
                // when the sentence constructor itself is enabled for this
                // board (it's the thing being staged into).
                if access.sentenceBuilder {
                    Toggle("👆 Sentence drag: pick up a tile and drop it on the top bar", isOn: $sentenceDrag)
                        .onChange(of: sentenceDrag) { _, v in saveSynced(["sentenceDrag": v]) }
                    Text("The natural gesture for kids who can do it. Tap-to-add with the ✏️ pencil always keeps working, and a light touch still scrolls.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } header: {
                HStack(spacing: 6) {
                    Text("Board tools")
                    if !syncedLoaded { ProgressView().controlSize(.mini) }
                }
            } footer: {
                Text("Which buttons show in the board's header. These follow your child: they apply on every device this board is used on.")
            }
            Section {
                Toggle("New taps interrupt the word", isOn: $tapInterrupt)
                    .onChange(of: tapInterrupt) { _, v in saveSynced(["tapInterrupt": v]) }
                Text("Off: each word finishes before the next tap counts, steadier for new talkers.")
                    .font(.footnote).foregroundStyle(.secondary)
                Toggle("Tap again to learn", isOn: $doubleTapTeach)
                    .onChange(of: doubleTapTeach) { _, v in saveSynced(["doubleTapTeach": v]) }
                Text("Tap a tile: hear the word. Tap again quickly: hear a fact, up to three facts on back-to-back taps, then the word again.")
                    .font(.footnote).foregroundStyle(.secondary)
                if doubleTapTeach {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("How quick “again” has to be: \(String(format: "%.1f", teachTapSec))s")
                            .font(.footnote)
                        Slider(value: $teachTapSec, in: 0.5...5.0, step: 0.25) { editing in
                            if !editing { saveSynced(["teachTapMs": Int(teachTapSec * 1000)]) }
                        }
                    }
                }
            } header: {
                Text("Touch & play")
            }
        }
        // Cache-first seed keeps this instant and offline-capable; disabled
        // only on a first-ever open with no network AND no cache.
        .disabled(!syncedLoaded)
        .navigationTitle("Tools & touch")
        .navigationBarTitleDisplayMode(.inline)
    }

    // ── Listening (synced, E8) ──────────────────────────────────────────────
    private var listenGroup: some View {
        Form {
            Section {
                Toggle("Hide bad words", isOn: $listenCensor)
                    .onChange(of: listenCensor) { _, v in saveSynced(["listenCensor": v]) }
                Toggle("Only show words with tiles", isOn: $listenTilesOnly)
                    .onChange(of: listenTilesOnly) { _, v in saveSynced(["listenTilesOnly": v]) }
                // #12: hearing a word N times in a row jumps to its tile.
                Picker("Say a word twice to jump to its tile", selection: $repeatCount) {
                    Text("Off").tag(0)
                    Text("Twice in a row").tag(2)
                    Text("3 times in a row").tag(3)
                }
                .onChange(of: repeatCount) { _, n in
                    guard [0, 2, 3].contains(n) else { return }
                    saveSynced(["listenRepeatCount": n, "listenRepeatNav": n > 0])
                }
                // #10: opt-in consent for the suggestion queue. Matched
                // words only (name + count), never audio or transcripts.
                Toggle("Suggest words your family says", isOn: $suggestListening)
                    .onChange(of: suggestListening) { _, v in saveSynced(["suggestFromListening": v]) }
                Text("While listening runs, words your family says that aren't on the board yet appear in the parent dashboard to add, dismiss, or block. Only matched words are kept, never audio or transcripts.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            // Permission repair lives HERE too, not just in the strip: after a
            // reinstall (or a stray "Don't Allow"), only iOS Settings can turn
            // the microphone back on — the app cannot re-prompt a denial.
            Section {
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Label("Fix microphone permissions", systemImage: "mic.badge.xmark")
                }
            } footer: {
                Text("If listening says the microphone or Speech Recognition is off — common after reinstalling the app — this opens My World's page in iOS Settings. Turn on Microphone and Speech Recognition there, then come back and tap the mic again.")
            }
        }
        .disabled(!syncedLoaded)
        .navigationTitle("Listening")
        .navigationBarTitleDisplayMode(.inline)
    }

    // ── Safety & unlock (synced; enabling easyUnlock re-verifies the account
    //    password — never a one-tap waiver). The alert + PIN sheet ride THIS
    //    view: they only present from a view that's on screen. ──────────────
    private var safetyGroup: some View {
        Form {
            Section {
                Toggle("Close buttons work with a quick tap", isOn: $easyClose)
                    .onChange(of: easyClose) { _, v in saveSynced(["easyClose": v]) }
                if !easyClose {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("✕ hold length: \(String(format: "%.1f", exitHoldSec))s")
                            .font(.footnote)
                        Slider(value: $exitHoldSec, in: 0.3...3.0, step: 0.1) { editing in
                            if !editing { saveSynced(["exitHoldMs": Int(exitHoldSec * 1000)]) }
                        }
                        Text("Longer = harder for a child to quit by accident; shorter = snappier for grown-ups.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Toggle("Unlock editing without a password", isOn: $easyUnlock)
                    .onChange(of: easyUnlock) { _, v in
                        guard syncedLoaded, v != serverEasyUnlock else { return }
                        if v {
                            easyUnlock = false            // not real until the password confirms it
                            unlockPassword = ""
                            confirmEasyUnlock = true
                        } else {
                            serverEasyUnlock = false      // optimistic; a failed save reseeds truth
                            saveSynced(["easyUnlock": false])
                        }
                    }
                Text("For older, more capable kids who edit their own board.")
                    .font(.footnote).foregroundStyle(.secondary)
                // #17: per-device quick-unlock PIN management. Setting or
                // changing re-verifies the account password inside the
                // sheet; the PIN itself never leaves this device.
                Button(pinIsSet ? "Change the quick-unlock PIN…" : "Set a quick-unlock PIN…") {
                    pinRemoveMode = false
                    showPinSheet = true
                }
                if pinIsSet {
                    Button("Remove the PIN", role: .destructive) {
                        pinRemoveMode = true
                        showPinSheet = true
                    }
                }
                Text("A 4-digit PIN for this device that opens the board's edit lock faster than typing the full password. Your account password always works too.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let syncedMsg {
                    Text(syncedMsg).font(.footnote)
                        .foregroundStyle(syncedMsgIsError ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
                }
            }
        }
        .disabled(!syncedLoaded)
        .navigationTitle("Safety & unlock")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Skip the password on the board's lock?", isPresented: $confirmEasyUnlock) {
            SecureField("Your account password", text: $unlockPassword)
            Button("Cancel", role: .cancel) { unlockPassword = "" }
            Button("Skip the lock password", role: .destructive) { Task { await confirmUnlockWaiver() } }
        } message: {
            Text("This only changes the board's lock. Your account password stays exactly the same for signing in everywhere. With this on, anyone holding this device, including your child, can open edit mode, change or delete tiles, and reach the parent dashboard. Enter your account password once to confirm.")
        }
        .sheet(isPresented: $showPinSheet, onDismiss: { pinIsSet = QuickPin.isSet }) {
            PinManageSheet(removeMode: pinRemoveMode)
        }
    }

    // ── Device & account ────────────────────────────────────────────────────
    // This sheet is the ONE discoverable settings surface on the child board
    // (reached from edit mode's ⚙ Settings pill), so the device/account
    // actions live here too — the old path was a hidden triple-tap nobody
    // found.
    private var deviceGroup: some View {
        Form {
            Section {
                if let u = auth.user {
                    LabeledContent("Signed in as", value: u.email)
                }
                Button {
                    mode.role = .parent
                    dismiss()
                } label: {
                    Label("Switch this device to the Parent app", systemImage: "person.crop.circle.fill")
                }
                Button("Clear local cache") {
                    Task {
                        await MediaCache.shared.clear()
                        await SpeechCache.shared.clear()
                    }
                }
                Button("Sign out of this device", role: .destructive) { confirmSignOut = true }
            } footer: {
                Text("Signing out removes the board from this device until a parent signs back in. Nothing is deleted. The board lives in your account.")
            }
        }
        .navigationTitle("Device & account")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Sign out of this device?", isPresented: $confirmSignOut) {
            Button("Cancel", role: .cancel) {}
            Button("Sign out", role: .destructive) {
                Task { await auth.signOut(); dismiss() }
            }
        } message: {
            Text("The board will leave this device until a parent signs in again. Everything stays safe in your account.")
        }
    }

    /// Seed the synced toggles — cache-first via ChildSettingsStore, so the
    /// switches are usable immediately and OFFLINE once the device has synced
    /// this board even once. Only a first-ever open with no network and no
    /// cache stays disabled (there is truly nothing to show yet).
    private func seedSynced() async {
        let (s, live) = await ChildSettingsStore.shared.load(childId: auth.childSlug)
        offlineSeed = !live
        if s.isEmpty && !live { syncedLoaded = false; return }
        toolListen = (s["toolListen"] as? Bool) ?? true
        toolTeach = (s["toolTeach"] as? Bool) ?? true
        toolPlay = (s["toolPlay"] as? Bool) ?? true
        toolSentence = (s["toolSentence"] as? Bool) ?? true
        sentenceDrag = (s["sentenceDrag"] as? Bool) ?? false
        tapInterrupt = (s["tapInterrupt"] as? Bool) ?? false
        doubleTapTeach = (s["doubleTapTeach"] as? Bool) ?? false
        teachTapSec = Double(TouchConfig.clampMs(s["teachTapMs"], 500, 5000, 2000)) / 1000.0
        listenCensor = (s["listenCensor"] as? Bool) ?? true
        listenTilesOnly = (s["listenTilesOnly"] as? Bool) ?? false
        let rc = (s["listenRepeatCount"] as? Int) ?? Int(s["listenRepeatCount"] as? Double ?? -1)
        repeatCount = [0, 2, 3].contains(rc) ? rc : (((s["listenRepeatNav"] as? Bool) ?? true) ? 2 : 0)
        suggestListening = (s["suggestFromListening"] as? Bool) == true
        easyClose = (s["easyClose"] as? Bool) ?? false
        exitHoldSec = Double(TouchConfig.clampMs(s["exitHoldMs"], 300, 3000, 1200)) / 1000.0
        serverEasyUnlock = (s["easyUnlock"] as? Bool) ?? false
        easyUnlock = serverEasyUnlock
        syncedLoaded = true
    }

    /// Local-first write: the flip applies to this device IMMEDIATELY (cache +
    /// pending queue in ChildSettingsStore — never lost, never snapped back)
    /// and reaches the server now or on the next reconnect. The only message
    /// left is the honest offline note; there is no failure path a parent
    /// has to retry by hand.
    private func saveSynced(_ patch: [String: Any]) {
        guard syncedLoaded else { return }
        Task {
            let synced = await ChildSettingsStore.shared.apply(childId: auth.childSlug, patch: patch)
            syncedMsgIsError = false
            syncedMsg = synced ? nil : "Saved on this device — it syncs when you're back online."
            offlineSeed = !synced
            access.refresh()   // the live board applies it without a relaunch
        }
    }

    /// E6b: verify the account password (POST /api/auth/login, the
    /// UnlockSheet pattern) BEFORE easyUnlock can stick.
    private func confirmUnlockWaiver() async {
        let pw = unlockPassword
        unlockPassword = ""
        guard let email = auth.user?.email, !pw.isEmpty else {
            syncedMsgIsError = true
            syncedMsg = "Password required."
            return
        }
        // The password check itself REQUIRES the network (deliberately: a
        // safety waiver is never granted offline) — but once it passes, the
        // save rides the same local-first path as every other flip.
        do {
            _ = try await api.login(email: email, password: pw)
        } catch {
            syncedMsgIsError = true
            syncedMsg = "That password didn't work. The unlock gate stays on."
            return
        }
        let synced = await ChildSettingsStore.shared.apply(childId: auth.childSlug, patch: ["easyUnlock": true])
        syncedMsgIsError = false
        syncedMsg = synced ? nil : "Saved on this device — it syncs when you're back online."
        serverEasyUnlock = true
        easyUnlock = true
        access.refresh()
    }
}

/// #17: set, change, or remove this device's quick-unlock PIN. Every action
/// re-verifies the account password first (POST /api/auth/login — the same
/// proof the UnlockSheet accepts), so a child holding an unlocked board
/// can't quietly change the gate. The PIN never leaves the device; only its
/// device-salted hash is stored (QuickPin).
private struct PinManageSheet: View {
    let removeMode: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var auth

    @State private var password = ""
    @State private var newPin = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Your account password", text: $password)
                        .textContentType(.password)
                } footer: {
                    Text(removeMode
                         ? "Confirm with your account password to remove the PIN. The lock goes back to password-only."
                         : "Confirm with your account password, then pick a 4-digit PIN for this device. The full password always keeps working.")
                }
                if !removeMode {
                    Section {
                        SecureField("New 4-digit PIN", text: $newPin)
                            .keyboardType(.numberPad)
                            .onChange(of: newPin) { _, v in
                                let digits = String(v.filter(\.isNumber).prefix(4))
                                if digits != v { newPin = digits }
                            }
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red).font(.callout)
                }
                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        Text(busy ? "Saving…" : (removeMode ? "Remove the PIN" : "Save the PIN"))
                            .frame(maxWidth: .infinity)
                            .bold()
                    }
                    .disabled(busy || password.isEmpty || (!removeMode && newPin.count != 4))
                }
            }
            .navigationTitle(removeMode ? "Remove PIN" : (QuickPin.isSet ? "Change PIN" : "Set a PIN"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
            }
        }
    }

    private func save() async {
        guard let email = auth.user?.email else { dismiss(); return }
        busy = true
        defer { busy = false }
        do {
            _ = try await APIClient().login(email: email, password: password)
        } catch {
            self.error = "That password didn't work."
            password = ""
            return
        }
        if removeMode {
            QuickPin.remove()
        } else {
            QuickPin.set(newPin, childId: auth.childSlug)
        }
        dismiss()
    }
}

/// One labeled row that lets the user pick a color with a SwiftUI ColorPicker
/// while keeping the underlying preference stored as a hex string (so it
/// round-trips through UserDefaults exactly the same shape as the web app).
struct ColorRow: View {
    let label: String
    @Binding var hex: String

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            ColorPicker("", selection: Binding(
                get: { Color(hex: hex) },
                set: { newColor in hex = hexString(from: newColor) }
            ), supportsOpacity: false)
            .labelsHidden()
            .frame(width: 80)
        }
    }

    private func hexString(from color: Color) -> String {
        // Round-trip through UIColor → RGB → hex. Good enough fidelity for
        // a kid's board (we don't need sub-byte color accuracy).
        let ui = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02x%02x%02x",
                      Int((r * 255).rounded()),
                      Int((g * 255).rounded()),
                      Int((b * 255).rounded()))
    }
}

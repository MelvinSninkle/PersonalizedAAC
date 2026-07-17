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

    @State private var refreshing = false

    // Synced root-key toggles — seeded in .task; `syncedLoaded` keeps the
    // seed from firing the save onChange (the ParentSettingsView pattern).
    @State private var toolListen = true
    @State private var toolTeach = true
    @State private var toolPlay = true
    @State private var toolSentence = true
    @State private var tapInterrupt = false
    @State private var doubleTapTeach = false
    @State private var teachTapSec = 2.0     // tap-to-learn rapid-tap window
    @State private var listenCensor = true
    @State private var listenTilesOnly = false
    @State private var easyClose = false
    @State private var exitHoldSec = 1.2     // ✕ hold length when easyClose off
    @State private var easyUnlock = false
    @State private var syncedLoaded = false
    @State private var syncedMsg: String?
    // easyUnlock enable = re-type the account password first (E6b, exactly
    // like the web Display modal). Turning it OFF is friction-free.
    @State private var confirmEasyUnlock = false
    @State private var unlockPassword = ""
    // Programmatic easyUnlock writes (snap-back, confirmed enable) must not
    // re-enter the onChange save path.
    @State private var suppressUnlockChange = false

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

                // ── 1 · Board look (saved on this device + follows via kidDisplay) ──
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

                Section("Header colors") {
                    ColorRow(label: "Background", hex: $prefs.colorHeaderBg)
                    ColorRow(label: "Text",       hex: $prefs.colorHeaderText)
                }

                // ── 2 · Board tools (synced — follows the child everywhere) ──
                Section {
                    Toggle("🎙 Listening (live word strip)", isOn: $toolListen)
                        .onChange(of: toolListen) { _, v in saveSynced(["toolListen": v]) }
                    Toggle("📖 Teach (word slideshows)", isOn: $toolTeach)
                        .onChange(of: toolTeach) { _, v in saveSynced(["toolTeach": v]) }
                    Toggle("🙋 Play (find-the-word game)", isOn: $toolPlay)
                        .onChange(of: toolPlay) { _, v in saveSynced(["toolPlay": v]) }
                    Toggle("✏️ Sentence mode", isOn: $toolSentence)
                        .onChange(of: toolSentence) { _, v in saveSynced(["toolSentence": v]) }
                } header: {
                    Text("Board tools")
                } footer: {
                    Text("Which buttons show in the board's header. Everything from here down follows your child — it applies on every device this board is used on.")
                }

                // ── 3 · Touch & play (synced) ──
                Section {
                    Toggle("New taps interrupt the word", isOn: $tapInterrupt)
                        .onChange(of: tapInterrupt) { _, v in saveSynced(["tapInterrupt": v]) }
                    Text("Off: each word finishes before the next tap counts — steadier for new talkers.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Toggle("Tap again to learn", isOn: $doubleTapTeach)
                        .onChange(of: doubleTapTeach) { _, v in saveSynced(["doubleTapTeach": v]) }
                    Text("Tap a tile: hear the word. Tap again quickly: hear a fact — up to three facts on back-to-back taps, then the word again.")
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

                // ── 4 · Listening (synced, E8) ──
                Section("Listening") {
                    Toggle("Hide bad words", isOn: $listenCensor)
                        .onChange(of: listenCensor) { _, v in saveSynced(["listenCensor": v]) }
                    Toggle("Only show words with tiles", isOn: $listenTilesOnly)
                        .onChange(of: listenTilesOnly) { _, v in saveSynced(["listenTilesOnly": v]) }
                }

                // ── 5 · Safety & unlock (synced; enabling easyUnlock re-verifies
                //      the account password — never a one-tap waiver) ──
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
                            guard syncedLoaded else { return }
                            if suppressUnlockChange { suppressUnlockChange = false; return }
                            if v {
                                suppressUnlockChange = true
                                easyUnlock = false            // not real until the password confirms it
                                unlockPassword = ""
                                confirmEasyUnlock = true
                            } else {
                                saveSynced(["easyUnlock": false])
                            }
                        }
                    Text("For older, more capable kids who edit their own board.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let syncedMsg { Text(syncedMsg).font(.footnote).foregroundStyle(.red) }
                } header: {
                    Text("Safety & unlock")
                }

                Section {
                    Button("Reset look to defaults") { prefs.resetToDefaults() }
                }
            }
            .navigationTitle("Display Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.bold()
                }
            }
            .task { await seedSynced() }
            .alert("Remove the password?", isPresented: $confirmEasyUnlock) {
                SecureField("Your password", text: $unlockPassword)
                Button("Cancel", role: .cancel) { unlockPassword = "" }
                Button("Remove the password", role: .destructive) { Task { await confirmUnlockWaiver() } }
            } message: {
                Text("Anyone holding this device — including your child — will be able to open edit mode, change or delete tiles, and reach the parent dashboard. Enter your password once to confirm you're removing it on purpose.")
            }
        }
    }

    /// Seed the synced toggles from the server blob (once per open).
    private func seedSynced() async {
        let s = await api.childSettings(childId: auth.childSlug)
        toolListen = (s["toolListen"] as? Bool) ?? true
        toolTeach = (s["toolTeach"] as? Bool) ?? true
        toolPlay = (s["toolPlay"] as? Bool) ?? true
        toolSentence = (s["toolSentence"] as? Bool) ?? true
        tapInterrupt = (s["tapInterrupt"] as? Bool) ?? false
        doubleTapTeach = (s["doubleTapTeach"] as? Bool) ?? false
        teachTapSec = Double(TouchConfig.clampMs(s["teachTapMs"], 500, 5000, 2000)) / 1000.0
        listenCensor = (s["listenCensor"] as? Bool) ?? true
        listenTilesOnly = (s["listenTilesOnly"] as? Bool) ?? false
        easyClose = (s["easyClose"] as? Bool) ?? false
        exitHoldSec = Double(TouchConfig.clampMs(s["exitHoldMs"], 300, 3000, 1200)) / 1000.0
        easyUnlock = (s["easyUnlock"] as? Bool) ?? false
        syncedLoaded = true
    }

    /// Merge-write one root key; on failure re-seed so the switch snaps back
    /// to the truth instead of lying (same contract as ParentSettingsView).
    private func saveSynced(_ patch: [String: Any]) {
        guard syncedLoaded else { return }
        Task {
            if await api.updateChildSettings(childId: auth.childSlug, patch: patch) {
                syncedMsg = nil
                access.refresh()   // the live board applies it without a relaunch
            } else {
                syncedMsg = "Couldn't save — check your connection."
                syncedLoaded = false
                await seedSynced()
            }
        }
    }

    /// E6b: verify the account password (POST /api/auth/login, the
    /// UnlockSheet pattern) BEFORE easyUnlock can stick.
    private func confirmUnlockWaiver() async {
        let pw = unlockPassword
        unlockPassword = ""
        guard let email = auth.user?.email, !pw.isEmpty else {
            syncedMsg = "Password required."
            return
        }
        do {
            _ = try await api.login(email: email, password: pw)
        } catch {
            syncedMsg = "That password didn't work — the unlock gate stays on."
            return
        }
        if await api.updateChildSettings(childId: auth.childSlug, patch: ["easyUnlock": true]) {
            syncedMsg = nil
            suppressUnlockChange = true
            easyUnlock = true
            access.refresh()
        } else {
            syncedMsg = "Couldn't save — check your connection."
        }
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

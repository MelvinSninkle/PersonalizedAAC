import SwiftUI

/// "⚙ Display" modal — mirrors the web app's Display Settings panel.
/// All edits go through @Observable bindings so changes are live (the board
/// behind the sheet updates as you tweak), and writes hit UserDefaults via
/// DisplayPrefs.save() automatically.
struct DisplaySettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(DisplayPrefs.self) private var prefs
    @Environment(BoardStore.self) private var board
    @Environment(AuthManager.self) private var auth

    @State private var refreshing = false

    private let columnChoices = [1, 2, 3, 4, 5, 6, 7, 8]

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
                Section("Labels") {
                    Toggle("Hide all labels", isOn: $prefs.hideLabels)
                }

                Section("Show sections") {
                    Toggle("People",            isOn: $prefs.showPeople)
                    Toggle("Nouns",             isOn: $prefs.showNouns)
                    Toggle("Verbs",             isOn: $prefs.showVerbs)
                    Toggle("Needs (bottom row)", isOn: $prefs.showNeeds)
                }

                Section("Tiles across") {
                    Stepper("People: \(prefs.acrossPeople)", value: $prefs.acrossPeople, in: 1...8)
                    Stepper("Nouns: \(prefs.acrossNouns)",   value: $prefs.acrossNouns,  in: 1...8)
                    Stepper("Verbs: \(prefs.acrossVerbs)",   value: $prefs.acrossVerbs,  in: 1...8)
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

                Section {
                    Button("Reset to defaults") { prefs.resetToDefaults() }
                }
            }
            .navigationTitle("Display Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.bold()
                }
            }
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

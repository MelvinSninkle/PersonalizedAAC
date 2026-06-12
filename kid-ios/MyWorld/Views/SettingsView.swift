import SwiftUI

/// Parent-only settings, surfaced via a long-press on the (small, hard-to-find)
/// gear icon in the top bar. v0 surface is intentionally minimal — most
/// changes happen on the web parent dashboard, which we open in Safari.
struct SettingsView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(DeviceMode.self)  private var mode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Signed in") {
                    if let u = auth.user {
                        LabeledContent("Email",   value: u.email)
                        LabeledContent("Role",    value: u.role)
                        LabeledContent("Child",   value: u.slug ?? "—")
                    } else {
                        Text("Not signed in")
                    }
                }
                Section("Parent dashboard") {
                    Button {
                        mode.role = .parent
                        dismiss()
                    } label: {
                        HStack {
                            Image(systemName: "person.crop.circle.fill")
                            Text("Switch this device to the Parent app")
                        }
                    }
                    Link(destination: parentURL) {
                        HStack {
                            Image(systemName: "safari")
                            Text("Open parent dashboard in Safari")
                        }
                    }
                }
                Section("Maintenance") {
                    Button("Clear local cache") {
                        Task {
                            await MediaCache.shared.clear()
                            dismiss()
                        }
                    }
                    Button("Sign out", role: .destructive) {
                        Task {
                            await auth.signOut()
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var parentURL: URL {
        let slug = auth.user?.slug ?? auth.childSlug
        return URL(string: "https://aac.andrewpeterson.io/parent/\(slug)")!
    }
}

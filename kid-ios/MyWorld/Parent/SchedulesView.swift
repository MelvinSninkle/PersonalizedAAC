import SwiftUI

/// PRD §4.6 — the scheduling manager, v1 scope: see every prompt the child's
/// board will fire, flip them on/off, delete, and add a simple reminder.
/// Question-with-responses and game-sequence authoring stay on the web (they
/// need the tile pickers); this screen round-trips those rows untouched.
///
/// Works on raw dictionaries rather than the typed Schedule model so fields
/// this version doesn't know about (responses, scopes, …) survive the write.
struct SchedulesView: View {
    @Environment(AuthManager.self) private var auth

    @State private var rows: [[String: Any]] = []
    @State private var loaded = false
    @State private var saving = false
    @State private var showNew = false

    private let api = APIClient()

    var body: some View {
        List {
            if loaded && rows.isEmpty {
                Text("No scheduled prompts yet. Add a reminder below, or build richer prompts (questions, game nudges) on the web dashboard.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { idx, row in
                scheduleRow(idx: idx, row: row)
            }
            .onDelete { offsets in
                rows.remove(atOffsets: offsets)
                Task { await save() }
            }
        }
        .navigationTitle("Schedules")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNew = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showNew) {
            NewReminderSheet { prompt, intervalMin in
                rows.append([
                    "id": "s\(Int(Date().timeIntervalSince1970 * 1000))",
                    "type": "reminder",
                    "enabled": true,
                    "prompt": prompt,
                    "timing": "interval",
                    "intervalMin": intervalMin,
                    "days": [0, 1, 2, 3, 4, 5, 6],
                ])
                Task { await save() }
            }
        }
        .overlay(alignment: .bottom) {
            if saving {
                Text("Saving…").font(.footnote).foregroundStyle(.secondary)
                    .padding(8).background(.thinMaterial, in: Capsule()).padding(.bottom, 8)
            }
        }
        .task {
            rows = await api.fetchRawSchedules(childId: auth.childSlug)
            loaded = true
        }
    }

    private func scheduleRow(idx: Int, row: [String: Any]) -> some View {
        let type = (row["type"] as? String) ?? "reminder"
        let prompt = (row["prompt"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? defaultPrompt(type)
        let enabled = (row["enabled"] as? Bool) ?? true
        let when = timingText(row)
        return HStack {
            Image(systemName: icon(type))
                .foregroundStyle(Color(hex: "#ff1493"))
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(prompt).font(.system(size: 15, weight: .semibold))
                Text("\(label(type)) · \(when)").font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { (rows[idx]["enabled"] as? Bool) ?? true },
                set: { newVal in
                    rows[idx]["enabled"] = newVal
                    Task { await save() }
                }
            ))
            .labelsHidden()
            .tint(Color(hex: "#ff1493"))
        }
        .opacity(enabled ? 1 : 0.55)
    }

    private func icon(_ type: String) -> String {
        switch type {
        case "question": return "questionmark.bubble.fill"
        case "game":     return "gamecontroller.fill"
        default:           return "bell.fill"
        }
    }
    private func label(_ type: String) -> String {
        switch type {
        case "question": return "Question"
        case "game":     return "Game nudge"
        default:           return "Reminder"
        }
    }
    private func defaultPrompt(_ type: String) -> String {
        switch type {
        case "question": return "A quick question."
        case "game":     return "Let's do a game!"
        default:           return "Time for a check-in."
        }
    }
    private func timingText(_ row: [String: Any]) -> String {
        if (row["timing"] as? String) == "times", let times = row["times"] as? [String], !times.isEmpty {
            return "at " + times.joined(separator: ", ")
        }
        let mins = (row["intervalMin"] as? Double) ?? Double(row["intervalMin"] as? Int ?? 45)
        return "every \(Int(mins)) min"
    }

    private func save() async {
        saving = true
        await api.saveSchedules(childId: auth.childSlug, rows)
        saving = false
    }
}

/// Minimal composer for a spoken reminder ("Do you need the potty?") on an
/// interval. The board speaks it in the parent's recorded reward voice.
private struct NewReminderSheet: View {
    let onAdd: (String, Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var prompt = ""
    @State private var intervalMin = 45

    var body: some View {
        NavigationStack {
            Form {
                TextField("What should the board say?", text: $prompt, axis: .vertical)
                    .lineLimit(1...3)
                Stepper("Every \(intervalMin) minutes", value: $intervalMin, in: 5...240, step: 5)
            }
            .navigationTitle("New reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add") {
                        onAdd(prompt.trimmingCharacters(in: .whitespaces), intervalMin)
                        dismiss()
                    }
                    .disabled(prompt.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

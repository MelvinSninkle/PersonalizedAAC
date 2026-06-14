import SwiftUI

/// Parent-facing controls + dashboard for the Auto-teach subsystem. Three
/// sections: enable + cadence + tier + daily-game time settings; gate status
/// ("why isn't it running right now?"); mastery roll-up by category.
struct AutoTeachView: View {
    @Environment(AuthManager.self) private var auth
    private let api = APIClient()

    @State private var state: APIClient.AutoTeachState?
    @State private var settings: APIClient.AutoTeachSettings = .init(
        enabled: false, cadence: "conservative", tier: "under3",
        dailyGameAt: "15:30", cooldownMin: 30, batchSize: 4
    )
    @State private var dailyGameDate = Date()
    @State private var saving = false
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let e = errorText { Text(e).font(.footnote).foregroundStyle(.red) }
                settingsCard
                gatesCard
                masteryCard
                helpFootnote
            }
            .padding(16)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Auto-teach")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
    }

    // MARK: -- Settings

    private var settingsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Auto-teach the whole board")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))

            Toggle(isOn: Binding(
                get: { settings.enabled },
                set: { settings.enabled = $0; Task { await save() } }
            )) {
                Text("Run learning automatically")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
            }
            .tint(Color(hex: Brand.pink))

            row("Cadence",
                value: AnyView(Picker("", selection: Binding(
                    get: { settings.cadence },
                    set: { settings.cadence = $0; Task { await save() } }
                )) {
                    Text("Conservative").tag("conservative")
                    Text("Standard").tag("standard")
                    Text("Intensive").tag("intensive")
                }.pickerStyle(.menu).tint(Color(hex: Brand.pinkDeep)))
            )

            row("Attention tier",
                value: AnyView(Picker("", selection: Binding(
                    get: { settings.tier },
                    set: { settings.tier = $0; Task { await save() } }
                )) {
                    Text("Under 3").tag("under3")
                    Text("3-5").tag("3to5")
                    Text("5 and up").tag("5plus")
                }.pickerStyle(.menu).tint(Color(hex: Brand.pinkDeep)))
            )

            row("Daily game time",
                value: AnyView(DatePicker("", selection: Binding(
                    get: { dailyGameDate },
                    set: { newVal in
                        dailyGameDate = newVal
                        let f = DateFormatter(); f.dateFormat = "HH:mm"
                        settings.dailyGameAt = f.string(from: newVal)
                        Task { await save() }
                    }
                ), displayedComponents: .hourAndMinute).labelsHidden())
            )

            row("Cooldown",
                value: AnyView(Stepper("\(settings.cooldownMin) min",
                                       value: Binding(
                                           get: { settings.cooldownMin },
                                           set: { settings.cooldownMin = $0; Task { await save() } }
                                       ), in: 15...120, step: 5)
                                    .labelsHidden())
            )
        }
        .padding(14)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    // MARK: -- Gates

    private var gatesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Status right now")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            if let g = state?.gates {
                gateLine(ok: g.enabled, ok_text: "Auto-teach is on", ko_text: "Auto-teach is off")
                gateLine(ok: !g.inBlackout, ok_text: "Currently a teachable window", ko_text: "Inside a blackout (sleep / school / meal)")
                gateLine(ok: !g.recentlyActive, ok_text: "Child isn't actively tapping", ko_text: "Child is using the board — won't interrupt")
                if g.cooldownLeftMin > 0 {
                    gateLine(ok: false, ok_text: "", ko_text: "Cooldown: next allowed in \(g.cooldownLeftMin) min")
                } else {
                    gateLine(ok: true, ok_text: "Cooldown clear", ko_text: "")
                }
                HStack {
                    Text("Today's exposure budget")
                        .font(.system(size: 12)).foregroundStyle(Color(hex: Brand.muted))
                    Spacer()
                    Text("\(g.budgetUsedMin) / \(g.budgetCapMin) min")
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color(hex: g.budgetExhausted ? Brand.muted : Brand.ink))
                }
            } else {
                Text("Loading status…").font(.footnote).foregroundStyle(Color(hex: Brand.muted))
            }
        }
        .padding(14)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func gateLine(ok: Bool, ok_text: String, ko_text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: ok ? "checkmark.circle.fill" : "pause.circle.fill")
                .foregroundStyle(Color(hex: ok ? Brand.good : Brand.muted))
            Text(ok ? ok_text : ko_text)
                .font(.system(size: 13))
                .foregroundStyle(Color(hex: Brand.ink))
            Spacer()
        }
    }

    // MARK: -- Mastery roll-up

    private var masteryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Progress by category")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.pinkDeep))
            if let mastery = state?.mastery, !mastery.isEmpty {
                ForEach(mastery.sorted { $0.total > $1.total }) { row in
                    masteryRow(row)
                }
            } else {
                Text("No taxonomy data yet.")
                    .font(.footnote).foregroundStyle(Color(hex: Brand.muted))
            }
        }
        .padding(14)
        .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private func masteryRow(_ row: APIClient.AutoTeachMastery) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(row.category)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: Brand.ink))
                Spacer()
                Text("\(row.mastered + row.maintenance) / \(row.total) mastered")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color(hex: Brand.muted))
            }
            GeometryReader { geo in
                HStack(spacing: 0) {
                    seg(width: geo.size.width, n: row.maintenance, total: row.total, hex: Brand.good)
                    seg(width: geo.size.width, n: row.mastered,    total: row.total, hex: Brand.verbalInk)
                    seg(width: geo.size.width, n: row.acquired,    total: row.total, hex: Brand.pinkDeep)
                    seg(width: geo.size.width, n: row.active,      total: row.total, hex: Brand.pink)
                    seg(width: geo.size.width, n: row.unmet,       total: row.total, hex: Brand.line)
                }
            }
            .frame(height: 8)
            .clipShape(Capsule())
        }
    }

    private func seg(width: CGFloat, n: Int, total: Int, hex: String) -> some View {
        let share = total > 0 ? Double(n) / Double(total) : 0
        return Rectangle()
            .fill(Color(hex: hex))
            .frame(width: width * share)
    }

    private func row(_ title: String, value: AnyView) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: Brand.ink))
            Spacer()
            value
        }
        .padding(10)
        .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 10))
    }

    private var helpFootnote: some View {
        Text("Auto-teach runs short exposure slideshows (~45-90s) at your chosen cadence during teachable windows, plus one game session per day at the time you pick. It honors quiet hours, school, and meal windows from your schedule, and pauses when the child is actively using the board. Mastery follows the clinical 80/90 rule — words move to a biweekly maintenance check rather than disappearing.")
            .font(.system(size: 11))
            .foregroundStyle(Color(hex: Brand.muted))
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 4)
            .padding(.top, 4)
    }

    // MARK: -- Plumbing

    private func reload() async {
        do {
            let s = try await api.autoTeachState(childId: auth.childSlug)
            state = s
            settings = s.settings
            // Sync the DatePicker's date from the "HH:mm" string.
            let f = DateFormatter(); f.dateFormat = "HH:mm"
            dailyGameDate = f.date(from: s.settings.dailyGameAt) ?? dailyGameDate
        } catch {
            errorText = "Could not load: \(error.localizedDescription)"
        }
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        await api.saveAutoTeach(childId: auth.childSlug, settings)
        // Re-fetch gates because they reflect the new settings.
        if let s = try? await api.autoTeachState(childId: auth.childSlug) { state = s }
        saving = false
    }
}

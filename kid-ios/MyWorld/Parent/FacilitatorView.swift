import SwiftUI

/// Standalone facilitator UI — auto-popped from anywhere in the parent app the
/// moment ParentLive sees the iPad publish status: running. Mirrors the web
/// therapist console's mark/skip/next/end buttons + live progress.
///
/// Splitting this out of StartGameView lets a parent navigate around the app
/// during a session and still always have the facilitator surface present,
/// AND the same surface auto-appears when a game is started by another
/// device (the iPad, the web console, the routine scheduler).
struct FacilitatorView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(ParentLive.self)  private var live
    @Environment(\.dismiss) private var dismiss

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    tabletPill
                    targetCard
                    marks
                    controls
                    endButton
                }
                .padding(16)
            }
            .background(Color(hex: Brand.bg))
            .navigationTitle("Facilitating")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Hide") { dismiss() }
                        .foregroundStyle(Color(hex: Brand.pinkDeep))
                }
            }
        }
    }

    // MARK: -- Pieces

    private var tabletPill: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(live.tabletOnline ? Color(hex: Brand.good) : Color(hex: Brand.faint))
                .frame(width: 10, height: 10)
                .overlay(
                    Circle().stroke(Color(hex: Brand.good).opacity(live.tabletOnline ? 0.4 : 0),
                                    lineWidth: 4).scaleEffect(1.6)
                )
            Text(live.tabletOnline ? "Tablet connected · game running" : "Waiting for tablet…")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Color(hex: Brand.ink))
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color(hex: Brand.goodBg), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: Brand.goodLine), lineWidth: 1))
    }

    private var targetCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ON SCREEN NOW")
                .font(.system(size: 11, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(Color(hex: Brand.muted))
            if let target = live.status?.payload?.target {
                HStack(spacing: 14) {
                    if let key = target.imageKey {
                        MediaImage(blobKey: key)
                            .frame(width: 92, height: 92)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    } else {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color(hex: Brand.line))
                            .frame(width: 92, height: 92)
                            .overlay(Text("🎯").font(.system(size: 34)))
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(target.label)
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(hex: Brand.ink))
                        Text(live.status?.status == "ended" ? "finished 🎉" : "tap a mark when ready")
                            .font(.system(size: 12))
                            .foregroundStyle(Color(hex: Brand.muted))
                    }
                    Spacer()
                }
            } else {
                Text("Waiting for the iPad to show a tile…")
                    .font(.footnote).foregroundStyle(Color(hex: Brand.muted))
            }
            progressLine
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [.white, Color(hex: "#fff7fb")],
                           startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: 18)
        )
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: Brand.line), lineWidth: 1))
    }

    private var progressLine: some View {
        let p = live.status?.payload
        let i = (p?.i ?? 0) + 1
        let total = p?.total ?? 0
        let correct = p?.correctCount ?? 0
        return HStack(spacing: 4) {
            Text("Item")
            Text("\(i)").bold().foregroundStyle(Color(hex: Brand.ink))
            Text("of")
            Text("\(total)").bold().foregroundStyle(Color(hex: Brand.ink))
            Text("·")
            Text("\(correct)").bold().foregroundStyle(Color(hex: Brand.ink))
            Text("correct")
            Spacer()
        }
        .font(.system(size: 13))
        .foregroundStyle(Color(hex: Brand.muted))
    }

    private var marks: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("MARK THIS ROUND")
            HStack(spacing: 10) {
                markButton(method: "tap",    icon: "hand.tap.fill",  label: "Tapped it",     tint: Brand.tapInk)
                markButton(method: "verbal", icon: "mouth.fill",     label: "Said it",       tint: Brand.verbalInk)
                markButton(method: "object", icon: "teddybear.fill", label: "Showed object", tint: Brand.objectInk)
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 10) {
            controlButton(action: "skip", label: "Skip",   bg: Brand.skipBg, ink: Brand.pinkDeep)
            controlButton(action: "next", label: "Next →", bg: Brand.nextBg, ink: Brand.nextInk)
        }
    }

    private var endButton: some View {
        Button {
            Task { try? await api.publishLiveCommand(childId: auth.childSlug, ["action": "end"]) }
        } label: {
            Text("End the activity")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color(hex: Brand.ink), in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
        }
    }

    // MARK: -- Helpers

    private func sectionLabel(_ t: String) -> some View {
        Text(t)
            .font(.system(size: 11, weight: .bold))
            .tracking(0.8)
            .foregroundStyle(Color(hex: Brand.pink))
    }

    private func markButton(method: String, icon: String, label: String, tint: String) -> some View {
        Button {
            Task { try? await api.publishLiveCommand(childId: auth.childSlug,
                                                     ["action": "mark", "method": method, "attemptsTaken": 1]) }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 22))
                Text(label).font(.system(size: 12, weight: .semibold, design: .rounded))
            }
            .frame(maxWidth: .infinity, minHeight: 74)
            .background(Color(hex: Brand.goodBg), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: Brand.goodLine), lineWidth: 1))
            .foregroundStyle(Color(hex: tint))
        }
        .buttonStyle(.plain)
    }

    private func controlButton(action: String, label: String, bg: String, ink: String) -> some View {
        Button {
            Task { try? await api.publishLiveCommand(childId: auth.childSlug, ["action": action]) }
        } label: {
            Text(label)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(Color(hex: bg), in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(Color(hex: ink))
        }
        .buttonStyle(.plain)
    }
}

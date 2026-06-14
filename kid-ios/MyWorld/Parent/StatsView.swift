import SwiftUI

/// PRD §4.5 stats hub — four focused sub-pages, each visible the moment its
/// data exists. The old single-scroll view buried everything; this routes
/// to the right surface for the question the parent is asking.
struct StatsView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                hubCard(icon: "chart.bar.fill",         title: "Top words",
                        subtitle: "Most-tapped words this month",
                        destination: AnyView(TopWordsView()))
                hubCard(icon: "magnifyingglass",        title: "Word history",
                        subtitle: "Search every tap, by word and time",
                        destination: AnyView(WordHistoryView()))
                hubCard(icon: "gauge.with.dots.needle.67percent",
                        title: "Game accuracy",
                        subtitle: "Pass rate by category and by game mode",
                        destination: AnyView(AccuracyView()))
                hubCard(icon: "hand.raised.fingers.spread.fill",
                        title: "How they answer",
                        subtitle: "Tap · verbal · object · physical · gesture",
                        destination: AnyView(InputMethodsView()))
                hubCard(icon: "rosette",                title: "Mastery & sessions",
                        subtitle: "30-day mastery and recent activity",
                        destination: AnyView(MasterySessionsView()))
            }
            .padding(16)
        }
        .background(Color(hex: Brand.bg))
        .navigationTitle("Stats")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func hubCard(icon: String, title: String, subtitle: String,
                         destination: AnyView) -> some View {
        NavigationLink { destination } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 50, height: 50)
                    .background(Color(hex: Brand.pink), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(hex: Brand.ink))
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Color(hex: Brand.muted))
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color(hex: Brand.faint))
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Color(hex: Brand.card), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: Brand.line), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

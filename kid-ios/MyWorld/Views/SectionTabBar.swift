import SwiftUI

/// People / Nouns / Verbs / Needs tabs across the top of the board.
struct SectionTabBar: View {
    @Binding var selection: BoardSection

    var body: some View {
        HStack(spacing: 6) {
            ForEach(BoardSection.allCases) { section in
                Button {
                    selection = section
                } label: {
                    Text(section.label)
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .padding(.vertical, 10)
                        .padding(.horizontal, 18)
                        .foregroundStyle(selection == section ? .white : .primary)
                        .background(
                            selection == section
                                ? Color(hex: "#ff1493")
                                : Color(hex: section.bandHex)
                        )
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

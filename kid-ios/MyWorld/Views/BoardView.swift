import SwiftUI

/// Top-level board for a child. Three layers:
///   1. Section tab bar (People/Nouns/Verbs/Needs)
///   2. Scrolling grid of categories + tiles for the active section,
///      drilling into subcategories via NavigationStack.
///   3. Persistent pinned-tiles strip across the bottom.
struct BoardView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(BoardStore.self) private var board

    @State private var section: BoardSection = .needs
    @State private var path: [Category] = []
    @State private var showSettings = false

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                topBar
                SectionTabBar(selection: $section)
                    .background(Color(hex: section.bandHex))
                rootGrid
                Divider()
                PersistentStripView(tiles: board.persistentStrip()) { tile in
                    Task { await TilePlayer.shared.play(tile) }
                }
            }
            .navigationDestination(for: Category.self) { category in
                CategoryView(category: category)
            }
            .background(Color(hex: section.bandHex).opacity(0.4))
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
        }
        .task {
            await board.refresh(childId: auth.childSlug)
        }
        .refreshable {
            await board.refresh(childId: auth.childSlug)
        }
    }

    // MARK: -- Top bar (title + hidden settings tap target)

    private var topBar: some View {
        HStack {
            Text("My World")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hex: "#ad1457"))
            Spacer()
            // Tiny gear, intentionally small so kid doesn't tap it.
            // Long-press for parent settings.
            Image(systemName: "gearshape")
                .foregroundStyle(.tertiary)
                .padding(8)
                .contentShape(Rectangle())
                .onLongPressGesture(minimumDuration: 0.7) {
                    showSettings = true
                }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color(hex: "#ffe6f2"))
    }

    // MARK: -- Root grid for the selected section

    private var rootGrid: some View {
        let cats = board.roots(in: section)
        return ScrollView {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                ForEach(cats) { cat in
                    NavigationLink(value: cat) {
                        CategoryTile(category: cat)
                    }
                    .buttonStyle(TileButtonStyle())
                }
            }
            .padding(14)
        }
    }

    private var gridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 140, maximum: 200), spacing: 14)]
    }
}

/// A folder tile for a category. Tapping navigates into the subcategories or
/// tiles inside it.
struct CategoryTile: View {
    let category: Category
    @State private var image: UIImage?

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 18).fill(Color(.systemBackground))
                if let img = image {
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(contentMode: category.keepAspect ? .fit : .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                } else {
                    Image(systemName: "folder.fill")
                        .font(.largeTitle)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.black.opacity(0.06), lineWidth: 1)
            )
            Text(category.label)
                .font(.system(size: 17, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(.primary)
        }
        .task(id: category.imageKey) {
            guard let key = category.imageKey, !key.isEmpty else { return }
            if let img = await MediaCache.shared.image(for: key) {
                await MainActor.run { self.image = img }
            }
        }
    }
}

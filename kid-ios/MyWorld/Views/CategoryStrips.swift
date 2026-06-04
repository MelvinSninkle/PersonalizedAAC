import SwiftUI

/// Small horizontal strip of category "chips" — one per top-level category in
/// the section. Tapping selects it; the tile grid below filters to its
/// contents (or to its first subcategory's contents if it has subcategories).
struct CategoryTabStrip: View {
    let categories: [Category]
    @Binding var selectedId: Int?
    var hideLabels: Bool = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(categories) { cat in
                    CategoryChip(category: cat,
                                 selected: selectedId == cat.id,
                                 hideLabel: hideLabels) {
                        selectedId = cat.id
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(Color.white.opacity(0.4))
    }
}

struct SubcategoryStrip: View {
    let subcategories: [Category]
    @Binding var selectedId: Int?
    var hideLabels: Bool = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(subcategories) { sub in
                    CategoryChip(category: sub,
                                 selected: selectedId == sub.id,
                                 compact: true,
                                 hideLabel: hideLabels) {
                        selectedId = sub.id
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        // Transparent so the section band color (set on SectionColumn) shows
        // through — the subcategory strip blends with the tiles underneath it.
        .background(Color.clear)
    }
}

struct CategoryChip: View {
    let category: Category
    let selected: Bool
    var compact: Bool = false
    var hideLabel: Bool = false
    let onTap: () -> Void

    @State private var image: UIImage?

    private var side: CGFloat { compact ? 50 : 64 }

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 2) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(Color.white)
                    if let img = image {
                        Image(uiImage: img)
                            .resizable()
                            .aspectRatio(contentMode: category.keepAspect ? .fit : .fill)
                            .frame(width: side, height: side)
                            .clipped()
                    } else {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(width: side, height: side)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(selected ? Color(hex: "#ff1493") : Color.black.opacity(0.08),
                                lineWidth: selected ? 3 : 1)
                )

                if !compact && !hideLabel {
                    Text(category.label)
                        .font(.system(size: 11, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(.primary)
                        .frame(width: side)
                }
            }
        }
        .buttonStyle(.plain)
        .task(id: category.imageKey) {
            guard let key = category.imageKey, !key.isEmpty else { return }
            if let img = await MediaCache.shared.image(for: key) {
                await MainActor.run { self.image = img }
            }
        }
    }
}

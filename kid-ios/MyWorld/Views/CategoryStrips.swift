import SwiftUI

/// Small horizontal strip of category "chips" — one per top-level category in
/// the section. Tapping selects it; the tile grid below filters to its
/// contents (or to its first subcategory's contents if it has subcategories).
struct CategoryTabStrip: View {
    let categories: [Category]
    @Binding var selectedId: Int?
    var hideLabels: Bool = false
    /// Button-navigation mode: page the chips with ◀ ▶ instead of scrolling.
    var paged: Bool = false
    /// Unlocked-board drag support: a tile dropped on a chip moves into that
    /// category (SectionColumn supplies the handler; nil-safe via `?? false`).
    var onDropTile: ((Category, [String]) -> Bool)? = nil

    @State private var page = 0

    var body: some View {
        if paged {
            PagedChipRow(items: categories, chipSide: 64,
                         rowHeight: hideLabels ? 80 : 96, page: $page) { cat in
                CategoryChip(category: cat,
                             selected: selectedId == cat.id,
                             hideLabel: hideLabels,
                             onDropTile: onDropTile) {
                    selectedId = cat.id
                }
            }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(categories) { cat in
                        CategoryChip(category: cat,
                                     selected: selectedId == cat.id,
                                     hideLabel: hideLabels,
                                     onDropTile: onDropTile) {
                            selectedId = cat.id
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
            // Transparent — shares the section band color set on SectionColumn,
            // so there's no persistent white strip behind the category chips.
            .background(Color.clear)
        }
    }
}

/// Shared paged chip row for button-navigation mode: whole chips only per
/// page (the chip that would have been cut off leads the next page), with
/// inline ◀ ▶ paddles sized for imprecise pointing.
struct PagedChipRow<Item: Identifiable, Chip: View>: View {
    let items: [Item]
    let chipSide: CGFloat
    let rowHeight: CGFloat
    @Binding var page: Int
    @ViewBuilder let chip: (Item) -> Chip

    var body: some View {
        GeometryReader { geo in
            let per = max(1, Int((geo.size.width - 100) / (chipSide + 8)))
            let pageCount = max(1, Int(ceil(Double(items.count) / Double(per))))
            let p = min(page, pageCount - 1)
            let slice = Array(items.dropFirst(p * per).prefix(per))
            HStack(spacing: 6) {
                paddle("chevron.left", disabled: p <= 0) { page = max(0, p - 1) }
                    .opacity(pageCount > 1 ? 1 : 0)
                ForEach(slice) { item in chip(item) }
                Spacer(minLength: 0)
                paddle("chevron.right", disabled: p >= pageCount - 1) { page = min(pageCount - 1, p + 1) }
                    .opacity(pageCount > 1 ? 1 : 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 6)
        }
        .frame(height: rowHeight)
    }

    private func paddle(_ icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color(hex: "#2b3a55"))
                .frame(width: 40, height: 56)
                .background(RoundedRectangle(cornerRadius: 10).fill(.white))
                .overlay(RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(hex: "#c9d5e8"), lineWidth: 2))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.25 : 1)
    }
}

struct SubcategoryStrip: View {
    let subcategories: [Category]
    @Binding var selectedId: Int?
    var hideLabels: Bool = false
    var paged: Bool = false
    var onDropTile: ((Category, [String]) -> Bool)? = nil

    @State private var page = 0

    var body: some View {
        if paged {
            PagedChipRow(items: subcategories, chipSide: 50, rowHeight: 64, page: $page) { sub in
                CategoryChip(category: sub,
                             selected: selectedId == sub.id,
                             compact: true,
                             hideLabel: hideLabels,
                             onDropTile: onDropTile) {
                    selectedId = sub.id
                }
            }
        } else {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(subcategories) { sub in
                    CategoryChip(category: sub,
                                 selected: selectedId == sub.id,
                                 compact: true,
                                 hideLabel: hideLabels,
                                 onDropTile: onDropTile) {
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
}

struct CategoryChip: View {
    let category: Category
    let selected: Bool
    var compact: Bool = false
    var hideLabel: Bool = false
    var onDropTile: ((Category, [String]) -> Bool)? = nil
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
                            .aspectRatio(contentMode: .fill)   // guillotine: center-crop, no exceptions
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
                    Text(category.display)
                        .font(.system(size: 11, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(.primary)
                        .frame(width: side)
                }
            }
        }
        .buttonStyle(.plain)
        // Accept a dragged tile (unlocked board): dropping moves the tile into
        // this category. The handler enforces section + edit-mode rules.
        .dropDestination(for: String.self) { items, _ in
            onDropTile?(category, items) ?? false
        }
        .task(id: category.imageKey) {
            guard let key = category.imageKey, !key.isEmpty else { return }
            if let img = await MediaCache.shared.image(for: key, maxPixel: 320) {
                let display = img.trimmingFlatBorders()
                await MainActor.run { self.image = display }
            }
        }
    }
}

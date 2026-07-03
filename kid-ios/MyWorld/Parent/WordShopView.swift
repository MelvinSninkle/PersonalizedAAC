import SwiftUI

/// The native word shop — browse the library by section/category, tap words
/// into a cart, and check out in CREDITS (⭐1 per word). Each bought word is
/// placed on the board and rendered in the child's own style + voice within a
/// few minutes. Spending credits is not an in-app purchase (the credits were
/// bought via StoreKit / web), so this screen is Apple-compliant as-is.
struct WordShopView: View {
    @Environment(AuthManager.self) private var auth

    @State private var tiles: [APIClient.ShopTile] = []
    @State private var balance: Int?
    @State private var cart: Set<String> = []
    @State private var search = ""
    @State private var column = ""            // "" = all sections
    @State private var busy = false
    @State private var note: String?
    @State private var errorText: String?
    /// Folders start CLOSED — the library is hundreds of words, and one flat
    /// scroll was unusable. A search (or picking a section) opens everything
    /// it matches so results are never hidden behind a closed folder.
    @State private var openFolders: Set<String> = []

    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Every image you make is your family's to keep — stored forever, even when you change one.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)

                HStack {
                    TextField("Search words…", text: $search)
                        .textFieldStyle(.roundedBorder)
                    Picker("Section", selection: $column) {
                        Text("All").tag("")
                        ForEach(columns, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.menu)
                }

                if let e = errorText {
                    Text(e).font(.system(size: 13, weight: .semibold)).foregroundStyle(.red)
                }
                if let n = note {
                    Text(n).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: "#047857"))
                }

                if tiles.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 30)
                } else {
                    ForEach(groups, id: \.key) { group in
                        let isOpen = allOpen || openFolders.contains(group.key)
                        folderHeader(group, isOpen: isOpen)
                        if isOpen {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10)], spacing: 10) {
                                ForEach(group.tiles) { t in
                                    shopTile(t)
                                }
                            }
                        }
                    }
                }
            }
            .padding(16)
            .padding(.bottom, 90)
        }
        .background(Color(hex: "#fff7fb"))
        .navigationTitle("Word Shop")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Text(balance.map { "⭐ \($0)" } ?? "")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
            }
        }
        .safeAreaInset(edge: .bottom) { cartBar }
        .task { await load() }
    }

    // MARK: -- Pieces

    private var columns: [String] {
        Array(Set(tiles.map(\.column))).sorted()
    }

    /// Searching or filtering to one section = the parent is looking for
    /// something specific — show it all, don't make them open folders.
    private var allOpen: Bool {
        !search.trimmingCharacters(in: .whitespaces).isEmpty || !column.isEmpty
    }

    /// Tappable folder row: chevron + name + word count. In-cart words keep a
    /// pink badge on the closed folder so a browsing parent can find their
    /// picks again.
    private func folderHeader(_ group: Group, isOpen: Bool) -> some View {
        let inCart = group.tiles.filter { cart.contains($0.id) }.count
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if openFolders.contains(group.key) { openFolders.remove(group.key) }
                else { openFolders.insert(group.key) }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(hex: "#d6a8c6"))
                Text(group.key.uppercased())
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .lineLimit(1)
                Spacer()
                if inCart > 0 {
                    Text("\(inCart) in cart")
                        .font(.system(size: 10, weight: .heavy))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(Color(hex: "#ff1493")))
                        .foregroundStyle(.white)
                }
                Text("\(group.tiles.count)")
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Capsule().fill(Color(hex: "#fdf2f8")))
                    .foregroundStyle(Color(hex: "#9d2463"))
            }
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(.white, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#f3c6dd"), lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }

    private struct Group { let key: String; let tiles: [APIClient.ShopTile] }
    private var groups: [Group] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = tiles.filter { t in
            (column.isEmpty || t.column == column) &&
            (q.isEmpty || t.label.lowercased().contains(q))
        }
        var order: [String] = []
        var byKey: [String: [APIClient.ShopTile]] = [:]
        for t in shown {
            let key = t.category.map { "\(t.column) › \($0)" } ?? t.column
            if byKey[key] == nil { order.append(key) }
            byKey[key, default: []].append(t)
        }
        return order.map { Group(key: $0, tiles: byKey[$0] ?? []) }
    }

    @ViewBuilder
    private func shopTile(_ t: APIClient.ShopTile) -> some View {
        let selected = cart.contains(t.id)
        Button {
            if selected { cart.remove(t.id) } else { cart.insert(t.id) }
        } label: {
            VStack(spacing: 4) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(Color(hex: "#fdf2f8"))
                    if let key = t.previewKey {
                        ShopThumb(blobKey: key)
                    } else {
                        Text(t.label)
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color(hex: "#9d2463"))
                            .minimumScaleFactor(0.5)
                            .padding(4)
                    }
                }
                .frame(height: 86)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12)
                    .stroke(selected ? Color(hex: "#ff1493") : Color(hex: "#f3c6dd"),
                            lineWidth: selected ? 3 : 1.5))
                .overlay(alignment: .topTrailing) {
                    if selected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Color(hex: "#ff1493"))
                            .background(Circle().fill(.white))
                            .padding(4)
                    } else if t.personalized {
                        Text("yours").font(.system(size: 8, weight: .heavy))
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Capsule().fill(Color(hex: "#ecfdf5")))
                            .foregroundStyle(Color(hex: "#047857"))
                            .padding(4)
                    }
                }
                Text(t.label)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .foregroundStyle(.primary)
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var cartBar: some View {
        if !cart.isEmpty {
            HStack(spacing: 12) {
                Text("\(cart.count) word\(cart.count == 1 ? "" : "s") · ⭐\(cart.count)")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                Spacer()
                Button("Clear") { cart.removeAll() }
                    .font(.system(size: 13, weight: .semibold))
                Button {
                    Task { await checkout() }
                } label: {
                    Text(busy ? "…" : "Get these words")
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Color(hex: "#ff1493"))
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(busy)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(.regularMaterial)
        }
    }

    // MARK: -- Actions

    private func load() async {
        balance = await api.storeBalance()
        do { tiles = try await api.storeBrowse(childId: auth.childSlug) }
        catch { errorText = "Couldn't load the word library. Pull to retry." }
    }

    private func checkout() async {
        busy = true
        errorText = nil; note = nil
        defer { busy = false }
        do {
            let r = try await api.storeCheckout(childId: auth.childSlug, taxonomyIds: Array(cart))
            cart.removeAll()
            balance = r.balance ?? balance
            note = r.note ?? "\(r.queued) words queued — they render in your child's style over the next few minutes."
            tiles = (try? await api.storeBrowse(childId: auth.childSlug)) ?? tiles
        } catch let APIError.badStatus(status, body) {
            errorText = (status == 402 || body.contains("not_enough_credits"))
                ? "Not enough credits — add a pack on the Credits & Store screen, then try again."
                : "Checkout failed: \(String(body.prefix(120)))"
        } catch {
            errorText = "Checkout failed: \(error.localizedDescription)"
        }
    }
}

/// Small async thumbnail backed by the shared MediaCache.
private struct ShopThumb: View {
    let blobKey: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                Color.clear
            }
        }
        .task(id: blobKey) {
            if let img = await MediaCache.shared.image(for: blobKey) {
                image = img
            }
        }
    }
}

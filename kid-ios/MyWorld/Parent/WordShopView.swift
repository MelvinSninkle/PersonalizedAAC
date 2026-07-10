import SwiftUI

/// Disk-cached copy of the shop catalog. The catalog barely changes between
/// visits, and the device already knows every preview image (MediaCache) and
/// which tiles are personalized — so the shop should never make a parent stare
/// at a spinner. Last visit's catalog renders instantly; a fresh copy loads
/// behind it and swaps in.
enum ShopCatalog {
    private static func url(_ childId: String) -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let safe = childId.replacingOccurrences(of: "/", with: "_")
        return dir.appendingPathComponent("shop-catalog-\(safe).json")
    }
    static func cached(childId: String) -> [APIClient.ShopTile]? {
        guard let data = try? Data(contentsOf: url(childId)) else { return nil }
        return try? JSONDecoder().decode([APIClient.ShopTile].self, from: data)
    }
    static func save(_ tiles: [APIClient.ShopTile], childId: String) {
        guard let data = try? JSONEncoder().encode(tiles) else { return }
        try? data.write(to: url(childId), options: .atomic)
    }
    /// Fetch a fresh catalog into the cache. Called in the background the
    /// moment the Credits & Store screen opens, so by the time the parent taps
    /// "Shop words" the cache is already warm.
    @discardableResult
    static func refresh(childId: String, api: APIClient = APIClient()) async -> [APIClient.ShopTile]? {
        guard let fresh = try? await api.storeBrowse(childId: childId) else { return nil }
        save(fresh, childId: childId)
        return fresh
    }
}

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
    /// "Personalize every tile" quote (remaining / total / cost) from the server.
    @State private var paQuote: APIClient.PersonalizeAllResult?
    @State private var paBusy = false
    @State private var freeBusy: String?     // category label mid free-add/remove

    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Every image you make is your family's to keep — stored forever, even when you change one.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)

                if let e = errorText {
                    Text(e).font(.system(size: 13, weight: .semibold)).foregroundStyle(.red)
                }
                if let n = note {
                    Text(n).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: "#047857"))
                }

                if column.isEmpty && search.isEmpty {
                    // SHOP HOME — the four ribbons need no data, so they render
                    // the instant the page opens; the catalog (cached from last
                    // visit, refreshed in the background) streams in the free
                    // boards + personalize card underneath.
                    Text("SHOP BY SECTION")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(Color(hex: "#ad1457"))
                        .padding(.top, 2)
                    sectionCard("🧑‍🤝‍🧑", "Shop People", "people")
                    sectionCard("🧸", "Shop Nouns, Adjectives & More", "other")
                    sectionCard("🏃", "Shop Verbs", "verbs")
                    sectionCard("⭐", "Shop Core Words", "needs")
                    HStack {
                        TextField("…or search every word", text: $search)
                            .textFieldStyle(.roundedBorder)
                    }
                    .padding(.top, 6)
                    if tiles.isEmpty {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Loading your word library…")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity).padding(.top, 14)
                    } else {
                        personalizeCard
                        freeBoardsSection
                    }
                } else if tiles.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 30)
                } else {
                    HStack {
                        if !column.isEmpty {
                            Button {
                                column = ""; search = ""
                            } label: {
                                Label("Shop home", systemImage: "chevron.left")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(Color(hex: "#ad1457"))
                            }
                            .buttonStyle(.plain)
                        }
                        TextField("Search words…", text: $search)
                            .textFieldStyle(.roundedBorder)
                    }
                    ForEach(groups, id: \.key) { group in
                        let isOpen = allOpen || openFolders.contains(group.key)
                        folderHeader(group, isOpen: isOpen)
                        if isOpen {
                            bundleRow(group)
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

    /// "other" is the Nouns-Adjectives-and-More card: everything that isn't
    /// People, Verbs, or the Core Words strip (column "needs" — its own ribbon).
    private func matchesColumn(_ t: APIClient.ShopTile) -> Bool {
        switch column {
        case "":      return true
        case "other": return t.column != "people" && t.column != "verbs" && t.column != "needs"
        default:      return t.column == column
        }
    }

    /// Searching = show everything matched, don't make them open folders.
    /// (Inside a section, folders still start closed to keep the page light.)
    private var allOpen: Bool {
        !search.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: -- Shop home pieces

    /// "Personalize every tile on the board" — xx of yyyy remaining + price.
    /// Tracked from the board itself: a custom image_key IS the record.
    @ViewBuilder
    private var personalizeCard: some View {
        if let q = paQuote, let remaining = q.remaining, let total = q.total, remaining > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Text("✨ Personalize every tile")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                Text("\(remaining) of \(total) tiles still wear the shared pictures. Finish the whole set in your child's style — 20% off.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                Button {
                    Task { await personalizeAll() }
                } label: {
                    Text(paBusy ? "Queuing…" : "Personalize \(remaining) tiles · ⭐\(q.cost ?? remaining)")
                        .font(.system(size: 14, weight: .bold))
                        .frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(Color(hex: "#ff1493")).foregroundStyle(.white)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain).disabled(paBusy)
            }
            .padding(14)
            .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6dd"), lineWidth: 1.5))
        }
    }

    /// Free common-use boards: whole categories placed with the shared default
    /// art at no cost — personalizing is what costs credits.
    private var freeBoardsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("FREE — COMMON USE BOARDS")
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(Color(hex: "#047857"))
            Text("Add whole categories with the shared pictures for free. Remove keeps anything you personalized.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            ForEach(freeGroups, id: \.key) { g in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(g.category)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                        Text("\(g.onBoard) of \(g.total) on the board")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        Task { await toggleFreeBoard(g, on: g.onBoard < g.total) }
                    } label: {
                        Text(freeBusy == g.key ? "…" : (g.onBoard < g.total ? "Add free" : "Remove"))
                            .font(.system(size: 12, weight: .bold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(g.onBoard < g.total ? Color(hex: "#047857") : Color(hex: "#fce4ef"))
                            .foregroundStyle(g.onBoard < g.total ? .white : Color(hex: "#ad1457"))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain).disabled(freeBusy != nil)
                }
                .padding(10)
                .background(.white, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#d1fae5"), lineWidth: 1.5))
            }
        }
        .padding(.top, 4)
    }

    private struct FreeGroup { let key: String; let column: String; let category: String; let total: Int; let onBoard: Int }
    private var freeGroups: [FreeGroup] {
        var order: [String] = []
        var agg: [String: (col: String, cat: String, total: Int, on: Int)] = [:]
        for t in tiles {
            guard let cat = t.category, !cat.isEmpty else { continue }
            if t.freeBoard == false { continue }   // credits-priced board: not free-addable
            let key = t.column + "|" + cat
            if agg[key] == nil { order.append(key); agg[key] = (t.column, cat, 0, 0) }
            agg[key]!.total += 1
            if t.onBoard { agg[key]!.on += 1 }
        }
        return order.compactMap { k in
            guard let a = agg[k] else { return nil }
            return FreeGroup(key: k, column: a.col, category: a.cat, total: a.total, onBoard: a.on)
        }
    }

    private func sectionCard(_ emoji: String, _ title: String, _ value: String) -> some View {
        Button { column = value } label: {
            HStack(spacing: 12) {
                Text(emoji).font(.system(size: 28))
                Text(title)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color(hex: "#d6a8c6"))
            }
            .padding(14)
            .background(.white, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6dd"), lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }

    /// One-tap bundle purchase for an open folder: 20% off vs word-by-word.
    @ViewBuilder
    private func bundleRow(_ group: Group) -> some View {
        let unpersonalized = group.tiles.filter { !$0.personalized }
        if unpersonalized.count >= 3 {
            let cost = max(1, Int((Double(unpersonalized.count) * 0.8).rounded(.up)))
            Button {
                Task { await buyBundle(unpersonalized.map(\.id)) }
            } label: {
                Text(busy ? "…" : "✨ Personalize all \(unpersonalized.count) · ⭐\(cost) (20% off)")
                    .font(.system(size: 13, weight: .bold))
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(Color(hex: "#fce4ef")).foregroundStyle(Color(hex: "#ad1457"))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain).disabled(busy)
        }
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
            matchesColumn(t) && (q.isEmpty || t.label.lowercased().contains(q))
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
        // 1) Last visit's catalog renders the whole shop instantly — folders,
        //    free-board counts, "yours" badges are all in it, and the preview
        //    images are already in the on-disk MediaCache.
        if tiles.isEmpty, let cached = ShopCatalog.cached(childId: auth.childSlug) {
            tiles = cached
        }
        // 2) Fresh data streams in behind it (balance in parallel with the
        //    catalog; the personalize-all quote after, it's below the fold).
        async let bal = api.storeBalance()
        if let fresh = await ShopCatalog.refresh(childId: auth.childSlug, api: api) {
            tiles = fresh
        } else if tiles.isEmpty {
            errorText = "Couldn't load the word library. Pull to retry."
        }
        balance = await bal
        paQuote = try? await api.storePersonalizeAll(childId: auth.childSlug, quote: true)
    }

    private func buyBundle(_ ids: [String]) async {
        busy = true; errorText = nil; note = nil
        defer { busy = false }
        do {
            let r = try await api.storeCheckout(childId: auth.childSlug, taxonomyIds: ids, bundle: true)
            balance = r.balance ?? balance
            note = r.note ?? "\(r.queued) words queued."
            tiles = await ShopCatalog.refresh(childId: auth.childSlug, api: api) ?? tiles
        } catch let APIError.badStatus(status, body) {
            errorText = (status == 402 || body.contains("not_enough_credits"))
                ? "Not enough credits — add a pack on the Credits & Store screen first."
                : "Bundle failed: \(String(body.prefix(120)))"
        } catch { errorText = "Bundle failed: \(error.localizedDescription)" }
    }

    private func toggleFreeBoard(_ g: FreeGroup, on: Bool) async {
        freeBusy = g.key; errorText = nil; note = nil
        defer { freeBusy = nil }
        do {
            let r = try await api.storeFreeBoard(childId: auth.childSlug, column: g.column, category: g.category, on: on)
            note = r.note
            tiles = await ShopCatalog.refresh(childId: auth.childSlug, api: api) ?? tiles
        } catch { errorText = "Couldn't update: \(error.localizedDescription)" }
    }

    private func personalizeAll() async {
        paBusy = true; errorText = nil; note = nil
        defer { paBusy = false }
        do {
            let r = try await api.storePersonalizeAll(childId: auth.childSlug, quote: false)
            balance = r.balance ?? balance
            note = r.note
            paQuote = try? await api.storePersonalizeAll(childId: auth.childSlug, quote: true)
        } catch let APIError.badStatus(status, body) {
            errorText = (status == 402 || body.contains("not_enough_credits"))
                ? "Not enough credits — add a pack on the Credits & Store screen first."
                : "Couldn't start: \(String(body.prefix(120)))"
        } catch { errorText = "Couldn't start: \(error.localizedDescription)" }
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
            tiles = await ShopCatalog.refresh(childId: auth.childSlug, api: api) ?? tiles
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
            // 86pt thumbnails: decode small. A search opens every folder, and
            // full-res decodes across hundreds of matches would jetsam the app.
            if let img = await MediaCache.shared.image(for: blobKey, maxPixel: 256) {
                image = img
            }
        }
    }
}

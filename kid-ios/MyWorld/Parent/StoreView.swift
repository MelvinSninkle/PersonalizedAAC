import SwiftUI
import StoreKit

/// Credits & Store — the iOS-compliant purchase surface.
///
/// APPLE POLICY: credits and the subscription are digital goods, so inside the
/// app they are sold ONLY through StoreKit in-app purchase (consumable packs +
/// an auto-renewable subscription). No external purchase links here. After a
/// verified purchase we post the signed transaction to /api/store?action=
/// iap-verify, which grants the credits to the parent's cross-platform wallet
/// (idempotent per transaction id — safe to re-send on relaunch).
///
/// Product ids must exist in App Store Connect:
///   credits50/100/250/500/1000 (consumables);
///   starter.monthly / plus.monthly / pro.monthly (auto-renew, ONE subscription
///   group so Apple handles upgrades/downgrades between tiers natively).
struct StoreView: View {
    @Environment(AuthManager.self) private var auth

    @State private var products: [Product] = []
    @State private var balance: Int?
    @State private var busy: String?          // product id mid-purchase
    @State private var note: String?
    @State private var loadFailed = false
    @State private var couponCode = ""
    @State private var redeeming = false
    @State private var entitlement: APIClient.StoreEntitlement?

    // Starter is retired at launch (parent feedback — relaunching later is a
    // server-side unhide + re-adding the id here + an ASC product).
    private static let productIDs = ["plus.monthly", "pro.monthly",
                                     "credits50", "credits100", "credits250", "credits500", "credits1000"]
    private let api = APIClient()

    private var memberships: [Product] { products.filter { $0.type == .autoRenewable }.sorted { $0.price < $1.price } }
    private var packs: [Product] { products.filter { $0.type != .autoRenewable }.sorted { $0.price < $1.price } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                Text("Every image you make is your family's to keep, stored safely forever, even when you change or regenerate one.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: "#fff7fb"))
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                Text("1 credit makes one picture tile. A family-member portrait uses 5 (it runs on our best likeness model). Every image includes one free retry.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)

                if products.isEmpty {
                    if loadFailed {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("The store couldn't load products right now. This can happen on a weak connection, or while the App Store catalog is updating.")
                                .font(.system(size: 14)).foregroundStyle(.secondary)
                            Button {
                                Task { await load() }
                            } label: {
                                Text("Try again")
                                    .font(.system(size: 14, weight: .bold))
                                    .padding(.horizontal, 16).padding(.vertical, 9)
                                    .background(Color(hex: "#ff1493"))
                                    .foregroundStyle(.white)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                } else {
                    if !memberships.isEmpty {
                        Text("MEMBERSHIPS")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(Color(hex: "#ad1457"))
                        Text("Every membership unlocks speech-to-text mode, automatic teaching, reporting, and data saving. They differ in monthly image credits and voice budget.")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                        ForEach(memberships, id: \.id) { p in
                            membershipRow(p)
                        }
                        // Upgrades/downgrades/cancel live in Apple's own sheet.
                        Link("Manage subscription", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                            .font(.system(size: 13, weight: .semibold))
                    }
                    Text("CREDIT PACKS")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(Color(hex: "#ad1457"))
                        .padding(.top, 4)
                    if entitlement?.tier == "free" {
                        // Packs top up a MEMBERSHIP — every styled spend
                        // checks membership before the wallet, so selling a
                        // free-tier parent credits they can't use would be
                        // taking money for nothing. Point at memberships.
                        Text("Credit packs top up a membership. Join My World Plus or Pro above first, then packs stack on top of your monthly ⭐.")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(hex: "#fff7fb"), in: RoundedRectangle(cornerRadius: 12))
                    } else {
                        ForEach(packs, id: \.id) { p in
                            productRow(p)
                        }
                    }
                }

                if let n = note {
                    Text(n).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: "#047857"))
                }

                // Coupon redeem — credits granted by a code (family gift,
                // therapist drop, promo). One use per account, server-enforced.
                HStack(spacing: 10) {
                    TextField("Have a code?", text: $couponCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(Color(.systemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#f3c6dd"), lineWidth: 2))
                    Button {
                        Task { await redeem() }
                    } label: {
                        Text(redeeming ? "…" : "Redeem")
                            .font(.system(size: 14, weight: .bold))
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .background(Color(hex: "#ad1457"))
                            .foregroundStyle(.white)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(redeeming || couponCode.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                NavigationLink { WordShopView() } label: {
                    HStack {
                        Image(systemName: "cart.fill")
                        Text("Shop words for the board")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                    }
                    .padding(14)
                    .background(Color(hex: "#fff7fb"))
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6dd"), lineWidth: 2))
                }
                .buttonStyle(.plain)

                Button("Restore purchases") { Task { await restore() } }
                    .font(.system(size: 13))
                    .padding(.top, 6)

                // Apple Review 3.1.2: the auto-renew terms + working links to
                // the Terms and Privacy Policy must live in the app.
                VStack(alignment: .leading, spacing: 8) {
                    Text("Joining builds your child's personalized starter board right away, 100+ core words plus two family portraits, charged at the lower of the build's credit price or your monthly grant; Plus invests its whole first month in the build, and Pro always finishes enrollment with at least ⭐50 remaining. Cancel anytime: everything you've made stays yours, forever. Memberships: My World Plus is $9.99/month (50 credits monthly) and My World Pro is $19.99/month (150 credits monthly). Payment is charged to your Apple ID at confirmation of purchase. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period. Manage, switch tiers, or cancel any time in Settings → Apple ID → Subscriptions. Credits are non-refundable once spent on completed images, and every image you make is yours to keep.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 14) {
                        Link("Terms of Service", destination: URL(string: "\(APIClient.defaultOrigin)/terms")!)
                        Link("Privacy Policy", destination: URL(string: "\(APIClient.defaultOrigin)/privacy")!)
                    }
                    .font(.system(size: 12, weight: .semibold))
                }
                .padding(.top, 10)
            }
            .padding(18)
        }
        .navigationTitle("Credits & Store")
        .task { await load() }
        // Warm the Word Shop's catalog cache while the parent is still on this
        // screen, so tapping "Shop words for the board" opens instantly.
        .task { await ShopCatalog.refresh(childId: auth.childSlug) }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Your credits").font(.system(size: 13)).foregroundStyle(.secondary)
                Text(balance.map { "⭐ \($0)" } ?? "⭐ …")
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
            }
            Spacer()
            if let e = entitlement {
                VStack(alignment: .trailing, spacing: 2) {
                    Text("Your plan").font(.system(size: 13)).foregroundStyle(.secondary)
                    Text(e.label)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(e.tier == "free" ? Color.secondary : Color(hex: "#047857"))
                }
            }
        }
    }

    private func membershipBlurb(_ id: String) -> String {
        switch id {
        case "starter.monthly": return "10 image credits/month · speech-to-text · auto-teach · reporting"
        case "plus.monthly":    return "joins with your whole starter board personalized up front (a ⭐120+ value) · ⭐50/month · speech-to-text · auto-teach · reporting"
        case "pro.monthly":     return "same enrollment build, and ⭐50 still yours after sign-up · ⭐150/month · biggest voice budget · new features first"
        default:                return "Membership"
        }
    }

    @ViewBuilder
    private func membershipRow(_ p: Product) -> some View {
        let isCurrent = entitlement?.tier == p.id
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(p.displayName.isEmpty ? p.id : p.displayName)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                    if isCurrent {
                        Text("CURRENT")
                            .font(.system(size: 9, weight: .heavy))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Capsule().fill(Color(hex: "#ecfdf5")))
                            .foregroundStyle(Color(hex: "#047857"))
                    }
                }
                Text(membershipBlurb(p.id))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await buy(p) }
            } label: {
                if busy == p.id { ProgressView() }
                else {
                    Text(isCurrent ? "Yours" : "\(p.displayPrice)/mo")
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 16).padding(.vertical, 9)
                        .background(isCurrent ? Color(hex: "#f3c6dd") : Color(hex: "#ff1493"))
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                }
            }
            .buttonStyle(.plain)
            .disabled(busy != nil || isCurrent)
        }
        .padding(14)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14)
            .stroke(isCurrent ? Color(hex: "#047857") : Color(hex: "#f3c6dd"), lineWidth: 2))
    }

    @ViewBuilder
    private func productRow(_ p: Product) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.displayName.isEmpty ? p.id : p.displayName)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                Text(p.description.isEmpty ? "Image credits" : p.description)
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await buy(p) }
            } label: {
                if busy == p.id { ProgressView() }
                else {
                    Text(p.displayPrice)
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 16).padding(.vertical, 9)
                        .background(Color(hex: "#ff1493"))
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                }
            }
            .buttonStyle(.plain)
            .disabled(busy != nil)
        }
        .padding(14)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#f3c6dd"), lineWidth: 2))
    }

    // MARK: -- StoreKit

    private func load() async {
        loadFailed = false
        // Product.products(for:) does NOT throw for ids it can't resolve — it
        // silently drops them, and an all-unresolved list comes back as an
        // EMPTY array. Without this guard the view stays on the spinner
        // forever (empty products + no error). StoreKit is also flaky right
        // after launch, so retry briefly before declaring failure.
        for attempt in 0..<3 {
            do {
                let fetched = try await Product.products(for: Self.productIDs)
                if !fetched.isEmpty {
                    products = fetched.sorted { $0.price < $1.price }
                    break
                }
            } catch {}
            if attempt < 2 { try? await Task.sleep(for: .seconds(attempt + 1)) }
        }
        if products.isEmpty { loadFailed = true }
        // Silently re-post current entitlements so subscription RENEWALS land
        // server-side (idempotent per transaction id) — this is what keeps the
        // membership "active" month after month without the parent doing
        // anything.
        for await entitlement in Transaction.currentEntitlements {
            if case .verified(let tx) = entitlement, tx.productType == .autoRenewable {
                _ = await api.iapVerify(jws: entitlement.jwsRepresentation,
                                        productId: tx.productID,
                                        transactionId: String(tx.id))
            }
        }
        balance = await api.storeBalance()
        entitlement = await api.storeEntitlement()
    }

    private func buy(_ p: Product) async {
        busy = p.id
        defer { busy = nil }
        do {
            let result = try await p.purchase()
            switch result {
            case .success(let verification):
                guard case .verified(let tx) = verification else { return }
                let credited = await api.iapVerify(jws: verification.jwsRepresentation,
                                                   productId: tx.productID,
                                                   transactionId: String(tx.id))
                await tx.finish()
                balance = await api.storeBalance()
                entitlement = await api.storeEntitlement()
                if let credited, credited > 0 { note = "Added ⭐\(credited). Thank you!" }
            case .userCancelled, .pending: break
            @unknown default: break
            }
        } catch {
            note = "Purchase didn't complete: \(error.localizedDescription)"
        }
    }

    private func redeem() async {
        let code = couponCode.trimmingCharacters(in: .whitespaces)
        guard !code.isEmpty else { return }
        redeeming = true
        defer { redeeming = false }
        do {
            let r = try await api.storeRedeem(code: code)
            balance = r.balance
            couponCode = ""
            note = "Added ⭐\(r.credited). Enjoy!"
        } catch let APIError.badStatus(_, body) {
            note = body.contains("already used") ? "You've already used this code."
                 : body.contains("expired") ? "That code has expired."
                 : "That code isn't valid."
        } catch {
            note = "Couldn't redeem: \(error.localizedDescription)"
        }
    }

    /// Re-sends current entitlements/unfinished transactions to the server —
    /// idempotent there, so this is always safe.
    private func restore() async {
        try? await AppStore.sync()
        for await entitlement in Transaction.currentEntitlements {
            if case .verified(let tx) = entitlement {
                _ = await api.iapVerify(jws: entitlement.jwsRepresentation,
                                        productId: tx.productID,
                                        transactionId: String(tx.id))
            }
        }
        balance = await api.storeBalance()
        note = "Purchases restored."
    }
}

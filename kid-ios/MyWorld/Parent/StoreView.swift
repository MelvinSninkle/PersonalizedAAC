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
///   credits20, credits60, credits150 (consumables), plus.monthly (auto-renew).
struct StoreView: View {
    @Environment(AuthManager.self) private var auth

    @State private var products: [Product] = []
    @State private var balance: Int?
    @State private var busy: String?          // product id mid-purchase
    @State private var note: String?
    @State private var loadFailed = false
    @State private var couponCode = ""
    @State private var redeeming = false

    private static let productIDs = ["credits20", "credits60", "credits150", "plus.monthly"]
    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                Text("Every image you make is your family's to keep — stored safely forever, even when you change or regenerate one.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: "#fff7fb"))
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                Text("1 credit makes one picture tile. A family-member portrait uses 3 (it runs on our best likeness model). Every image includes one free retry.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)

                if products.isEmpty {
                    if loadFailed {
                        Text("The store couldn't load products. Check your connection and try again — or shop on the web dashboard.")
                            .font(.system(size: 14)).foregroundStyle(.secondary)
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                } else {
                    ForEach(products, id: \.id) { p in
                        productRow(p)
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
            }
            .padding(18)
        }
        .navigationTitle("Credits & Store")
        .task { await load() }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Your credits").font(.system(size: 13)).foregroundStyle(.secondary)
                Text(balance.map { "💎 \($0)" } ?? "💎 …")
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
            }
            Spacer()
        }
    }

    @ViewBuilder
    private func productRow(_ p: Product) -> some View {
        let isSub = p.type == .autoRenewable
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.displayName.isEmpty ? p.id : p.displayName)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                Text(isSub ? "50 credits every month — packs stack on top"
                           : p.description.isEmpty ? "Image credits" : p.description)
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await buy(p) }
            } label: {
                if busy == p.id { ProgressView() }
                else {
                    Text(isSub ? "\(p.displayPrice)/mo" : p.displayPrice)
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
        do {
            products = try await Product.products(for: Self.productIDs)
                .sorted { $0.price < $1.price }
        } catch { loadFailed = true }
        balance = await api.storeBalance()
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
                if let credited, credited > 0 { note = "Added 💎\(credited) — thank you!" }
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
            note = "Added 💎\(r.credited) — enjoy!"
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

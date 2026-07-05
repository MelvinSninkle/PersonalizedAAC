package io.andrewpeterson.myworld.billing

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import io.andrewpeterson.myworld.net.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/**
 * Google Play billing — the Android twin of the iOS StoreKit path. The SERVER
 * is the source of truth: a purchase is consumed (packs) or acknowledged
 * (subscriptions) ONLY after /api/store?action=play-verify returns 200 and
 * the credits are granted. Unacknowledged/unconsumed purchases are re-posted
 * on every launch, so a crash between purchase and verify can never eat a
 * payment. On devices without Play services (Fire tablets) the connection
 * fails and [available] stays false — the store falls back to the web.
 */
class BillingClientManager(
    context: Context,
    private val api: ApiClient,
) : PurchasesUpdatedListener {

    companion object {
        val SUB_SKUS = listOf("starter.monthly", "plus.monthly", "pro.monthly")
        val PACK_SKUS = listOf("credits50", "credits100", "credits250", "credits500", "credits1000")
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _available = MutableStateFlow(false)
    val available: StateFlow<Boolean> = _available

    /** sku → details (price strings for the buttons). */
    private val _products = MutableStateFlow<Map<String, ProductDetails>>(emptyMap())
    val products: StateFlow<Map<String, ProductDetails>> = _products

    /** One-line user-facing status ("Verifying…", "⭐ 50 credits added!"). */
    private val _note = MutableStateFlow<String?>(null)
    val note: StateFlow<String?> = _note

    /** Bumps every time a verify lands so the store re-reads its catalog. */
    private val _purchaseTick = MutableStateFlow(0)
    val purchaseTick: StateFlow<Int> = _purchaseTick

    private val client = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    fun start() {
        if (client.isReady) return
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    _available.value = true
                    queryProducts()
                    // Crash-safe: re-post anything bought but never verified.
                    repostUnfinished()
                } else {
                    _available.value = false   // Fire tablets land here
                }
            }
            override fun onBillingServiceDisconnected() { _available.value = false }
        })
    }

    private fun queryProducts() {
        fun query(type: String, skus: List<String>) {
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(skus.map {
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(it).setProductType(type).build()
                })
                .build()
            client.queryProductDetailsAsync(params) { result, details ->
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    _products.value = _products.value + details.associateBy { it.productId }
                }
            }
        }
        query(BillingClient.ProductType.SUBS, SUB_SKUS)
        query(BillingClient.ProductType.INAPP, PACK_SKUS)
    }

    fun launchPurchase(activity: Activity, sku: String) {
        val pd = _products.value[sku] ?: run {
            _note.value = "That product isn't available right now."
            return
        }
        val builder = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd)
        // Subscriptions need an offer token (the base plan's default offer).
        pd.subscriptionOfferDetails?.firstOrNull()?.let { builder.setOfferToken(it.offerToken) }
        val flow = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(builder.build()))
            .build()
        client.launchBillingFlow(activity, flow)
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases?.forEach { handle(it) }
            BillingClient.BillingResponseCode.USER_CANCELED -> {}
            else -> _note.value = "Purchase didn't go through (${result.debugMessage})."
        }
    }

    private fun repostUnfinished() {
        fun sweep(type: String) {
            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(type).build()) { r, purchases ->
                if (r.responseCode == BillingClient.BillingResponseCode.OK) {
                    purchases.forEach { handle(it) }
                }
            }
        }
        sweep(BillingClient.ProductType.INAPP)
        sweep(BillingClient.ProductType.SUBS)
    }

    @Serializable
    private data class PlayVerifyResult(
        val ok: Boolean = false,
        val credited: Int = 0,
        val duplicate: Boolean = false,
        val kind: String? = null,
        val balance: Int? = null,
    )

    /** Verify server-side, THEN consume/acknowledge. Never the reverse. */
    private fun handle(purchase: Purchase) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PENDING -> {
                _note.value = "Payment pending — your credits arrive as soon as Google confirms."
                return
            }
            Purchase.PurchaseState.PURCHASED -> {}
            else -> return
        }
        val sku = purchase.products.firstOrNull() ?: return
        val isSub = sku in SUB_SKUS
        // Already acknowledged subs re-verify harmlessly (duplicate:true).
        scope.launch {
            try {
                _note.value = "Verifying your purchase…"
                val body = "{\"productId\":\"$sku\",\"purchaseToken\":\"${purchase.purchaseToken}\"}"
                val r: PlayVerifyResult = api.postRawJson("/api/store?action=play-verify", body)
                if (isSub) {
                    if (!purchase.isAcknowledged) {
                        client.acknowledgePurchase(
                            AcknowledgePurchaseParams.newBuilder()
                                .setPurchaseToken(purchase.purchaseToken).build()) { }
                    }
                } else {
                    client.consumeAsync(
                        ConsumeParams.newBuilder()
                            .setPurchaseToken(purchase.purchaseToken).build()) { _, _ -> }
                }
                _note.value = when {
                    r.credited > 0 -> "⭐ ${r.credited} credits added!"
                    r.duplicate -> null   // routine re-post — nothing to say
                    else -> "Purchase verified."
                }
                _purchaseTick.value++
            } catch (e: Exception) {
                // Leave the purchase unconsumed/unacknowledged — the next
                // launch re-posts it and the server grants idempotently.
                _note.value = "Couldn't verify the purchase yet — it will retry automatically. (${e.message})"
            }
        }
    }

    /** Localized price string for a sku ("$4.99" / "$4.99/mo"), if loaded. */
    fun price(sku: String): String? {
        val pd = _products.value[sku] ?: return null
        pd.oneTimePurchaseOfferDetails?.let { return it.formattedPrice }
        return pd.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.firstOrNull()?.formattedPrice
            ?.let { "$it/mo" }
    }
}

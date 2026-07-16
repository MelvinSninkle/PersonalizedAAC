package io.andrewpeterson.myworld.net

import io.andrewpeterson.myworld.audio.SpeechCache.Companion.jsonQuote
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonPrimitive

/**
 * Word Shop endpoints — port of the APIClient.swift store surface (browse,
 * checkout, free boards, personalize-all, coupon redeem).
 */

/** One shoppable word from the library. Serializable so it disk-caches. */
@Serializable
data class ShopTile(
    val id: String = "",
    val label: String = "",
    val column: String = "",
    val category: String? = null,
    val subcategory: String? = null,
    val previewKey: String? = null,
    val onBoard: Boolean = false,
    val personalized: Boolean = false,
    val itemId: Int? = null,
    val freeRetryUsed: Boolean = false,
    val credits: Int = 1,
    // false = store-only board priced in credits: hide from the FREE
    // common-use-boards section. Defaults true so older servers stay free.
    val freeBoard: Boolean = true,   // legacy credits-tier flag — tier retired, everything free-adds
    val storeOnly: Boolean = false,  // true = add-on board (never seeded; own shop section)
)

@Serializable
private data class ShopBrowse(val tiles: List<ShopTile> = emptyList())

suspend fun ApiClient.storeBrowse(childId: String): List<ShopTile> =
    getJson<ShopBrowse>("/api/store?action=browse&childId=${esc(childId)}").tiles

@Serializable
data class StoreCheckoutResult(
    val ok: Boolean = false,
    val charged: Int = 0,
    val queued: Int = 0,
    val balance: Int? = null,
    val note: String? = null,
)

suspend fun ApiClient.storeCheckout(childId: String, taxonomyIds: List<String>, bundle: Boolean = false): StoreCheckoutResult {
    val body = buildJsonObject {
        put("childId", childId)
        put("taxonomyIds", buildJsonArray { taxonomyIds.forEach { add(JsonPrimitive(it)) } })
        put("bundle", bundle)   // whole-folder purchases earn the 20% discount
    }
    return decode(raw("POST", "/api/store?action=checkout", body.toString().encodeToByteArray(), long = true))
}

@Serializable
data class FreeBoardResult(
    val ok: Boolean = false,
    val placed: Int? = null,
    val removed: Int? = null,
    val note: String? = null,
)

suspend fun ApiClient.storeFreeBoard(childId: String, column: String, category: String, on: Boolean): FreeBoardResult {
    val body = buildJsonObject {
        put("childId", childId); put("column", column); put("category", category); put("on", on)
    }
    return decode(raw("POST", "/api/store?action=free-board", body.toString().encodeToByteArray()))
}

@Serializable
data class PersonalizeAllResult(
    val ok: Boolean = false,
    val remaining: Int? = null,
    val total: Int? = null,
    val cost: Int? = null,
    val charged: Int? = null,
    val queued: Int? = null,
    val balance: Int? = null,
    val note: String? = null,
)

suspend fun ApiClient.storePersonalizeAll(childId: String, quote: Boolean): PersonalizeAllResult {
    val body = "{\"childId\":${jsonQuote(childId)},\"quote\":$quote}"
    return decode(raw("POST", "/api/store?action=personalize-all", body.encodeToByteArray()))
}

@Serializable
data class StoreRedeemResult(val ok: Boolean = false, val credited: Int = 0, val balance: Int = 0)

suspend fun ApiClient.storeRedeem(code: String): StoreRedeemResult {
    val body = "{\"code\":${jsonQuote(code)}}"
    return decode(raw("POST", "/api/store?action=redeem", body.encodeToByteArray()))
}

// ── Add-tile magic follow-ups (replace-existing / remake-related) ───────────
// The server keeps every unanswered follow-up (store action=followups) until
// the parent answers on ANY surface — leaving mid-question no longer orphans
// the decision.

@Serializable
data class ImpactExisting(
    val itemId: Int = 0,
    val label: String = "",
    val imageKey: String? = null,
    val isDefault: Boolean = false,
)

@Serializable
data class ImpactTile(
    val taxonomyId: String = "",
    val itemId: Int = 0,
    val label: String = "",
    val previewKey: String? = null,
)

@Serializable
data class FollowupEntry(
    val jobId: Int = 0,
    val label: String = "",
    val itemId: Int = 0,
    val imageKey: String? = null,
    val existing: ImpactExisting? = null,
    val affected: List<ImpactTile> = emptyList(),
)

@Serializable
private data class FollowupsResult(val followups: List<FollowupEntry> = emptyList())

suspend fun ApiClient.storeFollowups(childId: String): List<FollowupEntry> =
    try { getJson<FollowupsResult>("/api/store?action=followups&childId=${esc(childId)}").followups }
    catch (_: Exception) { emptyList() }

suspend fun ApiClient.storeFollowupDone(childId: String, jobId: Int) {
    val body = "{\"childId\":${jsonQuote(childId)},\"jobId\":$jobId}"
    try { raw("POST", "/api/store?action=followup-done", body.encodeToByteArray()) } catch (_: Exception) {}
}

suspend fun ApiClient.storeAdoptImage(childId: String, sourceItemId: Int, targetItemId: Int): Boolean {
    val body = "{\"childId\":${jsonQuote(childId)},\"sourceItemId\":$sourceItemId,\"targetItemId\":$targetItemId}"
    return try { raw("POST", "/api/store?action=adopt-image", body.encodeToByteArray()); true }
    catch (_: Exception) { false }
}

@Serializable
data class RegenWithResult(
    val ok: Boolean = false,
    val queued: Int = 0,
    val charged: Int = 0,
    val balance: Int? = null,
    val note: String? = null,
)

suspend fun ApiClient.storeRegenWith(childId: String, taxonomyIds: List<String>, refItemId: Int): RegenWithResult? {
    val body = buildJsonObject {
        put("childId", childId)
        put("taxonomyIds", buildJsonArray { taxonomyIds.forEach { add(JsonPrimitive(it)) } })
        put("refItemId", refItemId)
    }
    return try { decode(raw("POST", "/api/store?action=regen-with", body.toString().encodeToByteArray(), long = true)) }
    catch (_: Exception) { null }
}

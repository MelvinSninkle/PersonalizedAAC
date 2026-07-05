package io.andrewpeterson.myworld.net

import io.andrewpeterson.myworld.audio.SpeechCache.Companion.jsonQuote
import kotlinx.serialization.Serializable

/**
 * Items CRUD + the durable add-tile job queue — ports of the corresponding
 * APIClient.swift surface.
 */

@Serializable
data class TileJobStatus(
    val id: Long = 0,
    val status: String = "queued",   // queued | processing | done | failed
    val label: String? = null,
    val itemId: Long? = null,
    val imageKey: String? = null,
    val artFailed: Boolean = false,
    val needsReview: Boolean = false,
    val error: String? = null,
    val attempts: Int = 0,
)

/** PUT /api/items?id= — partial update (server COALESCEs). */
suspend fun ApiClient.updateItem(
    id: Int,
    childId: String,
    label: String? = null,
    order: Int? = null,
    categoryId: Int? = null,        // set a folder
    clearCategory: Boolean = false, // …or explicitly clear it
    pinned: Boolean? = null,
    keepAspect: Boolean? = null,
    soundKey: String? = null,
    imageKey: String? = null,
    description: String? = null,
    needsReview: Boolean? = null,
) {
    val body = buildString {
        append("{\"childId\":").append(jsonQuote(childId))
        label?.let { append(",\"label\":").append(jsonQuote(it)) }
        order?.let { append(",\"order\":").append(it) }
        if (clearCategory) append(",\"categoryId\":null")
        else categoryId?.let { append(",\"categoryId\":").append(it) }
        pinned?.let { append(",\"pinned\":").append(it) }
        keepAspect?.let { append(",\"keepAspect\":").append(it) }
        soundKey?.let { append(",\"soundKey\":").append(jsonQuote(it)) }
        imageKey?.let { append(",\"imageKey\":").append(jsonQuote(it)) }
        description?.let { append(",\"description\":").append(jsonQuote(it)) }
        needsReview?.let { append(",\"needsReview\":").append(it) }
        append('}')
    }
    raw("PUT", "/api/items?id=$id", body.encodeToByteArray())
}

suspend fun ApiClient.deleteItem(id: Int, childId: String) {
    raw("DELETE", "/api/items?id=$id&childId=${esc(childId)}")
}

/** POST /api/upload — raw bytes → private blob key. */
@Serializable
data class UploadResult(val key: String = "")
suspend fun ApiClient.upload(kind: String, ext: String, bytes: ByteArray, contentType: String): String {
    val r = raw("POST", "/api/upload?kind=${esc(kind)}&ext=${esc(ext)}", bytes, contentType = contentType)
    return decode<UploadResult>(r).key
}

/**
 * POST /api/tile-jobs — enqueue a photo→tile job (durable server-side: the
 * photo is SAFE the instant this returns). Query params mirror iOS
 * createTileJob; body = raw JPEG bytes.
 */
@Serializable
data class TileJobCreated(val id: Long = 0, val status: String = "queued")
suspend fun ApiClient.createTileJob(
    childId: String,
    jpeg: ByteArray,
    label: String,
    detail: String,
    section: String,
    categoryId: Int?,
    raw: Boolean,
    relationship: String? = null,
): TileJobCreated {
    var path = "/api/tile-jobs?childId=${esc(childId)}&label=${esc(label)}&detail=${esc(detail)}" +
        "&section=${esc(section)}&style=${esc("soft, friendly children's illustration")}"
    categoryId?.let { path += "&categoryId=$it" }
    if (raw) path += "&raw=1"
    relationship?.let { path += "&relationship=${esc(it)}" }
    return decode(this.raw("POST", path, jpeg, contentType = "image/jpeg", long = true))
}

@Serializable
private data class TileJobsList(val jobs: List<TileJobStatus> = emptyList())

suspend fun ApiClient.listTileJobs(childId: String): List<TileJobStatus> =
    getJson<TileJobsList>("/api/tile-jobs?childId=${esc(childId)}").jobs

suspend fun ApiClient.deleteTileJob(id: Long, childId: String) {
    raw("DELETE", "/api/tile-jobs?id=$id&childId=${esc(childId)}")
}

/** POST /api/describe-image — vision naming for a photo. */
@Serializable
data class DescribeResult(val label: String? = null, val pronunciation: String? = null)
suspend fun ApiClient.describeImage(jpeg: ByteArray): DescribeResult =
    decode(raw("POST", "/api/describe-image", jpeg, contentType = "image/jpeg", long = true))

/** POST /api/store?action=retry — guided redraw (1st free, then 1 credit). */
suspend fun ApiClient.storeRetry(childId: String, itemId: Int, guidance: String) {
    val body = "{\"childId\":${jsonQuote(childId)},\"itemId\":$itemId,\"guidance\":${jsonQuote(guidance)}}"
    raw("POST", "/api/store?action=retry", body.encodeToByteArray())
}

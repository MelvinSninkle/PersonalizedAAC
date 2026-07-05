package io.andrewpeterson.myworld.net

import io.andrewpeterson.myworld.audio.SpeechCache.Companion.jsonQuote
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject

/**
 * Parent-app stats + membership endpoints — port of `Parent/ParentAPI.swift`
 * (M9 slice: analytics, top words, word history, input methods, band advance,
 * store catalog read). Auto-teach state / album / schedules land with M10.
 */

// ── /api/analytics — the server PRE-FORMATS everything for display ─────────

@Serializable
data class MasteryRow(val name: String = "", val pct: Int = 0)

@Serializable
data class SessionRow(
    val date: String? = null,
    val mode: String? = null,
    val category: String? = null,
    val result: String? = null,
    val length: String? = null,
)

@Serializable
data class UseSeries(val name: String = "", val data: List<Int> = emptyList())

@Serializable
data class GameSeries(val name: String = "", val data: List<Double> = emptyList())

@Serializable
data class ModeSeries(
    val name: String = "",
    val mode: String = "",
    val data: List<Double> = emptyList(),
)

data class AnalyticsResponse(
    val labels: List<String> = emptyList(),
    val mastery: List<MasteryRow> = emptyList(),
    val recentSessions: List<SessionRow> = emptyList(),
    val useSeries: List<UseSeries> = emptyList(),
    val gameSeries: List<GameSeries> = emptyList(),
    val modeSeries: List<ModeSeries> = emptyList(),
)

@Serializable
private data class SeriesEnvelope<T>(val series: List<T> = emptyList())

/**
 * Forgiving decode, section by section — the endpoint may degrade any single
 * section to [] / null on error and one weak signal must never hide the rest
 * (mirror of the Swift custom decoder).
 */
suspend fun ApiClient.analytics(childId: String, bucket: String = "day"): AnalyticsResponse {
    val bytes = raw("GET", "/api/analytics?childId=${esc(childId)}&bucket=${esc(bucket)}")
    val root = try {
        Json.parseToJsonElement(bytes.decodeToString()).jsonObject
    } catch (e: Exception) {
        throw ApiClient.ApiError.Decoding(e)
    }
    val j = ApiClient.json
    fun <T> section(key: String, parse: (JsonElement) -> T, empty: T): T =
        root[key]?.let { el -> try { parse(el) } catch (_: Exception) { empty } } ?: empty
    return AnalyticsResponse(
        labels = section("labels", { j.decodeFromJsonElement(it) }, emptyList()),
        mastery = section("mastery", { j.decodeFromJsonElement(it) }, emptyList()),
        recentSessions = section("recentSessions", { j.decodeFromJsonElement(it) }, emptyList()),
        useSeries = section("use", { j.decodeFromJsonElement<SeriesEnvelope<UseSeries>>(it).series }, emptyList()),
        gameSeries = section("games", { j.decodeFromJsonElement<SeriesEnvelope<GameSeries>>(it).series }, emptyList()),
        modeSeries = section("gamesByMode", { j.decodeFromJsonElement<SeriesEnvelope<ModeSeries>>(it).series }, emptyList()),
    )
}

// ── /api/top-words ──────────────────────────────────────────────────────────

@Serializable
data class TopWord(
    val label: String = "",
    val count: Int = 0,
    val category: String? = null,
    val section: String? = null,
    val firstAt: String = "",
    val lastAt: String = "",
)

@Serializable
data class TopWordsResponse(val rows: List<TopWord> = emptyList(), val days: Int = 30)

suspend fun ApiClient.topWords(childId: String, days: Int = 30, limit: Int = 100): TopWordsResponse =
    getJson("/api/top-words?childId=${esc(childId)}&days=$days&limit=$limit")

// ── /api/word-history — searchable tap log, 200 a page ─────────────────────

@Serializable
data class WordEvent(
    val id: Int = 0,
    val label: String = "",
    val category: String? = null,
    val section: String? = null,
    @SerialName("when") val whenAt: String = "",
)

@Serializable
data class WordHistoryResponse(val rows: List<WordEvent> = emptyList(), val hasMore: Boolean = false)

suspend fun ApiClient.wordHistory(
    childId: String,
    query: String?,
    sinceIso: String?,
    untilIso: String?,
    limit: Int = 200,
    offset: Int = 0,
): WordHistoryResponse {
    var path = "/api/word-history?childId=${esc(childId)}&limit=$limit&offset=$offset"
    query?.trim()?.takeIf { it.isNotEmpty() }?.let { path += "&q=${esc(it)}" }
    sinceIso?.let { path += "&since=${esc(it)}" }
    untilIso?.let { path += "&until=${esc(it)}" }
    return getJson(path)
}

// ── /api/input-methods — how the child answers over time ───────────────────

@Serializable
data class InputMethodSeries(val method: String = "", val data: List<Int> = emptyList())

@Serializable
data class InputMethodCorrect(val ok: Int = 0, val total: Int = 0)

@Serializable
data class InputMethodsResponse(
    val totals: Map<String, Int> = emptyMap(),
    val correctBy: Map<String, InputMethodCorrect> = emptyMap(),
    val buckets: List<String> = emptyList(),
    val series: List<InputMethodSeries> = emptyList(),
)

suspend fun ApiClient.inputMethods(childId: String, days: Int = 30): InputMethodsResponse =
    getJson("/api/input-methods?childId=${esc(childId)}&days=$days")

// ── /api/advance-band — vocabulary level ────────────────────────────────────

@Serializable
data class BandMastery(
    val correct: Int = 0,
    val total: Int = 0,
    val ready: Boolean = false,
    val lookbackDays: Int = 0,
    val minAttempts: Int = 0,
)

@Serializable
data class BandStatus(
    val current: String? = null,
    val natural: String? = null,
    val advanced: String? = null,
    val next: String? = null,
    val readyToAdvance: Boolean? = null,
    val mastery: BandMastery? = null,
)

suspend fun ApiClient.bandStatus(childId: String): BandStatus =
    getJson("/api/advance-band?childId=${esc(childId)}")

suspend fun ApiClient.advanceBand(childId: String) {
    val body = "{\"childId\":${jsonQuote(childId)},\"reason\":\"parent\"}"
    raw("POST", "/api/advance-band", body.encodeToByteArray())
}

// ── /api/album — picture memorabilia, grouped by tile ──────────────────────

@Serializable
data class AlbumEntry(
    val label: String? = null,
    val section: String? = null,
    val blobKey: String = "",
    @SerialName("when") val whenAt: String? = null,
    val kind: String? = null,        // 'current' | 'history'
)

@Serializable
data class AlbumTile(
    val itemId: Int? = null,
    val label: String? = null,
    val section: String? = null,
    val current: AlbumEntry? = null,
    val history: List<AlbumEntry> = emptyList(),
)

@Serializable
private data class AlbumByTileResponse(val tiles: List<AlbumTile> = emptyList())

suspend fun ApiClient.albumByTile(childId: String, limit: Int = 600): List<AlbumTile> =
    getJson<AlbumByTileResponse>("/api/album?childId=${esc(childId)}&mode=by-tile&limit=$limit").tiles

// ── /api/store?action=catalog — balance + membership (read-only in M9) ─────

@Serializable
data class StoreVoiceUsage(val used: Int = 0, val cap: Int? = null)

@Serializable
data class StoreEntitlement(
    val tier: String = "free",
    val label: String = "Free",
    val source: String = "",
    val voice: StoreVoiceUsage? = null,
)

@Serializable
data class StoreSubscription(
    val sku: String = "",
    val label: String = "",
    val cents: Int = 0,
    val creditsPerPeriod: Int = 0,
)

@Serializable
data class StorePack(
    val sku: String = "",
    val label: String = "",
    val credits: Int = 0,
    val cents: Int = 0,
)

@Serializable
data class StoreCatalog(
    val balance: Int? = null,
    val entitlement: StoreEntitlement? = null,
    val subscriptions: List<StoreSubscription> = emptyList(),
    val packs: List<StorePack> = emptyList(),
)

suspend fun ApiClient.storeCatalog(): StoreCatalog = getJson("/api/store?action=catalog")

// ── /api/auth/delete-account — type-DELETE confirmation lives in the UI ────

suspend fun ApiClient.deleteAccount() {
    raw("POST", "/api/auth/delete-account", "{\"confirm\":\"DELETE\"}".encodeToByteArray())
}

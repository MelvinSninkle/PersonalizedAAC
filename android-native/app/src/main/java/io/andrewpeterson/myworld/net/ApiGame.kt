package io.andrewpeterson.myworld.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/**
 * Game/teaching wire models — the /api/game-log payload (byte-identical to
 * the iOS `APIClient.GameLogPayload`, scoringVersion 2 mercy semantics),
 * exposure ticks, and the auto-teach picker contract.
 */

@Serializable
data class GameLogPayload(
    val childId: String,
    val mode: String,
    val category: String? = null,
    val startedAt: String,
    val endedAt: String,
    val itemCount: Int,
    val slidesAttempted: Int,
    val correctCount: Int,
    val scoringVersion: Int = 2,
    val endReason: String,
    val skillSlug: String? = null,
    val attempts: List<Attempt>,
) {
    @Serializable
    data class Attempt(
        val itemId: Int? = null,
        val label: String,
        val category: String? = null,
        val taxonomySlug: String? = null,
        val correct: Boolean,
        val inputMethod: String,
        val misses: Int,
        val attemptsTaken: Int,
        val distractorCount: Int,
        val childGenerated: Boolean,
        val occurredAt: String,
    )
}

/** Fire-and-forget session log — a failure never blocks celebration/exit. */
suspend fun ApiClient.submitGameLog(payload: GameLogPayload) {
    postSilently("/api/game-log", ApiClient.json.encodeToString(payload))
}

/** One skill exposure tick (arms auto-teach cooldown/budget on auto_* sources). */
suspend fun ApiClient.tickExposure(childId: String, skillSlug: String, source: String) {
    postSilently(
        "/api/exposure-tick",
        """{"childId":${io.andrewpeterson.myworld.audio.SpeechCache.jsonQuote(childId)},"skillSlug":${io.andrewpeterson.myworld.audio.SpeechCache.jsonQuote(skillSlug)},"source":${io.andrewpeterson.myworld.audio.SpeechCache.jsonQuote(source)}}""",
    )
}

// ── Auto-teach picker (POST /api/auto-teach/next) ────────────────────────────

@Serializable
data class AutoTeachTile(val slug: String = "")

@Serializable
data class AutoTeachSession(
    val microSec: Double = 5.0,
    val sessionMaxMin: Double = 5.0,
    val labelStyle: String = "first_person",
    val source: String = "auto_slideshow",
)

@Serializable
data class AutoTeachNextResponse(
    val ok: Boolean = false,
    val reason: String? = null,
    val mode: String? = null,
    val tiles: List<AutoTeachTile>? = null,
    val session: AutoTeachSession? = null,
)

suspend fun ApiClient.autoTeachNext(childId: String, mode: String, tz: String): AutoTeachNextResponse {
    val body = """{"childId":${io.andrewpeterson.myworld.audio.SpeechCache.jsonQuote(childId)},"mode":${io.andrewpeterson.myworld.audio.SpeechCache.jsonQuote(mode)},"tz":${io.andrewpeterson.myworld.audio.SpeechCache.jsonQuote(tz)}}"""
    return postRawJson("/api/auto-teach/next", body)
}

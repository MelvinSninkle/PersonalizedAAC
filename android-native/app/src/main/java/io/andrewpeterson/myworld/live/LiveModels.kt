package io.andrewpeterson.myworld.live

import kotlinx.serialization.Serializable

/**
 * Wire models for the /api/live facilitator channel — ports of
 * `Live/LiveSession.swift` Codable structs. Field names MUST stay byte-
 * identical to what the web therapist console + parent apps read/write.
 */

@Serializable
data class LiveCommand(
    val seq: Int = 0,
    val action: String? = null,       // start | next | mark | skip | end | listen-start | listen-stop | message
    val method: String? = null,       // verbal | physical | object | gesture (for mark)
    val mode: String? = null,         // matching | slideshow | teach_slideshow | clue_quiz | …
    val scope: String? = null,        // "cat:123" | section | "all" | "slugs:a,b"
    val choices: Int? = null,
    val from: Double? = null,
    val to: Double? = null,
    val sample: Double? = null,
    val limitMin: Double? = null,
    val secondsPerImage: Double? = null,
    val labelStyle: String? = null,   // plain | first_person
    val music: String? = null,
    val steps: List<RoutineStep>? = null,
    /** Mercy bridge: facilitator's "the kid took N tries before I marked". */
    val attemptsTaken: Int? = null,
    val ts: Double? = null,
    val text: String? = null,
    val tokens: List<MessageToken>? = null,
)

/** One step of a parent's message-to-the-board sequence. */
@Serializable
data class MessageToken(
    val word: String = "",
    val itemId: Int? = null,
    val imageKey: String? = null,
    val soundKey: String? = null,
    val text: Boolean? = null,
    val holdMs: Double? = null,
)

/** One routine step (child_settings.routines round-trip). */
@Serializable
data class RoutineStep(
    val mode: String? = null,
    val scope: String? = null,
    val choices: Int? = null,
    val from: Double? = null,
    val to: Double? = null,
    val sample: Double? = null,
    val limitMin: Double? = null,
    val secondsPerImage: Double? = null,
    val music: String? = null,
)

/** What the tablet publishes back — exactly what therapist.html renders. */
@Serializable
data class LivePayload(
    val target: Target? = null,
    val i: Int? = null,
    val total: Int? = null,
    val correctCount: Int? = null,
) {
    @Serializable
    data class Target(val label: String = "", val imageKey: String? = null)
}

@Serializable
data class LiveStatus(
    val status: String = "idle",
    val cmd: LiveCommand? = null,
    val cmdSeq: Int = 0,
    val age: Int? = null,
    val payload: LivePayload? = null,
)

package io.andrewpeterson.myworld.net

import io.andrewpeterson.myworld.audio.SpeechCache.Companion.jsonQuote
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * /api/onboarding/* wire surface — port of `Parent/OnboardingAPI.swift`
 * (email/password only on Android; the Apple path has no twin here).
 */

data class OnboardingStateResult(
    val step: String,
    val completed: List<String>,
    val childId: String?,
    /** Loose bag — only a few string keys surface back to the UI. */
    val data: Map<String, String>,
)

suspend fun ApiClient.onboardingState(): OnboardingStateResult {
    val root = Json.parseToJsonElement(raw("GET", "/api/onboarding/state").decodeToString()).jsonObject
    return OnboardingStateResult(
        step = (root["step"] as? JsonPrimitive)?.contentOrNull ?: "account",
        completed = (root["completed"] as? kotlinx.serialization.json.JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList(),
        childId = (root["childId"] as? JsonPrimitive)?.contentOrNull,
        data = ((root["data"] as? JsonObject) ?: emptyMap<String, kotlinx.serialization.json.JsonElement>())
            .mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }.toMap(),
    )
}

@Serializable
data class OnboardingStyle(val id: Int = 0, val label: String = "", val description: String? = null)

@Serializable
private data class OnboardingStylesResult(val styles: List<OnboardingStyle> = emptyList())

/** Active style guides the parent can pick from (read-only). */
suspend fun ApiClient.onboardingStyles(): List<OnboardingStyle> =
    getJson<OnboardingStylesResult>("/api/onboarding/styles").styles

/** Preview image bytes for a style guide (auth-gated proxy). */
suspend fun ApiClient.onboardingStyleImage(id: Int): ByteArray =
    raw("GET", "/api/onboarding/styles?image=$id")

@Serializable
data class OnboardingVoice(
    val id: String = "",
    val name: String = "",
    val description: String? = null,
    val previewUrl: String? = null,
)

@Serializable
private data class OnboardingVoicesResult(val voices: List<OnboardingVoice> = emptyList())

suspend fun ApiClient.onboardingVoices(): List<OnboardingVoice> =
    getJson<OnboardingVoicesResult>("/api/onboarding/voices").voices

/** POST the child step: name + birthday + tier + language + style + voice
 *  (+ favorite color — the server turns it into the banner colors). */
suspend fun ApiClient.onboardingChild(
    name: String,
    birthDate: String,      // "yyyy-MM-dd"
    tier: String,
    language: String,
    voiceId: String?,
    styleGuideId: Int?,
    favoriteColor: String? = null,   // "#rrggbb"
) {
    val body = buildJsonObject {
        put("name", name)
        put("birthDate", birthDate)
        put("tier", tier)
        put("language", language)
        voiceId?.takeIf { it.isNotEmpty() }?.let { put("voiceId", it) }
        styleGuideId?.let { put("styleGuideId", it) }
        favoriteColor?.takeIf { it.isNotEmpty() }?.let { put("favoriteColor", it) }
    }
    raw("POST", "/api/onboarding/child", body.toString().encodeToByteArray())
}

@Serializable
private data class OnboardingDraftResult(val ok: Boolean = false, val draftKey: String? = null)

/** Stylize a raw JPEG → DRAFT blob key (doesn't commit; retries are free). */
suspend fun ApiClient.onboardingPhotoDraft(jpeg: ByteArray, styleGuideId: Int?): String {
    var path = "/api/onboarding/family?action=draft"
    styleGuideId?.let { path += "&styleGuideId=$it" }
    val r = decode<OnboardingDraftResult>(raw("POST", path, jpeg, contentType = "image/jpeg", long = true))
    return r.draftKey ?: throw ApiClient.ApiError.Decoding(IllegalStateException("no draftKey"))
}

/** Re-stylize from the cached source bytes — same photo, different roll. */
suspend fun ApiClient.onboardingPhotoRetry(draftKey: String, attempt: Int, styleGuideId: Int?): String {
    val body = buildJsonObject {
        put("draftKey", draftKey)
        put("attempt", attempt)
        styleGuideId?.let { put("styleGuideId", it) }
    }
    val r = decode<OnboardingDraftResult>(
        raw("POST", "/api/onboarding/family?action=retry", body.toString().encodeToByteArray(), long = true))
    return r.draftKey ?: throw ApiClient.ApiError.Decoding(IllegalStateException("no draftKey"))
}

/** Promote a chosen draft: reference_key + People tile. role = child|parent. */
suspend fun ApiClient.onboardingPhotoCommit(draftKey: String, role: String, name: String, relationship: String?) {
    val body = buildJsonObject {
        put("draftKey", draftKey)
        put("role", role)
        put("name", name)
        relationship?.takeIf { it.isNotEmpty() }?.let { put("relationship", it) }
    }
    raw("POST", "/api/onboarding/family?action=commit", body.toString().encodeToByteArray())
}

@Serializable
data class OnboardingSeedResult(
    val ok: Boolean = false,
    val queuedCount: Int = 0,
    val slugs: List<String> = emptyList(),
    val message: String? = null,
)

suspend fun ApiClient.onboardingSeedCore(styleGuideId: Int?): OnboardingSeedResult {
    var path = "/api/onboarding/seed-core"
    styleGuideId?.let { path += "?styleGuideId=$it" }
    // Renders ~13 tiles server-side before responding — long timeout.
    return decode(raw("POST", path, ByteArray(0), long = true))
}

suspend fun ApiClient.onboardingComplete() {
    try { raw("POST", "/api/onboarding/complete") } catch (_: Exception) {}
}

/** Create an email/password account (COPPA consent recorded server-side). */
suspend fun ApiClient.registerAccount(email: String, password: String) {
    val body = "{\"email\":${jsonQuote(email)},\"password\":${jsonQuote(password)}," +
        "\"role\":\"parent\",\"consent\":true,\"consentVersion\":\"2026-07\"}"
    raw("POST", "/api/auth/register", body.encodeToByteArray())
}

package io.andrewpeterson.myworld.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * /api/parent/style — the parent-facing window into the art-style machine
 * (port of APIClient.swift's style helpers). Shows the guide currently
 * driving renders with its EXACT reference-image URLs, lists every public
 * template for the switcher, points the child at a template, or sets one
 * reference on the child's own family guide. Reference URLs are relative,
 * auth-gated paths — fetch them with [imageBytes].
 */

@Serializable
data class StyleRefs(
    val main: String? = null,
    val person: String? = null,
    val stuff: String? = null,
)

@Serializable
data class StyleGuideInfo(
    val id: Int = 0,
    val label: String = "",
    val description: String? = null,
    val source: String? = null,     // "family" | "template" (current guide only)
    val imageUrl: String? = null,
    val previewUrl: String? = null, // templates' polished preview
    val refs: StyleRefs? = null,
)

@Serializable
data class StyleOverview(
    val styleGuide: StyleGuideInfo? = null,
    val styles: List<StyleGuideInfo> = emptyList(),
)

suspend fun ApiClient.styleOverview(childId: String): StyleOverview =
    getJson("/api/parent/style?childId=${esc(childId)}")

/** Point the board at a template — new pictures only; the UI warns first. */
suspend fun ApiClient.setStyle(childId: String, styleGuideId: Int) {
    val body = buildJsonObject { put("action", "set"); put("styleGuideId", styleGuideId) }
    raw("POST", "/api/parent/style?childId=${esc(childId)}", body.toString().encodeToByteArray())
}

/** Set one reference (main/person/stuff) on the child's OWN family guide
 *  from a blob uploaded via upload(kind = "styleref"). */
suspend fun ApiClient.setStyleRef(childId: String, kind: String, blobKey: String) {
    val body = buildJsonObject { put("action", "upload"); put("kind", kind); put("blobKey", blobKey) }
    raw("POST", "/api/parent/style?childId=${esc(childId)}", body.toString().encodeToByteArray())
}

/** GET an authenticated same-origin image path (e.g. a style-ref URL). */
suspend fun ApiClient.imageBytes(path: String): ByteArray? = try {
    raw("GET", if (path.startsWith("/")) path else "/$path")
} catch (_: Exception) { null }

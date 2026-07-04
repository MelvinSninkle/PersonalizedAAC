package io.andrewpeterson.myworld.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Shared brand palette — the exact hexes from kid-ios `Models/Brand.swift`,
 * which are themselves kept in lockstep with the web CSS custom properties.
 * A facilitator moving between web, iPad, and Android never relearns a color.
 */
object Brand {
    // Pink primaries
    val pink = Color(0xFFFF1493)        // --pink
    val pinkDeep = Color(0xFFAD1457)    // --pink-deep
    val pinkMid = Color(0xFFC2185B)     // --pink-mid
    // Neutrals
    val ink = Color(0xFF1F2937)         // --ink
    val muted = Color(0xFF6B7280)       // --muted
    val faint = Color(0xFF9CA3AF)       // --faint
    // Surfaces
    val line = Color(0xFFFCE4EC)        // --line
    val bg = Color(0xFFFDF2F8)          // --bg
    val card = Color(0xFFFFFFFF)        // --card
    // Status
    val good = Color(0xFF16A34A)        // --good
    val goodBg = Color(0xFFECFDF5)
    val goodInk = Color(0xFF047857)
    val goodLine = Color(0xFFBBF7D0)
    // Facilitator marks (identical to the web therapist console)
    val tapInk = Color(0xFF1D4ED8)
    val verbalInk = Color(0xFF047857)
    val objectInk = Color(0xFF6D28D9)
    // Controls
    val skipBg = Color(0xFFFFF0F6)
    val nextBg = Color(0xFFEEF2FF)
    val nextInk = Color(0xFF4338CA)
    // Board section bands (BoardSection.swift)
    val bandPeople = Color(0xFFFCE4EC)
    val bandNouns = Color(0xFFFFF59D)
    val bandVerbs = Color(0xFFFCE4EC)
    val bandNeeds = Color(0xFFFFD400)
}

/** "#ff1493" / "ff1493" → Color, mirroring the iOS `Color(hex:)` extension. */
fun hexColor(hex: String, fallback: Color = Brand.ink): Color {
    val s = hex.removePrefix("#").trim()
    if (s.length != 6) return fallback
    val v = s.toLongOrNull(16) ?: return fallback
    return Color(0xFF000000 or v)
}

/**
 * "people.community.workers" → "People › Community › Workers" — parents get
 * readable breadcrumbs from taxonomy skill slugs (port of Brand.swift).
 */
fun prettySkillName(slug: String): String {
    val special = mapOf("expr" to "Expressive", "more" to "More", "extra" to "Extra")
    return slug.split('.').joinToString(" › ") { seg ->
        special[seg] ?: seg.replaceFirstChar { it.uppercaseChar() }
    }
}

private val LightColors = lightColorScheme(
    primary = Brand.pink,
    onPrimary = Color.White,
    secondary = Brand.pinkDeep,
    onSecondary = Color.White,
    background = Brand.bg,
    onBackground = Brand.ink,
    surface = Brand.card,
    onSurface = Brand.ink,
    surfaceVariant = Brand.line,
    onSurfaceVariant = Brand.muted,
    error = Color(0xFFDC2626),
)

/** Light-only (the iOS app pins `.preferredColorScheme(.light)`), no dynamic color. */
@Composable
fun MyWorldTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_EXPRESSION") isSystemInDarkTheme()   // deliberately ignored
    MaterialTheme(colorScheme = LightColors, content = content)
}

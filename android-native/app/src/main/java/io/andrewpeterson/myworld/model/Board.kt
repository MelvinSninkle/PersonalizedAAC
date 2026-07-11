package io.andrewpeterson.myworld.model

import androidx.compose.ui.graphics.Color
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Board data models — ports of kid-ios `Models/` structs, mirroring
 * `rowToItem`/`rowToCategory` in api/_lib/db.js so `/api/sync` JSON decodes
 * directly (lenient: unknown keys ignored, missing optionals defaulted —
 * matching the Swift custom decoders).
 */

@Serializable
enum class BoardSection(val raw: String) {
    @SerialName("people") PEOPLE("people"),
    @SerialName("nouns") NOUNS("nouns"),
    @SerialName("verbs") VERBS("verbs"),
    @SerialName("needs") NEEDS("needs");

    val displayLabel: String
        get() = when (this) {
            PEOPLE -> "People"; NOUNS -> "Nouns"; VERBS -> "Verbs"; NEEDS -> "Needs"
        }

    val bandColor: Color
        get() = when (this) {
            PEOPLE -> Brand.bandPeople
            NOUNS -> Brand.bandNouns
            VERBS -> Brand.bandVerbs
            NEEDS -> Brand.bandNeeds
        }

    companion object {
        fun from(raw: String?): BoardSection =
            entries.firstOrNull { it.raw == raw?.lowercase() } ?: NOUNS
    }
}

/** One item / tile / button on the board (Tile.swift). */
@Serializable
data class Tile(
    val id: Int,
    val section: BoardSection = BoardSection.NOUNS,
    val categoryId: Int? = null,
    val label: String = "",
    /** Board-language translation from /api/sync (null on English boards).
     *  `label` stays the canonical English identity; render [display]. */
    val displayLabel: String? = null,
    val imageKey: String? = null,
    val imageUrl: String? = null,
    val soundKey: String? = null,
    val soundUrl: String? = null,
    val keepAspect: Boolean = false,
    val order: Int = 0,
    val pinned: Boolean = false,
    val childId: String? = null,
    val ownerUserId: Int? = null,
    val taxonomySlug: String? = null,
    /** Auditory-comprehension audio prompt ("lives in a field, eats grass"). */
    val description: String? = null,
    /** Teaching clues, easiest first — spoken by "Teach me" after the word. */
    val descriptiveClues: List<String>? = null,
    /** Bulk-imported tile awaiting parent review (already live on the board). */
    val needsReview: Boolean = false,
)

/** A category / folder chip (Category.swift). */
@Serializable
data class Category(
    val id: Int,
    val section: BoardSection = BoardSection.NOUNS,
    val label: String = "",
    /** Board-language translation from /api/sync (null on English boards). */
    val displayLabel: String? = null,
    val parentId: Int? = null,
    val imageKey: String? = null,
    val imageUrl: String? = null,
    val keepAspect: Boolean = false,
    val order: Int = 0,
    val childId: String? = null,
    val ownerUserId: Int? = null,
    val taxonomySlug: String? = null,
    /** "location" → children render as room tiles; "room" → long-press opens interior. */
    val kind: String? = null,
) {
    val isLocation: Boolean get() = kind == "location"
    val isRoom: Boolean get() = kind == "room"
    /** The ONE exception to the guillotine rule — a folder named "TV". */
    val isPoster: Boolean get() = categoryNameIsPoster(label)
}

/**
 * True when a folder name marks it as the TV/movies poster shelf — its tiles
 * render in natural rectangular aspect. Word-match on "tv"/"tvs" ONLY; every
 * other folder center-crops square (Category.swift parity).
 */
fun categoryNameIsPoster(label: String): Boolean {
    val words = label.lowercase().split(Regex("[^a-z]+")).filter { it.isNotEmpty() }
    return "tv" in words || "tvs" in words
}

/** Membership flags from /api/sync (APIClient.Entitlement parity). */
@Serializable
data class Entitlement(
    val tier: String = "free",
    val label: String = "Free",
    val stt: Boolean = true,
    val autoTeach: Boolean = true,
    val styling: Boolean = true,
)

@Serializable
data class SyncResponse(
    val categories: List<Category> = emptyList(),
    val items: List<Tile> = emptyList(),
    val entitlement: Entitlement? = null,
)

/**
 * Shared layout constants (BoardMetrics.swift) — ONE source of tile-sizing
 * truth so every tile across the whole board comes out the same size.
 * Values are in dp; BoardView does the math in dp space.
 */
object BoardMetrics {
    const val TILE_GAP = 8f
    const val COLUMN_PAD = 6f
    const val DIVIDER_WIDTH = 1f
    /** Default-density board = 8 tiles across total (2+4+2). */
    const val REFERENCE_ACROSS = 8f
    /** Never shrink a tile below this even on a packed board. */
    const val MIN_TILE = 44f

    /** Exact width a column occupies for `across` tiles at `tile` dp. */
    fun columnWidth(across: Int, tile: Float): Float {
        val a = maxOf(1, across)
        return a * tile + (a - 1) * TILE_GAP + 2 * COLUMN_PAD
    }
}

/** What the child sees and hears named on the board. */
val Tile.display: String get() = displayLabel ?: label
val Category.display: String get() = displayLabel ?: label

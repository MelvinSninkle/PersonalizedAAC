package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.BoardMetrics
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * The full-width Needs strip along the board's bottom — the most-used words
 * (yes, no, more, all done…) one tap away no matter which column has focus.
 * Port of `Views/NeedsStrip.swift`.
 */
@Composable
fun NeedsStrip(
    tileSize: Dp,
    editMode: Boolean = false,
    onEditTile: (Tile) -> Unit = {},
    onAdd: (() -> Unit)? = null,
) {
    val c = LocalAppContainer.current
    val prefs by c.displayPrefs.data.collectAsState()
    val allTiles by c.board.tiles.collectAsState()

    val tiles = allTiles.filter { it.section == BoardSection.NEEDS }
        .sortedWith(compareByDescending<Tile> { it.pinned }.thenBy { it.order }.thenBy { it.id })

    if (tiles.isEmpty() && !editMode) return

    // Height hugs content: square image + label band + padding, no dead space.
    val stripHeight = tileSize + (if (prefs.hideLabels) 0.dp else 24.dp) + 16.dp

    Row(
        Modifier
            .fillMaxWidth()
            .height(stripHeight)
            .background(hexColor(prefs.colorNeeds))
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = BoardMetrics.COLUMN_PAD.dp, vertical = 8.dp),
    ) {
        tiles.forEach { tile ->
            TileView(
                tile, tileSize, prefs.hideLabels,
                onTap = { c.tilePlayer.play(it, childId = c.auth.childSlug, categoryName = "Needs") },
                editMode = editMode, onEdit = onEditTile,
            )
            Spacer(Modifier.width(BoardMetrics.TILE_GAP.dp))
        }
        if (editMode && onAdd != null) {
            AddTileCell(tileSize, onAdd)
        }
    }
}

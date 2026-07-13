package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
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

    val access by c.access.data.collectAsState()
    // Height hugs content: square image + label band + padding, no dead space.
    val stripHeight = tileSize + (if (prefs.hideLabels) 0.dp else 24.dp) + 16.dp
    val dropZonePx = with(LocalDensity.current) { 140.dp.toPx() }
    var page by remember { mutableStateOf(0) }

    // Sentence lift float state (same pattern as the tile grid's edit drag).
    var dragId by remember { mutableStateOf<Int?>(null) }
    var dragOrigin by remember { mutableStateOf(Offset.Zero) }
    var dragPos by remember { mutableStateOf(Offset.Zero) }
    val cellCenters = remember { mutableMapOf<Int, Offset>() }

    fun tap(t: Tile) {
        if (c.sentenceBar.consumeJustStaged(t.id)) return   // hold already staged this touch
        c.tilePlayer.play(t, childId = c.auth.childSlug, categoryName = "Needs")
    }

    val needsCell: @Composable (Tile) -> Unit = { tile ->
        val sentenceOn = access.sentenceBuilder && !editMode
        Box(
            Modifier
                .onGloballyPositioned { if (dragId != tile.id) cellCenters[tile.id] = it.boundsInRoot().center }
                .graphicsLayer {
                    if (dragId == tile.id) {
                        translationX = dragPos.x - dragOrigin.x
                        translationY = dragPos.y - dragOrigin.y
                        scaleX = 1.06f; scaleY = 1.06f; alpha = 0.85f
                    }
                }
                .then(if (sentenceOn) Modifier.pointerInput(tile.id, access.sentenceLift) {
                    if (access.sentenceLift == "drag") {
                        val start: (Offset) -> Unit = {
                            dragOrigin = cellCenters[tile.id] ?: Offset.Zero
                            dragPos = dragOrigin
                            dragId = tile.id
                            c.sentenceBar.dragUpdate(tile, false)
                        }
                        val move: (androidx.compose.ui.input.pointer.PointerInputChange, Offset) -> Unit = { change, amount ->
                            change.consume()
                            dragPos += amount
                            c.sentenceBar.dragUpdate(tile, dragPos.y <= dropZonePx)
                        }
                        val end: () -> Unit = {
                            val hit = dragPos.y <= dropZonePx
                            dragId = null
                            c.sentenceBar.dragEnd()
                            if (hit) {
                                c.sentenceBar.stage(tile, access.sentenceIdleMin)
                                // Logged, not spoken — ▶ says the sentence.
                                c.tilePlayer.logOnly(tile, childId = c.auth.childSlug, categoryName = "Needs")
                            }
                        }
                        val cancel: () -> Unit = { dragId = null; c.sentenceBar.dragEnd() }
                        detectDragGestures(onDragStart = start, onDrag = move,
                            onDragEnd = end, onDragCancel = cancel)
                    } else {
                        // Hold-to-stage: stationary 1s hold stages in place;
                        // movement cancels and the scroll owns the touch.
                        androidx.compose.foundation.gestures.detectTapGestures(
                            onLongPress = {
                                c.sentenceBar.noteJustStaged(tile.id)
                                c.sentenceBar.stage(tile, access.sentenceIdleMin)
                                c.tilePlayer.logOnly(tile, childId = c.auth.childSlug, categoryName = "Needs")
                            },
                        )
                    }
                } else Modifier),
        ) {
            TileView(tile, tileSize, prefs.hideLabels, onTap = { tap(it) },
                editMode = editMode, onEdit = onEditTile)
        }
    }

    if (access.buttonsNav && !editMode) {
        // Button navigation: whole-page turns instead of a sideways scroll.
        BoxWithConstraints(
            Modifier.fillMaxWidth().height(stripHeight).background(hexColor(prefs.colorNeeds)),
        ) {
            val per = maxOf(1, ((maxWidth - 108.dp).value / (tileSize.value + BoardMetrics.TILE_GAP)).toInt())
            val pageCount = maxOf(1, (tiles.size + per - 1) / per)
            val p = minOf(page, pageCount - 1)
            val slice = tiles.drop(p * per).take(per)
            Row(
                Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (pageCount > 1) {
                    PagerPaddle("◀", enabled = p > 0, modifier = Modifier.width(44.dp)) { page = maxOf(0, p - 1) }
                    Spacer(Modifier.width(BoardMetrics.TILE_GAP.dp))
                }
                slice.forEach { tile ->
                    needsCell(tile)
                    Spacer(Modifier.width(BoardMetrics.TILE_GAP.dp))
                }
                Spacer(Modifier.weight(1f))
                if (pageCount > 1) {
                    PagerPaddle("▶", enabled = p < pageCount - 1, modifier = Modifier.width(44.dp)) { page = minOf(pageCount - 1, p + 1) }
                }
            }
        }
        return
    }

    Row(
        Modifier
            .fillMaxWidth()
            .height(stripHeight)
            .background(hexColor(prefs.colorNeeds))
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = BoardMetrics.COLUMN_PAD.dp, vertical = 8.dp),
    ) {
        tiles.forEach { tile ->
            needsCell(tile)
            Spacer(Modifier.width(BoardMetrics.TILE_GAP.dp))
        }
        if (editMode && onAdd != null) {
            AddTileCell(tileSize, onAdd)
        }
    }
}

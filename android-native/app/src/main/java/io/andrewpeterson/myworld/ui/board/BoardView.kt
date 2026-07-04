package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.BoardMetrics
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.model.Category
import io.andrewpeterson.myworld.model.childPossessive
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * The kid board — port of `Views/BoardView.swift` (M3 scope: read-only board
 * with tap-to-speak; games/listening/live/edit overlays land with their
 * milestones).
 *
 * ONE uniform tile size is computed here for the WHOLE board; each column's
 * width is `tilesAcross × tile`, so lowering a section's tiles-across makes
 * that column NARROWER (tiles keep their size) and the freed space becomes
 * whitespace on the right.
 */
@Composable
fun BoardView() {
    val c = LocalAppContainer.current
    val prefs by c.displayPrefs.data.collectAsState()
    val tiles by c.board.tiles.collectAsState()
    val loading by c.board.loading.collectAsState()

    var editMode by remember { mutableStateOf(false) }
    var openRoom by remember { mutableStateOf<Category?>(null) }
    var didInitialLoad by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val slug = c.auth.childSlug
        c.displayPrefs.attach(slug)
        c.board.refresh(slug)
        didInitialLoad = true
        // M5+: live.start, scheduler.start, autoTeach.start, seed watch.
    }

    Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        HeaderBar(
            editMode = editMode,
            onLockTap = { if (editMode) editMode = false },
            onLockLongPress = { /* M4: UnlockSheet */ },
        )

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val widthDp = maxWidth.value
            val visible = listOf(BoardSection.PEOPLE, BoardSection.NOUNS, BoardSection.VERBS)
                .filter { c.displayPrefs.show(it) }
            val tile = computeTileSize(widthDp, visible.map { c.displayPrefs.across(it) })

            Column(Modifier.fillMaxSize()) {
                Row(Modifier.weight(1f)) {
                    visible.forEachIndexed { idx, section ->
                        androidx.compose.foundation.layout.Box(
                            Modifier
                                .width(BoardMetrics.columnWidth(c.displayPrefs.across(section), tile).dp)
                                .fillMaxHeight(),
                        ) {
                            SectionColumn(
                                section = section,
                                tileSize = tile.dp,
                                editMode = editMode,
                                onOpenRoom = { openRoom = it },
                            )
                        }
                        if (idx < visible.size - 1) VerticalDivider()
                    }
                    Spacer(Modifier.weight(1f, fill = true))   // freed space → whitespace
                }
                if (prefs.showNeeds) {
                    HorizontalDivider()
                    NeedsStrip(tileSize = tile.dp, editMode = editMode)
                }
            }

            // Brand-new board with no tiles yet → friendly welcome (after the
            // first refresh so it never flashes mid-load).
            if (didInitialLoad && tiles.isEmpty() && !loading && !editMode) {
                EmptyBoardView(possessive = childPossessive(c.auth.childSlug)) {
                    // Re-pull — the server-side build lands tiles as it goes.
                }
            }
        }
    }

    openRoom?.let { room ->
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { openRoom = null },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
        ) {
            RoomInteriorView(room, tileSize = 120.dp) { openRoom = null }
        }
    }
}

/**
 * The layout math from BoardView.swift `computeLayout` — pure function so it
 * unit-tests against known iPad widths.
 */
fun computeTileSize(widthDp: Float, acrossPerVisibleColumn: List<Int>): Float {
    val n = acrossPerVisibleColumn.size
    if (n == 0 || widthDp <= 0f) return BoardMetrics.MIN_TILE
    val totalAcross = acrossPerVisibleColumn.sum()
    if (totalAcross <= 0) return BoardMetrics.MIN_TILE

    // Width consumed by gaps, paddings, dividers (i.e. not tiles).
    var chrome = (n - 1) * BoardMetrics.DIVIDER_WIDTH
    for (a in acrossPerVisibleColumn) {
        chrome += 2 * BoardMetrics.COLUMN_PAD + (a - 1) * BoardMetrics.TILE_GAP
    }
    val availForTiles = (widthDp - chrome).coerceAtLeast(0f)

    // Constant comfortable size … but never overflow when packed.
    val idealTile = widthDp / BoardMetrics.REFERENCE_ACROSS
    val fitTile = availForTiles / totalAcross
    return maxOf(BoardMetrics.MIN_TILE, minOf(idealTile, fitTile))
}

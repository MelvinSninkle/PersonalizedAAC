package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.BoardMetrics
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.model.Category
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * One of the three main columns (People / Nouns / Verbs) — port of
 * `Views/SectionColumn.swift` (M3 scope: selection + tap-to-speak; edit-mode
 * drag/add arrives with M8). Layout: title → category chips → subcategory
 * chips → tile grid. Location categories render their children as room tiles.
 */
@Composable
fun SectionColumn(
    section: BoardSection,
    tileSize: Dp,
    editMode: Boolean = false,
    onEditTile: (Tile) -> Unit = {},
    onOpenRoom: (Category) -> Unit = {},
) {
    val c = LocalAppContainer.current
    val prefs by c.displayPrefs.data.collectAsState()
    val cats by c.board.categories.collectAsState()
    val allTiles by c.board.tiles.collectAsState()

    var selectedCategoryId by remember { mutableStateOf<Int?>(null) }
    var selectedSubcategoryId by remember { mutableStateOf<Int?>(null) }

    val roots = c.board.roots(section)

    // ensureSelection: keep a valid chip selected as the board changes.
    LaunchedEffect(roots.map { it.id }) {
        if (selectedCategoryId == null || roots.none { it.id == selectedCategoryId }) {
            selectedCategoryId = roots.firstOrNull()?.id
        }
    }
    LaunchedEffect(selectedCategoryId) { selectedSubcategoryId = null }

    val activeCategory = roots.firstOrNull { it.id == selectedCategoryId } ?: roots.firstOrNull()
    val subs = activeCategory?.let { c.board.children(it) } ?: emptyList()
    val effectiveCategory: Category? = when {
        activeCategory == null -> null
        subs.isNotEmpty() -> subs.firstOrNull { it.id == selectedSubcategoryId } ?: subs.first()
        else -> activeCategory
    }

    val activeCategoryName = roots.firstOrNull { it.id == selectedCategoryId }?.label
        ?: roots.firstOrNull()?.label
    val activeSubcategoryName = selectedSubcategoryId?.let { id -> cats.firstOrNull { it.id == id }?.label }

    fun playWithLogging(t: Tile, fallbackCategory: String? = null) {
        c.tilePlayer.play(
            t, childId = c.auth.childSlug,
            categoryName = fallbackCategory ?: activeCategoryName,
            subcategoryName = activeSubcategoryName,
        )
    }

    Column(
        Modifier.fillMaxSize().background(hexColor(c.displayPrefs.color(section)).copy(alpha = 0.7f)),
    ) {
        if (!prefs.hideLabels) {
            Text(section.displayLabel, fontSize = 18.sp, fontWeight = FontWeight.Bold,
                color = Brand.pinkDeep,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp))
        }

        CategoryTabStrip(roots, selectedCategoryId, prefs.hideLabels) { id ->
            selectedCategoryId = id
            // Every REAL chip press is remembered as the header Play/Teach scope.
            io.andrewpeterson.myworld.game.PlayScope.note("cat:$id", c.auth.childSlug)
        }

        if (activeCategory != null && subs.isNotEmpty()) {
            SubcategoryStrip(subs, selectedSubcategoryId ?: subs.first().id, prefs.hideLabels) { id ->
                selectedSubcategoryId = id
                io.andrewpeterson.myworld.game.PlayScope.note("cat:$id", c.auth.childSlug)
                // Location chips speak their name on selection.
                cats.firstOrNull { it.id == id && it.isLocation }?.let { chip ->
                    c.tilePlayer.speak(chip.label)
                }
            }
        }

        val cols = maxOf(1, c.displayPrefs.across(section))
        if (effectiveCategory != null && effectiveCategory.isLocation) {
            // Rooms grid: tap speaks, long-press opens interior. Falls back to
            // the location's own items when no rooms are configured.
            val rooms = c.board.children(effectiveCategory)
            if (rooms.isEmpty()) {
                TileGrid(c.board.tilesIn(effectiveCategory), cols, tileSize, prefs.hideLabels,
                    posterMode = effectiveCategory.isPoster,
                    editMode = editMode, onEditTile = onEditTile,
                    onTap = { playWithLogging(it, effectiveCategory.label) })
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(cols),
                    horizontalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
                    verticalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
                    modifier = Modifier.fillMaxSize()
                        .padding(horizontal = BoardMetrics.COLUMN_PAD.dp, vertical = 8.dp),
                ) {
                    items(rooms, key = { it.id }) { room ->
                        RoomTileView(room, tileSize,
                            onTap = { c.tilePlayer.speak(room.label) },
                            onLongPress = { onOpenRoom(room) })
                    }
                }
            }
        } else {
            val tiles = effectiveCategory?.let { c.board.tilesIn(it) } ?: emptyList()
            TileGrid(tiles, cols, tileSize, prefs.hideLabels,
                posterMode = effectiveCategory?.isPoster ?: false,
                editMode = editMode, onEditTile = onEditTile,
                onTap = { playWithLogging(it) })
        }
    }

    // allTiles is observed so the grid recomposes on sync (board edits, renders).
    @Suppress("UNUSED_EXPRESSION") allTiles
}

@Composable
private fun TileGrid(
    tiles: List<Tile>,
    cols: Int,
    tileSize: Dp,
    hideLabels: Boolean,
    posterMode: Boolean,
    editMode: Boolean,
    onEditTile: (Tile) -> Unit,
    onTap: (Tile) -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(cols),
        horizontalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
        verticalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
        modifier = Modifier.fillMaxSize()
            .padding(horizontal = BoardMetrics.COLUMN_PAD.dp, vertical = 8.dp),
    ) {
        items(tiles, key = { it.id }) { tile ->
            TileView(tile, tileSize, hideLabels, onTap,
                editMode = editMode, onEdit = onEditTile, posterMode = posterMode)
        }
    }
}

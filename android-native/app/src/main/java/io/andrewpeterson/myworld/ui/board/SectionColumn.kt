package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.zIndex.zIndex
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.BoardMetrics
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.model.Category
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.net.updateItem
import io.andrewpeterson.myworld.storage.AddTileQueue
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch

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
    onAdd: (BoardSection, Int?) -> Unit = { _, _ -> },
) {
    val c = LocalAppContainer.current
    val prefs by c.displayPrefs.data.collectAsState()
    val cats by c.board.categories.collectAsState()
    val allTiles by c.board.tiles.collectAsState()
    val tileJobs by c.addTileQueue.jobs.collectAsState()

    var selectedCategoryId by remember { mutableStateOf<Int?>(null) }
    var selectedSubcategoryId by remember { mutableStateOf<Int?>(null) }

    // Chip drop-targets (root coords) — a long-press drag that ends over a
    // chip moves the tile into that folder (iOS drag-to-chip parity).
    val chipRects = remember { mutableStateMapOf<Int, Rect>() }

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

        CategoryTabStrip(roots, selectedCategoryId, prefs.hideLabels,
            onChipBounds = if (editMode) ({ id, r -> chipRects[id] = r }) else null) { id ->
            selectedCategoryId = id
            // Every REAL chip press is remembered as the header Play/Teach scope.
            io.andrewpeterson.myworld.game.PlayScope.note("cat:$id", c.auth.childSlug)
        }

        if (activeCategory != null && subs.isNotEmpty()) {
            SubcategoryStrip(subs, selectedSubcategoryId ?: subs.first().id, prefs.hideLabels,
                onChipBounds = if (editMode) ({ id, r -> chipRects[id] = r }) else null) { id ->
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
            // Jobs enqueued from this exact spot (section + folder) paint as
            // spinner cells; jobs restored after a restart have no placement
            // info and surface via board refreshes instead.
            val jobsHere = if (editMode) tileJobs.filter {
                it.phase != AddTileQueue.Phase.DONE &&
                    it.section == section.raw && it.categoryId == effectiveCategory?.id
            } else emptyList()
            TileGrid(tiles, cols, tileSize, prefs.hideLabels,
                posterMode = effectiveCategory?.isPoster ?: false,
                editMode = editMode, onEditTile = onEditTile,
                onTap = { playWithLogging(it) },
                onAdd = if (editMode) ({ onAdd(section, effectiveCategory?.id) }) else null,
                renderingJobs = jobsHere,
                onDismissJob = { c.addTileQueue.dismiss(it) },
                chipRects = chipRects)
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
    onAdd: (() -> Unit)? = null,
    renderingJobs: List<AddTileQueue.TileJob> = emptyList(),
    onDismissJob: (Long) -> Unit = {},
    chipRects: Map<Int, Rect> = emptyMap(),
) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    // Long-press drag state — uniform tile size means the drop target is just
    // "whichever cell rect the pointer ends inside" (the plan's port #7).
    val cellRects = remember { mutableStateMapOf<Int, Rect>() }
    var dragId by remember { mutableStateOf<Int?>(null) }
    var dragOrigin by remember { mutableStateOf(Offset.Zero) }
    var dragPos by remember { mutableStateOf(Offset.Zero) }

    fun completeDrag() {
        val id = dragId ?: return
        dragId = null
        val moved = tiles.firstOrNull { it.id == id } ?: return
        val point = dragPos
        // Dropped on a folder chip → move the tile into that folder.
        val chip = chipRects.entries.firstOrNull { it.value.contains(point) }
        if (chip != null) {
            if (chip.key != moved.categoryId) scope.launch {
                try {
                    c.api.updateItem(id = moved.id, childId = c.auth.childSlug, categoryId = chip.key)
                } catch (_: Exception) {}
                c.board.refresh(c.auth.childSlug)
            }
            return
        }
        // Dropped on a sibling cell → splice + i*1000 resequence (web parity).
        val target = cellRects.entries.firstOrNull { it.key != id && it.value.contains(point) }?.key
            ?: return
        val list = tiles.toMutableList()
        val from = list.indexOfFirst { it.id == id }
        val to = list.indexOfFirst { it.id == target }
        if (from < 0 || to < 0 || from == to) return
        val item = list.removeAt(from)
        list.add(to, item)
        scope.launch {
            for ((idx, t) in list.withIndex()) {
                val newOrder = idx * 1000
                if (t.order != newOrder) {
                    try {
                        c.api.updateItem(id = t.id, childId = c.auth.childSlug, order = newOrder)
                    } catch (_: Exception) {}
                }
            }
            c.board.refresh(c.auth.childSlug)
        }
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(cols),
        horizontalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
        verticalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
        modifier = Modifier.fillMaxSize()
            .padding(horizontal = BoardMetrics.COLUMN_PAD.dp, vertical = 8.dp),
    ) {
        items(tiles, key = { it.id }) { tile ->
            val isDragging = dragId == tile.id
            Box(
                Modifier
                    .onGloballyPositioned {
                        // Freeze the dragged tile's rect so the float offset
                        // stays anchored to where the drag began.
                        if (dragId != tile.id) cellRects[tile.id] = it.boundsInRoot()
                    }
                    .zIndex(if (isDragging) 1f else 0f)
                    .graphicsLayer {
                        if (isDragging) {
                            translationX = dragPos.x - dragOrigin.x
                            translationY = dragPos.y - dragOrigin.y
                            scaleX = 1.06f; scaleY = 1.06f; alpha = 0.85f
                        }
                    }
                    .then(if (editMode) Modifier.pointerInput(tile.id, tiles.map { it.id }) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = {
                                dragOrigin = cellRects[tile.id]?.center ?: Offset.Zero
                                dragPos = dragOrigin
                                dragId = tile.id
                            },
                            onDrag = { change, amount -> change.consume(); dragPos += amount },
                            onDragEnd = { completeDrag() },
                            onDragCancel = { dragId = null },
                        )
                    } else Modifier),
            ) {
                TileView(tile, tileSize, hideLabels, onTap,
                    editMode = editMode, onEdit = onEditTile, posterMode = posterMode)
            }
        }
        // In-flight tile jobs paint as dimmed spinner cells just before the
        // add-cell, so a new photo visibly "lands where it was added".
        items(renderingJobs, key = { "job-${it.id}" }) { job ->
            RenderingTileCell(job, tileSize, onDismissFailed = { onDismissJob(job.id) })
        }
        // The dashed "+ Add tile" cell at the grid's end while unlocked —
        // pre-set to this section + the folder on screen (AddTileCell parity).
        if (onAdd != null) {
            item(key = "add-cell") { AddTileCell(tileSize, onAdd) }
        }
    }
}

@Composable
fun AddTileCell(size: Dp, onTap: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        Modifier
            .size(size)
            .background(Color.White.copy(alpha = 0.45f), shape)
            .border(2.dp, Brand.pink.copy(alpha = 0.65f), shape)
            .clickable(onClick = onTap),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("＋", fontSize = 30.sp, color = Brand.pink)
            Text("Add tile", fontSize = 13.sp, color = Brand.pink,
                fontWeight = FontWeight.SemiBold)
        }
    }
}

/**
 * A dimmed thumbnail with a spinner while the server paints a queued tile —
 * port of RenderingTileCell. Failed jobs show a small ✕ badge (tap dismisses).
 */
@Composable
fun RenderingTileCell(job: AddTileQueue.TileJob, size: Dp, onDismissFailed: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    val failed = job.phase == AddTileQueue.Phase.FAILED
    Box(
        Modifier
            .size(size)
            .background(Color.White.copy(alpha = 0.6f), shape)
            .border(2.dp, if (failed) Color(0xFFDC2626).copy(alpha = 0.6f) else Brand.pink.copy(alpha = 0.35f), shape)
            .then(if (failed) Modifier.clickable(onClick = onDismissFailed) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        job.thumbnail?.let { bmp ->
            Image(
                bmp.asImageBitmap(), contentDescription = null,
                contentScale = ContentScale.Crop, alpha = 0.35f,
                modifier = Modifier.fillMaxSize().clip(shape),
            )
        }
        if (failed) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("✕", fontSize = 26.sp, color = Color(0xFFDC2626), fontWeight = FontWeight.Bold)
                Text("Didn't work — tap to clear", fontSize = 10.sp, color = Color(0xFFDC2626),
                    modifier = Modifier.padding(horizontal = 6.dp))
            }
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = Brand.pink, strokeWidth = 3.dp,
                    modifier = Modifier.size(28.dp))
                if (job.label.isNotBlank()) {
                    Text(job.label, fontSize = 11.sp, color = Brand.pinkDeep,
                        fontWeight = FontWeight.SemiBold, maxLines = 1)
                }
            }
        }
    }
}

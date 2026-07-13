package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.ui.platform.LocalDensity
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

    // Selection is HOISTED into BoardNav (it was per-column local state) so
    // listening repeat-navigate can select a category from the header.
    val access by c.access.data.collectAsState()
    val navCat by c.boardNav.cat.collectAsState()
    val navSub by c.boardNav.sub.collectAsState()
    val highlight by c.boardNav.highlight.collectAsState()
    val selectedCategoryId = navCat[section]
    val selectedSubcategoryId = navSub[section]
    var gridPage by remember { mutableStateOf(0) }

    // Chip drop-targets (root coords) — a long-press drag that ends over a
    // chip moves the tile into that folder (iOS drag-to-chip parity).
    val chipRects = remember { mutableStateMapOf<Int, Rect>() }

    val roots = c.board.roots(section)

    // ensureSelection: keep a valid chip selected as the board changes.
    LaunchedEffect(roots.map { it.id }) {
        if (selectedCategoryId == null || roots.none { it.id == selectedCategoryId }) {
            c.boardNav.setCategory(section, roots.firstOrNull()?.id)
        }
    }
    LaunchedEffect(selectedCategoryId) {
        c.boardNav.setSubcategory(section, null)
        gridPage = 0
    }
    LaunchedEffect(selectedSubcategoryId) { gridPage = 0 }

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

    val sentenceMode by c.sentenceBar.mode.collectAsState()

    fun playWithLogging(t: Tile, fallbackCategory: String? = null) {
        // Sentence mode (the pencil): a tap IS the stage — silent; ▶ speaks.
        if (sentenceMode && !editMode) {
            c.sentenceBar.stage(t, access.sentenceIdleMin)
            c.tilePlayer.logOnly(
                t, childId = c.auth.childSlug,
                categoryName = fallbackCategory ?: activeCategoryName,
                subcategoryName = activeSubcategoryName,
            )
            return
        }
        c.tilePlayer.play(
            t, childId = c.auth.childSlug,
            categoryName = fallbackCategory ?: activeCategoryName,
            subcategoryName = activeSubcategoryName,
        )
    }

    // Staging logs like a tap (milestones see the combo) but stays SILENT —
    // the child is composing, not speaking; ▶ says the sentence.
    fun logStage(t: Tile, fallbackCategory: String? = null) {
        c.tilePlayer.logOnly(
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
            paged = (access.buttonsNav || sentenceMode) && !editMode,
            onChipBounds = if (editMode) ({ id, r -> chipRects[id] = r }) else null) { id ->
            c.boardNav.setCategory(section, id)
            // Every REAL chip press is remembered as the header Play/Teach scope.
            io.andrewpeterson.myworld.game.PlayScope.note("cat:$id", c.auth.childSlug)
        }

        if (activeCategory != null && subs.isNotEmpty()) {
            SubcategoryStrip(subs, selectedSubcategoryId ?: subs.first().id, prefs.hideLabels,
                paged = (access.buttonsNav || sentenceMode) && !editMode,
                onChipBounds = if (editMode) ({ id, r -> chipRects[id] = r }) else null) { id ->
                c.boardNav.setSubcategory(section, id)
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
                    onTap = { playWithLogging(it, effectiveCategory.label) },
                    access = access,
                    highlightId = highlight?.takeIf { it.section == section }?.tileId,
                    page = gridPage, onSetPage = { gridPage = it },
                    onStage = { t ->
                        c.sentenceBar.stage(t, access.sentenceIdleMin)
                        logStage(t, effectiveCategory.label)
                    })
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
                chipRects = chipRects,
                access = access,
                highlightId = highlight?.takeIf { it.section == section }?.tileId,
                page = gridPage, onSetPage = { gridPage = it },
                onStage = { t ->
                    c.sentenceBar.stage(t, access.sentenceIdleMin)
                    logStage(t)
                })
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
    access: io.andrewpeterson.myworld.access.AccessData = io.andrewpeterson.myworld.access.AccessData(),
    highlightId: Int? = null,
    page: Int = 0,
    onSetPage: (Int) -> Unit = {},
    onStage: (Tile) -> Unit = {},
) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val sentenceOn = access.sentenceBuilder && !editMode
    val paged = access.buttonsNav && !editMode
    val dropZonePx = with(LocalDensity.current) { 140.dp.toPx() }
    val gridState = rememberLazyGridState()

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

    // Button navigation: whole-page turns instead of scrolling — only full
    // tiles render on a page, so the tile that WOULD have been cut off is
    // exactly the first tile of the next page. Scroll mode keeps the lazy
    // grid (and scrolls to a repeat-navigate highlight).
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val cellH = tileSize + (if (hideLabels) 0.dp else 24.dp) + BoardMetrics.TILE_GAP.dp
        val rows = if (paged) maxOf(1, ((maxHeight - 62.dp) / cellH).toInt()) else Int.MAX_VALUE
        val per = if (paged) maxOf(1, rows * cols) else tiles.size
        val pageCount = if (paged) maxOf(1, (tiles.size + per - 1) / per) else 1
        val p = minOf(page, pageCount - 1)
        val shown = if (paged) tiles.drop(p * per).take(per) else tiles

        LaunchedEffect(highlightId, paged, per) {
            val idx = tiles.indexOfFirst { it.id == highlightId }
            if (idx < 0) return@LaunchedEffect
            if (paged) onSetPage(idx / per)
            else gridState.animateScrollToItem(idx)
        }

        Column(Modifier.fillMaxSize()) {
    LazyVerticalGrid(
        state = gridState,
        userScrollEnabled = !paged,
        columns = GridCells.Fixed(cols),
        horizontalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
        verticalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
        modifier = Modifier.fillMaxWidth().let { if (paged) it.weight(1f) else it.fillMaxHeight() }
            .padding(horizontal = BoardMetrics.COLUMN_PAD.dp, vertical = 8.dp),
    ) {
        items(shown, key = { it.id }) { tile ->
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
                    .then(if (tile.id == highlightId)
                        Modifier.border(5.dp, Color(0xFFFFD400), RoundedCornerShape(16.dp))
                    else Modifier)
                    .then(when {
                        editMode -> Modifier.pointerInput(tile.id, tiles.map { it.id }) {
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
                        }
                        else -> Modifier
                    }),
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
        if (paged && pageCount > 1) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp)) {
                PagerPaddle("⬆", enabled = p > 0, modifier = Modifier.weight(1f)) { onSetPage(maxOf(0, p - 1)) }
                Spacer(Modifier.width(10.dp))
                PagerPaddle("⬇", enabled = p < pageCount - 1, modifier = Modifier.weight(1f)) { onSetPage(minOf(pageCount - 1, p + 1)) }
            }
        }
        }
    }
}

/** Big page-turn button for button-navigation mode (eye-tracker sized). */
@Composable
fun PagerPaddle(glyph: String, enabled: Boolean, modifier: Modifier = Modifier, onTap: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier
            .height(46.dp)
            .background(Color.White.copy(alpha = if (enabled) 1f else 0.4f), shape)
            .border(2.dp, Color(0xFFC9D5E8), shape)
            .then(if (enabled) Modifier.clickable(onClick = onTap) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(glyph, fontSize = 20.sp, fontWeight = FontWeight.Bold,
            color = Color(0xFF2B3A55).copy(alpha = if (enabled) 1f else 0.35f))
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

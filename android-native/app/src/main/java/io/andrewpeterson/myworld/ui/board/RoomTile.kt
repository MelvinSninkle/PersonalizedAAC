package io.andrewpeterson.myworld.ui.board

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.BoardMetrics
import io.andrewpeterson.myworld.model.Category
import io.andrewpeterson.myworld.ui.LongPressExitButton
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A room chip inside a location — port of `Views/RoomTile.swift`:
 * short-press speaks the room's name, long-press opens its interior.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RoomTileView(
    room: Category,
    size: Dp,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
) {
    val c = LocalAppContainer.current
    val image by produceState<Bitmap?>(initialValue = null, room.imageKey) {
        val key = room.imageKey
        value = if (key.isNullOrEmpty()) null else withContext(Dispatchers.Default) {
            c.media.bitmap(key, maxDim = 640)?.trimmingFlatBorders()
        }
    }

    Column(Modifier.width(size), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(18.dp))
                .background(Color.White)
                .border(1.dp, Color.Black.copy(alpha = 0.08f), RoundedCornerShape(18.dp))
                .combinedClickable(onClick = onTap, onLongClick = onLongPress),
            contentAlignment = Alignment.Center,
        ) {
            val img = image
            if (img != null) {
                Image(img.asImageBitmap(), contentDescription = room.label,
                    contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else Text("🚪", fontSize = 28.sp)
            // Hint badge that the room opens (bottom-right, subtle).
            Text("⤢", fontSize = 14.sp, color = Brand.pinkDeep,
                modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp))
        }
        Text(room.label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            color = Brand.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * Full-screen room interior — the room's tiles at board size; hold-to-close.
 * Port of `RoomInteriorView`.
 */
@Composable
fun RoomInteriorView(
    room: Category,
    tileSize: Dp,
    onClose: () -> Unit,
) {
    val c = LocalAppContainer.current
    val prefs by c.displayPrefs.data.collectAsState()
    val tiles = c.board.tilesIn(room)

    Box(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        Column(Modifier.fillMaxSize()) {
            Text(room.label, fontSize = 24.sp, fontWeight = FontWeight.Bold,
                color = Brand.pinkDeep,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = tileSize),
                horizontalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
                verticalArrangement = Arrangement.spacedBy(BoardMetrics.TILE_GAP.dp),
                modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
            ) {
                items(tiles, key = { it.id }) { tile ->
                    TileView(tile, tileSize, prefs.hideLabels,
                        onTap = { c.tilePlayer.play(it, childId = c.auth.childSlug, categoryName = room.label) })
                }
            }
        }
        LongPressExitButton(onExit = onClose, modifier = Modifier.align(Alignment.TopEnd))
    }
}

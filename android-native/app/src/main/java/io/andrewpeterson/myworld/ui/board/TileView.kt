package io.andrewpeterson.myworld.ui.board

import android.graphics.Bitmap
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.model.display
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * One tile button — port of `Views/TileView.swift`. Whole surface is one hit
 * target (native press, no WebView delay); guillotine center-crop everywhere
 * except posterMode (a folder named "TV"); word-tile placeholder while art is
 * still rendering; press scales 0.96 like the iOS TileButtonStyle.
 */
@Composable
fun TileView(
    tile: Tile,
    size: Dp,
    hideLabel: Boolean,
    onTap: (Tile) -> Unit,
    editMode: Boolean = false,
    onEdit: (Tile) -> Unit = {},
    posterMode: Boolean = false,
) {
    val c = LocalAppContainer.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1f,
        animationSpec = spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMedium),
        label = "tilePress",
    )

    // GUILLOTINE RULE: trim baked-in margins off-thread, then ContentScale.Crop
    // fills the square. Sole exception: TV-folder posters stay untouched.
    val image by produceState<Bitmap?>(initialValue = null, tile.imageKey, posterMode) {
        val key = tile.imageKey
        value = if (key.isNullOrEmpty()) null else withContext(Dispatchers.Default) {
            val bmp = c.media.bitmap(key, maxDim = 640)
            bmp   // no auto-trim, ever — parents frame; heuristics don't
        }
    }

    Column(
        Modifier
            .width(size)
            .scale(scale)
            .clickable(interactionSource = interaction, indication = null) {
                if (editMode) onEdit(tile) else onTap(tile)
            },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(18.dp))
                .background(Color.White)
                .border(
                    width = if (editMode) 2.dp else 1.dp,
                    color = if (editMode) Brand.pink.copy(alpha = 0.7f) else Color.Black.copy(alpha = 0.06f),
                    shape = RoundedCornerShape(18.dp),
                ),
        ) {
            val img = image
            when {
                img != null -> Image(
                    bitmap = img.asImageBitmap(),
                    contentDescription = tile.label,
                    contentScale = if (posterMode) ContentScale.Fit else ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                tile.imageKey.isNullOrEmpty() -> WordTilePlaceholder(tile.display)
                else -> Box(Modifier.fillMaxSize())   // image still loading — quiet
            }
            if (editMode) {
                Text("✎", fontSize = 16.sp, color = Brand.pink,
                    modifier = Modifier.align(Alignment.TopEnd).padding(5.dp)
                        .background(Color.White, RoundedCornerShape(50)).padding(horizontal = 5.dp))
            }
            if (tile.pinned) {
                Text("★", fontSize = 13.sp, color = Color(0xFFF5C518),
                    modifier = Modifier.align(Alignment.TopStart).padding(6.dp))
            }
        }
        if (!hideLabel) {
            Text(
                tile.display,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = Brand.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp, start = 2.dp, end = 2.dp),
            )
        }
    }
}

/**
 * WORD TILE — the art hasn't rendered yet; show the word big and warm (dashed
 * pink card, same as the web + iOS) so nothing looks broken. The real image
 * replaces it on a later sync with no layout shift.
 */
@Composable
fun WordTilePlaceholder(label: String) {
    Box(
        Modifier
            .fillMaxSize()
            .background(hexColor("#fdf2f8"))
            .dashedBorder(hexColor("#f3c6dd")),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontSize = 17.sp,
            fontWeight = FontWeight.Black,
            color = hexColor("#9d2463"),
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(8.dp),
        )
    }
}

private fun Modifier.dashedBorder(color: Color): Modifier = this.then(
    Modifier.border(2.dp, color, RoundedCornerShape(18.dp))
    // Compose has no first-class dashed border; a solid soft-pink line reads
    // the same at tile scale. (PathEffect via drawBehind if pixel parity ever
    // matters more than simplicity.)
)

}

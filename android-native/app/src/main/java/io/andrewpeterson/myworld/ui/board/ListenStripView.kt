package io.andrewpeterson.myworld.ui.board

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.game.ListenTokenizer
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * The live rolling caption strip that takes over the header while listening —
 * port of `Views/ListenStripView.swift`. Matched words render as tappable
 * tile chips (tap speaks); unmatched words as text pills; the word still
 * being spoken shows faint at the end.
 */
@Composable
fun ListenStripView() {
    val c = LocalAppContainer.current
    val words by c.speechListener.words.collectAsState()
    val liveTail by c.speechListener.liveTail.collectAsState()
    val status by c.speechListener.status.collectAsState()
    val tiles by c.board.tiles.collectAsState()

    val tokens = ListenTokenizer.tokenize(words, ListenTokenizer.lexicon(tiles))
    val listState = rememberLazyListState()

    LaunchedEffect(tokens.size, liveTail) {
        val count = tokens.size + (if (liveTail.isNotEmpty()) 1 else 0)
        if (count > 0) listState.animateScrollToItem(count - 1 + 1)   // +1 for the mic cell
    }

    LazyRow(
        state = listState,
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().height(92.dp).padding(horizontal = 8.dp),
    ) {
        item { Text("🎙", fontSize = 20.sp, color = Color(0xFFDC2626)); Spacer(Modifier.width(8.dp)) }
        if (tokens.isEmpty() && liveTail.isEmpty()) {
            item {
                Text(
                    status.ifEmpty { "Listening… say a word" },
                    fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    color = Color.White.copy(alpha = 0.85f),
                )
            }
        } else {
            items(tokens, key = { it.id }) { tok ->
                Row {
                    val tile = tok.tile
                    if (tile != null) ListenTileChip(tile)
                    else Text(
                        tok.word, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                        color = Brand.pinkDeep,
                        modifier = Modifier
                            .background(hexColor("#fce4ec"), RoundedCornerShape(14.dp))
                            .padding(horizontal = 12.dp, vertical = 22.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                }
            }
            if (liveTail.isNotEmpty()) {
                item {
                    Text(liveTail, fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
                        color = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.padding(horizontal = 8.dp))
                }
            }
        }
    }
}

/** A tile thumbnail chip; tap speaks it (recorded voice / TTS). */
@Composable
private fun ListenTileChip(tile: Tile) {
    val c = LocalAppContainer.current
    val image by produceState<Bitmap?>(initialValue = null, tile.imageKey) {
        val key = tile.imageKey
        value = if (key.isNullOrEmpty()) null else c.media.bitmap(key, maxDim = 320)
    }
    Box(
        Modifier
            .size(76.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(hexColor("#fff7fb"))
            .border(1.dp, Color.Black.copy(alpha = 0.06f), RoundedCornerShape(14.dp))
            .clickable { c.tilePlayer.play(tile) },
        contentAlignment = Alignment.Center,
    ) {
        val img = image
        if (img != null) {
            Image(img.asImageBitmap(), contentDescription = tile.label,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(76.dp))
        } else {
            Text(tile.label, fontSize = 11.sp, color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
        }
    }
}

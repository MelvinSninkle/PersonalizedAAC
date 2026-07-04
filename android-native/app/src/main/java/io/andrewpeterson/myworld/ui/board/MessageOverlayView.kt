package io.andrewpeterson.myworld.ui.board

import android.graphics.Bitmap
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.live.MessageToken
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.delay

/**
 * Full-screen playback of a parent's "message to the board" — port of
 * `Views/MessageOverlayView.swift`. Tokens render left-to-right as tiles
 * (or text pills for words the board doesn't have); the active one pulses
 * and auto-scrolls; each token's audio plays in sequence (recorded tile
 * sound → TTS); the whole sentence shows as a caption. Tap anywhere skips.
 */
@Composable
fun MessageOverlayView(tokens: List<MessageToken>, childId: String, onDone: () -> Unit) {
    val c = LocalAppContainer.current
    var active by remember { mutableIntStateOf(-1) }
    val listState = rememberLazyListState()

    LaunchedEffect(Unit) {
        delay(400)
        for ((i, tok) in tokens.withIndex()) {
            active = i
            // Recorded tile audio when the token maps to a tile; else TTS.
            val soundKey = tok.soundKey
            var played = false
            if (!soundKey.isNullOrEmpty()) {
                val f = c.media.audioFile(soundKey)
                if (f != null) played = c.tilePlayer.playFile(f.path)
            }
            if (!played) c.gameAudio.speakAwait(tok.word, childId)
            delay((tok.holdMs ?: 350.0).toLong())
        }
        delay(900)
        onDone()
    }
    LaunchedEffect(active) {
        if (active >= 0) listState.animateScrollToItem(active)
    }

    Box(
        Modifier.fillMaxSize().background(hexColor("#fff7fb"))
            .clickable(onClick = onDone),   // tap anywhere = skip
    ) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("💬 A message for you!", fontSize = 26.sp, fontWeight = FontWeight.Bold,
                color = Brand.pinkDeep)
            Spacer(Modifier.height(28.dp))
            LazyRow(
                state = listState,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                itemsIndexed(tokens) { i, tok ->
                    MessageTokenCell(tok, active = i == active)
                }
            }
            Spacer(Modifier.height(30.dp))
            Text(
                tokens.joinToString(" ") { it.word },
                fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Brand.muted,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun MessageTokenCell(tok: MessageToken, active: Boolean) {
    val c = LocalAppContainer.current
    val scale by animateFloatAsState(if (active) 1.12f else 1f, spring(), label = "msgPulse")
    val image by produceState<Bitmap?>(initialValue = null, tok.imageKey) {
        val key = tok.imageKey
        value = if (key.isNullOrEmpty()) null else c.media.bitmap(key)
    }

    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.scale(scale)) {
        val img = image
        if (img != null) {
            Image(img.asImageBitmap(), contentDescription = tok.word,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(150.dp).clip(RoundedCornerShape(22.dp))
                    .border(if (active) 4.dp else 1.dp,
                        if (active) Brand.pink else Color.Black.copy(alpha = 0.08f),
                        RoundedCornerShape(22.dp)))
        } else {
            Box(
                Modifier.size(150.dp)
                    .background(hexColor("#fce4ec"), RoundedCornerShape(22.dp))
                    .border(if (active) 4.dp else 1.dp,
                        if (active) Brand.pink else Color.Black.copy(alpha = 0.08f),
                        RoundedCornerShape(22.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(tok.word, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                    color = Brand.pinkDeep, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(8.dp))
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(tok.word, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
    }
}

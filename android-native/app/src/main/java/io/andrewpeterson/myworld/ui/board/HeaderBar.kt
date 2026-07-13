package io.andrewpeterson.myworld.ui.board

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.produceState
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.model.display
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.worldTitle
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * The board's top header — port of `Views/HeaderBar.swift` (M3 shell:
 * branded title + inert lock + placeholder listen/teach/play buttons; the
 * real actions land in M4/M5/M6). Triple-tap opens settings (M4).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HeaderBar(
    editMode: Boolean,
    onLockLongPress: () -> Unit,
    onLockTap: () -> Unit,
    onListenTap: () -> Unit = {},
    onTeachTap: () -> Unit = {},
    onPlayTap: () -> Unit = {},
    onTripleTap: () -> Unit = {},
    onShowDisplay: () -> Unit = {},
    listening: Boolean = false,
) {
    val c = LocalAppContainer.current
    val prefs by c.displayPrefs.data.collectAsState()
    val user by c.auth.user.collectAsState()
    val textColor = hexColor(prefs.colorHeaderText, Color.White)
    val staged by c.sentenceBar.staged.collectAsState()
    val sentenceDrag by c.sentenceBar.drag.collectAsState()
    val sentenceActive = staged.isNotEmpty()
    val sentenceMode by c.sentenceBar.mode.collectAsState()
    val access by c.access.data.collectAsState()

    // Hidden gesture: triple-tap the bar opens settings (sign out, cache).
    var taps by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(0L to 0) }
    fun noteTap() {
        val now = System.currentTimeMillis()
        val (last, count) = taps
        val n = if (now - last < 600) count + 1 else 1
        taps = now to n
        if (n >= 3) { taps = 0L to 0; onTripleTap() }
    }

    // Listening takes over the whole bar: title, lock, teach, play all hide —
    // one red stop button, then the live caption strip (iOS/web parity).
    Box(
        Modifier.fillMaxWidth().height(if (listening || sentenceActive) 104.dp else 48.dp)
            .background(hexColor(prefs.colorHeaderBg))
            .then(if (sentenceDrag?.overHeader == true)
                Modifier.border(4.dp, Color(0xFF66BB6A))
            else Modifier)
            .combinedClickable(onClick = { noteTap() }, onLongClick = {}),
    ) {
        if (sentenceActive) {
            // Sentence constructor: while composing, the strip is the ONLY
            // header content — title, lock, mic, and pills all yield (the
            // background color stays). Emptying the strip restores them.
            SentenceStripRow()
        } else if (listening) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp).align(Alignment.CenterStart),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(44.dp).combinedClickable(onClick = onListenTap, onLongClick = {}),
                    contentAlignment = Alignment.Center,
                ) { Text("⏹", fontSize = 22.sp, color = Color(0xFFDC2626)) }
                Spacer(Modifier.width(6.dp))
                ListenStripView()
            }
        } else {
            Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically) {
                Text("🌍", fontSize = 18.sp)
                Spacer(Modifier.width(8.dp))
                Text(worldTitle(user?.slug), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = textColor)
            }

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp).align(Alignment.CenterStart),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Lock: tap when unlocked re-locks; long-press opens the unlock
                // sheet. A kid's tap while locked does nothing at all.
                Box(
                    Modifier.size(40.dp).combinedClickable(
                        onClick = onLockTap,
                        onLongClick = onLockLongPress,
                    ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(if (editMode) "🔓" else "🔒", fontSize = 17.sp,
                        color = textColor.copy(alpha = if (editMode) 1f else 0.55f))
                }
                if (access.toolListen) {
                    Box(
                        Modifier.size(44.dp).combinedClickable(onClick = onListenTap, onLongClick = {}),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("🎙", fontSize = 20.sp, color = textColor.copy(alpha = 0.9f))
                    }
                }
                // ✏️ Sentence mode: modal, owned here — while on, the board
                // pages instead of scrolling and a TAP stages its tile.
                if (access.sentenceBuilder && access.toolSentence) {
                    Box(
                        Modifier.size(36.dp)
                            .background(if (sentenceMode) Color(0xFF66BB6A) else Color.White.copy(alpha = 0.18f), CircleShape)
                            .combinedClickable(onClick = { c.sentenceBar.setMode(!sentenceMode) }, onLongClick = {}),
                        contentAlignment = Alignment.Center,
                    ) { Text("✏️", fontSize = 15.sp) }
                }
                Spacer(Modifier.weight(1f))
                if (editMode) {
                    HeaderRound("⚙", onShowDisplay)
                    Spacer(Modifier.width(8.dp))
                }
                if (access.toolTeach) {
                    HeaderRound("📖", onTeachTap)
                    Spacer(Modifier.width(8.dp))
                }
                if (access.toolPlay) HeaderRound("🙋", onPlayTap)
            }
        }
    }
}

@Composable
private fun HeaderRound(emoji: String, onTap: () -> Unit) {
    Box(
        Modifier.size(40.dp).background(Color.White.copy(alpha = 0.18f), CircleShape)
            .combinedClickable(onClick = onTap, onLongClick = {}),
        contentAlignment = Alignment.Center,
    ) { Text(emoji, fontSize = 19.sp) }
}

/**
 * The sentence-constructor strip: staged chips (tap one to take it back out)
 * and the ▶ that plays the whole sentence in order. Port of the web bar and
 * iOS SentenceStripView.
 */
@Composable
private fun SentenceStripRow() {
    val c = LocalAppContainer.current
    val staged by c.sentenceBar.staged.collectAsState()
    val access by c.access.data.collectAsState()

    Row(
        Modifier.fillMaxSize().padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LazyRow(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            itemsIndexed(staged) { idx, tile ->
                SentenceChipView(tile) { c.sentenceBar.removeAt(idx, access.sentenceIdleMin) }
                Spacer(Modifier.width(8.dp))
            }
        }
        // Quick clear — a mis-tap costs one rebuild; a stuck sentence would
        // cost the whole feature. Deliberately a short tap.
        Box(
            Modifier.size(60.dp)
                .background(Color.White.copy(alpha = 0.22f), CircleShape)
                .clickable { c.sentenceBar.clear() },
            contentAlignment = Alignment.Center,
        ) { Text("✕", fontSize = 24.sp, color = Color.White) }
        Spacer(Modifier.width(8.dp))
        Box(
            Modifier.size(60.dp)
                .background(Color(0xFF2E7D32), CircleShape)
                .clickable { c.sentenceBar.playAll(c.auth.childSlug, access.sentenceIdleMin) },
            contentAlignment = Alignment.Center,
        ) { Text("▶", fontSize = 24.sp, color = Color.White) }
    }
}

@Composable
private fun SentenceChipView(tile: Tile, onRemove: () -> Unit) {
    val c = LocalAppContainer.current
    val image by produceState<Bitmap?>(initialValue = null, tile.imageKey) {
        val key = tile.imageKey
        value = if (key.isNullOrEmpty()) null else withContext(Dispatchers.Default) {
            c.media.bitmap(key, maxDim = 320)
        }
    }
    Box(
        Modifier.size(76.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFFFCE4EC))
            .clickable(onClick = onRemove),
        contentAlignment = Alignment.Center,
    ) {
        val img = image
        if (img != null) {
            Image(img.asImageBitmap(), contentDescription = tile.display,
                contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Text(tile.display, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                color = Brand.pinkDeep, maxLines = 2,
                modifier = Modifier.padding(horizontal = 6.dp))
        }
    }
}

package io.andrewpeterson.myworld.ui.game

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.asImageBitmap
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.game.GameController
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.net.tickExposure
import io.andrewpeterson.myworld.ui.LongPressExitButton
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Passive learn/exposure slideshow — port of `Views/SlideshowView.swift`.
 * Timer-paced (secondsPerImage, default 5, min 2), LOOPS until the time limit
 * or hold-✕. Learn mode plays recorded audio; exposure TTS "I can see a ___".
 * Child taps do nothing. Exit ticks the dominant skill exposure (unless the
 * scope is an auto-teach slugs: batch — the runner already ticked those).
 */
@Composable
fun SlideshowView(session: GameController.Session, onExit: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    var deck by remember { mutableStateOf<List<Tile>>(emptyList()) }
    var pos by remember { mutableIntStateOf(0) }
    val firstPerson = (session.mode as? GameController.Mode.Slideshow)?.firstPerson == true

    fun tickDominantOnExit() {
        if (session.scope?.startsWith("slugs:") == true) return
        val counts = mutableMapOf<String, Int>()
        for (t in deck) t.taxonomySlug?.takeIf { it.isNotEmpty() }?.let {
            counts[it] = (counts[it] ?: 0) + 1
        }
        val skill = counts.maxByOrNull { it.value }?.key ?: return
        val childId = c.auth.childSlug
        scope.launch { c.api.tickExposure(childId, skill, "slideshow") }
    }

    LaunchedEffect(Unit) {
        deck = c.board.tilesForScope(session.scope, session.from, session.to)
            .filter { !it.imageKey.isNullOrEmpty() }
            .shuffled()
        (session.sample ?: 0).takeIf { it > 0 }?.let { deck = deck.take(it) }
        if (deck.isEmpty()) { onExit(); return@LaunchedEffect }
        c.gameAudio.startMusic(session.music)
        session.limitMin?.takeIf { it > 0 }?.let { mins ->
            scope.launch { delay((mins * 60_000).toLong()); tickDominantOnExit(); onExit() }
        }
        val secs = (session.secondsPerImage ?: 5.0).coerceAtLeast(2.0)
        while (true) {
            val tile = deck[pos % deck.size]
            if (firstPerson) c.gameAudio.speak("I can see a ${tile.label}", c.auth.childSlug)
            else c.tilePlayer.play(tile)
            delay((secs * 1000).toLong())
            pos += 1   // loops forever — the limit timer or hold-✕ ends it
        }
    }
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { c.gameAudio.stopMusic() } }

    val tile = deck.getOrNull(pos % maxOf(1, deck.size))
    SlideScaffold(tile = tile, caption = tile?.label, sub = null, progress = null) {
        tickDominantOnExit(); onExit()
    }
}

/**
 * "Teach me" — port of `TeachShowView`: ONE shuffled pass, EVENT-paced
 * (speakAwait), image settles 350ms before the word, then every teaching clue
 * shown while spoken. No word label under the tile (the art carries its
 * caption). Child taps do nothing; auto-exits after the last tile.
 */
@Composable
fun TeachShowView(session: GameController.Session, onExit: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    var deck by remember { mutableStateOf<List<Tile>>(emptyList()) }
    var pos by remember { mutableIntStateOf(0) }
    var clue by remember { mutableStateOf("") }

    fun tickDominantOnExit() {
        if (session.scope?.startsWith("slugs:") == true) return
        val counts = mutableMapOf<String, Int>()
        for (t in deck) t.taxonomySlug?.takeIf { it.isNotEmpty() }?.let {
            counts[it] = (counts[it] ?: 0) + 1
        }
        val skill = counts.maxByOrNull { it.value }?.key ?: return
        val childId = c.auth.childSlug
        scope.launch { c.api.tickExposure(childId, skill, "slideshow") }
    }

    LaunchedEffect(Unit) {
        deck = c.board.tilesForScope(session.scope, session.from, session.to)
            .filter { !it.imageKey.isNullOrEmpty() && it.label.isNotEmpty() }
            .shuffled()
        (session.sample ?: 0).takeIf { it > 0 }?.let { deck = deck.take(it) }
        if (deck.isEmpty()) { onExit(); return@LaunchedEffect }
        session.limitMin?.takeIf { it > 0 }?.let { mins ->
            scope.launch { delay((mins * 60_000).toLong()); tickDominantOnExit(); onExit() }
        }
        val childId = c.auth.childSlug
        for (i in deck.indices) {
            pos = i; clue = ""
            // Let the new image actually be ON SCREEN before the word plays.
            delay(350)
            c.gameAudio.speakAwait(deck[i].label, childId)
            for (cl in deck[i].descriptiveClues ?: emptyList()) {
                clue = cl
                c.gameAudio.speakAwait(cl, childId)
                delay(350)
            }
            delay(900)
        }
        tickDominantOnExit(); onExit()
    }

    val tile = deck.getOrNull(pos)
    SlideScaffold(
        tile = tile,
        caption = null,   // the tile art carries its own caption band
        sub = clue.takeIf { it.isNotEmpty() },
        progress = if (deck.isNotEmpty()) "${minOf(pos + 1, deck.size)} / ${deck.size}" else null,
    ) { tickDominantOnExit(); onExit() }
}

/** Shared full-screen slide chrome for the two slideshow modes. */
@Composable
private fun SlideScaffold(
    tile: Tile?,
    caption: String?,
    sub: String?,
    progress: String?,
    onExit: () -> Unit,
) {
    val c = LocalAppContainer.current
    val image by produceState<Bitmap?>(initialValue = null, tile?.imageKey) {
        val key = tile?.imageKey
        value = if (key.isNullOrEmpty()) null else c.media.bitmap(key)
    }

    Box(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        Column(
            Modifier.fillMaxSize().padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            val img = image
            if (img != null) {
                Image(img.asImageBitmap(), contentDescription = tile?.label,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.widthIn(max = 720.dp).heightIn(max = 480.dp)
                        .clip(RoundedCornerShape(32.dp)))
            } else if (tile != null) {
                CircularProgressIndicator(color = Brand.pinkDeep, modifier = Modifier.height(48.dp))
            }
            caption?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, fontSize = 44.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            }
            Spacer(Modifier.height(16.dp))
            Text(
                sub ?: " ",
                fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Brand.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 44.dp).heightIn(min = 70.dp),
            )
            progress?.let {
                Text(it, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = hexColor("#d6a8c6"))
            }
        }
        LongPressExitButton(onExit = onExit, modifier = Modifier.align(Alignment.TopEnd))
    }
}

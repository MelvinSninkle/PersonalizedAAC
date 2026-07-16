package io.andrewpeterson.myworld.ui.game

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.game.GameController
import io.andrewpeterson.myworld.live.LivePayload
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.net.GameLogPayload
import io.andrewpeterson.myworld.net.submitGameLog
import io.andrewpeterson.myworld.ui.LongPressExitButton
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Expressive naming — port of `Views/ExpressiveNamingView.swift`: the image
 * is shown ALONE (no audio prompt, no choices); the child speaks/gestures the
 * answer unaided. A short tap on the image skips (recorded fail, method tap);
 * facilitator `mark{method}` = pass; `skip`/`next` = fail; `end` stops.
 */
@Composable
fun ExpressiveNamingView(session: GameController.Session, onExit: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val inGameCommand by c.game.inGameCommand.collectAsState()

    var targets by remember { mutableStateOf<List<Tile>>(emptyList()) }
    var index by remember { mutableIntStateOf(0) }
    var correctCount by remember { mutableIntStateOf(0) }
    var celebrating by remember { mutableStateOf(false) }
    var finished by remember { mutableStateOf(false) }
    var lastHandledCmdSeq by remember { mutableIntStateOf(0) }

    val startedAt = remember { Date() }
    val loggedAttempts = remember { mutableListOf<GameLogPayload.Attempt>() }
    val iso = remember {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
    }

    val target: Tile? = targets.getOrNull(index)

    fun payload() = LivePayload(
        target = target?.let { LivePayload.Target(it.label, it.imageKey) },
        i = index, total = targets.size, correctCount = correctCount,
    )

    fun record(t: Tile, passed: Boolean, method: String, attemptsTaken: Int = 1) {
        loggedAttempts.add(GameLogPayload.Attempt(
            itemId = t.id, label = t.label,
            category = t.taxonomySlug?.split('.')?.dropLast(1)?.joinToString(".")?.takeIf { it.isNotEmpty() },
            taxonomySlug = t.taxonomySlug, correct = passed, inputMethod = method,
            misses = if (passed) 0 else 1, attemptsTaken = maxOf(1, attemptsTaken),
            distractorCount = 0, childGenerated = method != "tap",
            occurredAt = iso.format(Date()),
        ))
    }

    fun finishGame(reason: String = "completed") {
        if (finished) return
        finished = true
        c.live.setEnded(payload())
        scope.launch { c.gameAudio.playCheer(c.auth.childSlug) }
        if (loggedAttempts.isNotEmpty()) {
            val counts = mutableMapOf<String, Int>()
            for (a in loggedAttempts) a.taxonomySlug?.takeIf { it.isNotEmpty() }?.let {
                counts[it] = (counts[it] ?: 0) + 1
            }
            val p = GameLogPayload(
                childId = c.auth.childSlug, mode = "expressive_naming", category = session.scope,
                startedAt = iso.format(startedAt), endedAt = iso.format(Date()),
                itemCount = targets.size, slidesAttempted = loggedAttempts.size,
                correctCount = correctCount, scoringVersion = 2, endReason = reason,
                skillSlug = counts.maxByOrNull { it.value }?.key,
                attempts = loggedAttempts.toList(),
            )
            scope.launch { c.api.submitGameLog(p) }
        }
        scope.launch { delay(4_400); onExit() }
    }

    fun advance(afterMs: Long = 0) {
        scope.launch {
            if (afterMs > 0) delay(afterMs)
            if (index + 1 < targets.size) { index += 1; c.live.setRunning(payload()) }
            else finishGame()
        }
    }

    LaunchedEffect(Unit) {
        var picked = c.board.tilesForScope(session.scope, session.from, session.to)
            .filter { !it.imageKey.isNullOrEmpty() }.shuffled()
        session.sample?.takeIf { it > 0 }?.let { picked = picked.take(it) }
        targets = picked
        if (targets.isEmpty()) { finishGame("empty_scope"); return@LaunchedEffect }
        c.live.setRunning(payload())
        session.limitMin?.takeIf { it > 0 }?.let { mins ->
            scope.launch { delay((mins * 60_000).toLong()); finishGame("timeout") }
        }
    }

    LaunchedEffect(inGameCommand) {
        val cmd = inGameCommand ?: return@LaunchedEffect
        if (cmd.seq <= lastHandledCmdSeq) return@LaunchedEffect
        lastHandledCmdSeq = cmd.seq
        when (cmd.action) {
            "mark" -> {
                val method = cmd.method?.takeIf { it.isNotEmpty() } ?: "verbal"
                target?.let { t ->
                    correctCount += 1
                    record(t, true, method, cmd.attemptsTaken ?: 1)
                    celebrating = true
                    scope.launch { delay(1_400); celebrating = false }
                }
                advance(600)
            }
            "next", "skip" -> { target?.let { record(it, false, "tap") }; advance() }
            "end" -> finishGame("facilitator_stop")
        }
        c.game.consumeInGameCommand()
    }

    val image by produceState<Bitmap?>(initialValue = null, target?.imageKey) {
        val key = target?.imageKey
        value = if (key.isNullOrEmpty()) null else c.media.bitmap(key, maxDim = 640)
    }

    Box(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        if (finished) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center) {
                Text("🎉", fontSize = 96.sp)
                Text("Great job!", fontSize = 52.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            }
        } else {
            Column(
                Modifier.fillMaxSize().padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                val img = image
                if (img != null) {
                    Image(img.asImageBitmap(), contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.widthIn(max = 720.dp).heightIn(max = 520.dp)
                            .clip(RoundedCornerShape(32.dp))
                            // Short tap = skip (fail, method tap) — the child
                            // moved on without naming it.
                            .clickable { target?.let { record(it, false, "tap") }; advance() })
                } else if (target != null) {
                    CircularProgressIndicator(color = Brand.pinkDeep)
                }
            }
        }
        LongPressExitButton(onExit = { finishGame("facilitator_stop") },
            modifier = Modifier.align(Alignment.TopEnd))
        ConfettiView(running = celebrating)
    }
}

package io.andrewpeterson.myworld.ui.game

import android.graphics.Bitmap
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.offset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.game.GameController
import io.andrewpeterson.myworld.live.LivePayload
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.model.display
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
 * Facilitated matching game — "find the one I say" — port of
 * `Views/MatchingView.swift`. Also drives Auditory Comprehension and Clue
 * Quiz (same lifecycle; only the prompt source differs).
 *
 * Pedagogy (identical to web + iOS):
 *  - target ANNOUNCED with audio, no text shown to the child
 *  - wrong tap → no negative feedback; 1st miss wiggles + glows the answer
 *    and re-announces (clue quiz reveals the NEXT clue); 2nd miss reveals +
 *    advances (recorded as fail)
 *  - correct tap → green pop + confetti + FULL PASS regardless of misses
 *    (mercy scoring v2)
 *  - facilitator mark/skip/end arrive via the live channel
 */
@Composable
fun MatchingView(session: GameController.Session, onExit: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val inGameCommand by c.game.inGameCommand.collectAsState()

    var targets by remember { mutableStateOf<List<Tile>>(emptyList()) }
    var index by remember { mutableIntStateOf(0) }
    var choiceTiles by remember { mutableStateOf<List<Tile>>(emptyList()) }
    var correctCount by remember { mutableIntStateOf(0) }

    var misses by remember { mutableIntStateOf(0) }
    var locked by remember { mutableStateOf(false) }
    var glowCorrect by remember { mutableStateOf(false) }
    var wiggleCorrectId by remember { mutableStateOf<Int?>(null) }
    var chosenCorrectId by remember { mutableStateOf<Int?>(null) }

    var celebrating by remember { mutableStateOf(false) }
    var finished by remember { mutableStateOf(false) }
    var lastHandledCmdSeq by remember { mutableIntStateOf(0) }
    var pendingMarkMethod by remember { mutableStateOf<String?>(null) }

    val startedAt = remember { Date() }
    val loggedAttempts = remember { mutableListOf<GameLogPayload.Attempt>() }
    val iso = remember {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
    }

    val target: Tile? = targets.getOrNull(index)
    val choiceCount = (session.choices ?: 3).coerceIn(2, 6)

    fun currentPayload() = LivePayload(
        target = target?.let { LivePayload.Target(it.label, it.imageKey) },
        i = index, total = targets.size, correctCount = correctCount,
    )

    fun cluePrompt(t: Tile, missCount: Int): String {
        // Clues/descriptions are English taxonomy prose — translated boards
        // hear the word itself in the board's language.
        if (!t.displayLabel.isNullOrEmpty()) return t.display
        val clues = (t.descriptiveClues ?: emptyList()).map { it.trim() }.filter { it.isNotEmpty() }
        if (clues.isNotEmpty()) return clues[minOf(missCount, clues.size - 1)]
        t.description?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        return "Who or what is the ${t.label}?"
    }

    fun announceTarget() {
        val t = target ?: return
        when (session.mode) {
            is GameController.Mode.AuditoryComprehension -> {
                val desc = t.description?.trim()
                val prompt = if (!t.displayLabel.isNullOrEmpty()) t.display
                    else if (!desc.isNullOrEmpty()) desc else "Who or what is the ${t.label}?"
                c.gameAudio.speak(prompt, c.auth.childSlug)
            }
            is GameController.Mode.ClueQuiz ->
                c.gameAudio.speak(cluePrompt(t, misses), c.auth.childSlug)
            else -> c.tilePlayer.play(t)   // no childId — game logs via game-log
        }
    }

    fun buildChoices() {
        val t = target ?: run { choiceTiles = emptyList(); return }
        val pool = c.board.tilesForScope(session.scope, session.from, session.to)
            .filter { it.id != t.id && !it.imageKey.isNullOrEmpty() }
        val fallback = c.board.tiles.value.filter { it.id != t.id && !it.imageKey.isNullOrEmpty() }
        val source = if (pool.size >= choiceCount - 1) pool else fallback
        val distractors = source.shuffled().take(choiceCount - 1)
        choiceTiles = (listOf(t) + distractors).shuffled()
    }

    fun recordAttempt(t: Tile, passed: Boolean) {
        val method = pendingMarkMethod ?: "tap"
        pendingMarkMethod = null
        val attemptsTaken = if (passed) misses + 1 else misses
        loggedAttempts.add(GameLogPayload.Attempt(
            itemId = t.id,
            label = t.label,
            category = t.taxonomySlug?.split('.')?.dropLast(1)?.joinToString(".")?.takeIf { it.isNotEmpty() },
            taxonomySlug = t.taxonomySlug,
            correct = passed,
            inputMethod = method,
            misses = misses,
            attemptsTaken = maxOf(1, attemptsTaken),
            distractorCount = maxOf(0, choiceTiles.size - 1),
            childGenerated = method != "tap",
            occurredAt = iso.format(Date()),
        ))
    }

    fun submitLog(endReason: String) {
        if (loggedAttempts.isEmpty()) return
        val modeStr = when (session.mode) {
            is GameController.Mode.Matching -> "self_paced"
            is GameController.Mode.AuditoryComprehension -> "auditory_comprehension"
            is GameController.Mode.ClueQuiz -> "clue_quiz"
            is GameController.Mode.ExpressiveNaming -> "expressive_naming"
            is GameController.Mode.Slideshow ->
                if ((session.mode as GameController.Mode.Slideshow).firstPerson) "exposure_slideshow" else "learn_slideshow"
            is GameController.Mode.Teach -> "teach_slideshow"
            is GameController.Mode.Celebration -> "celebration"
        }
        val counts = mutableMapOf<String, Int>()
        for (a in loggedAttempts) a.taxonomySlug?.takeIf { it.isNotEmpty() }?.let {
            counts[it] = (counts[it] ?: 0) + 1
        }
        val payload = GameLogPayload(
            childId = c.auth.childSlug, mode = modeStr, category = session.scope,
            startedAt = iso.format(startedAt), endedAt = iso.format(Date()),
            itemCount = targets.size,
            slidesAttempted = loggedAttempts.size,     // honest denominator
            correctCount = correctCount, scoringVersion = 2, endReason = endReason,
            skillSlug = counts.maxByOrNull { it.value }?.key,
            attempts = loggedAttempts.toList(),
        )
        scope.launch { c.api.submitGameLog(payload) }
    }

    fun finishGame(reason: String = "completed") {
        if (finished) return
        finished = true
        c.live.setEnded(currentPayload())
        scope.launch { c.gameAudio.playCheer(c.auth.childSlug) }
        submitLog(reason)
        scope.launch { delay(4_400); onExit() }
    }

    fun startRound() {
        misses = 0; locked = false; glowCorrect = false
        wiggleCorrectId = null; chosenCorrectId = null
        buildChoices()
        c.live.setRunning(currentPayload())
        announceTarget()
    }

    fun advance(afterMs: Long = 0) {
        scope.launch {
            if (afterMs > 0) delay(afterMs)
            if (index + 1 < targets.size) { index += 1; startRound() }
            else finishGame()
        }
    }

    fun celebrate() {
        celebrating = true
        scope.launch { delay(1_400); celebrating = false }
    }

    fun tap(tile: Tile, t: Tile) {
        if (locked) return
        if (tile.id == t.id) {
            // Correct → FULL PASS regardless of misses (mercy v2).
            locked = true
            chosenCorrectId = tile.id
            correctCount += 1
            recordAttempt(t, passed = true)
            c.tilePlayer.play(t)
            celebrate()
            advance(950)
        } else {
            misses += 1
            if (misses == 1) {
                glowCorrect = true
                wiggleCorrectId = t.id
                scope.launch { delay(500); wiggleCorrectId = null }
                announceTarget()   // clue quiz: this speaks the NEXT clue
            } else {
                locked = true
                recordAttempt(t, passed = false)
                advance(900)
            }
        }
    }

    // Setup once.
    LaunchedEffect(Unit) {
        var pool = c.board.tilesForScope(session.scope, session.from, session.to)
            .filter { !it.imageKey.isNullOrEmpty() }
        if (session.mode is GameController.Mode.ClueQuiz) {
            val cluey = pool.filter {
                !it.descriptiveClues.isNullOrEmpty() || !it.description.isNullOrEmpty()
            }
            if (cluey.isNotEmpty()) pool = cluey
        }
        var picked = pool.shuffled()
        session.sample?.takeIf { it > 0 }?.let { picked = picked.take(it) }
        targets = picked
        index = 0; correctCount = 0
        if (targets.isEmpty()) { finishGame("empty_scope"); return@LaunchedEffect }
        c.gameAudio.startMusic(session.music)
        startRound()
        session.limitMin?.takeIf { it > 0 }?.let { mins ->
            scope.launch { delay((mins * 60_000).toLong()); finishGame("timeout") }
        }
    }
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose { c.gameAudio.stopMusic() }
    }

    // Facilitator commands via the live channel.
    LaunchedEffect(inGameCommand) {
        val cmd = inGameCommand ?: return@LaunchedEffect
        if (cmd.seq <= lastHandledCmdSeq) return@LaunchedEffect
        lastHandledCmdSeq = cmd.seq
        when (cmd.action) {
            "next", "skip" -> {
                target?.let { t -> if (!locked) { pendingMarkMethod = null; recordAttempt(t, false) } }
                advance()
            }
            "mark" -> {
                val method = cmd.method?.takeIf { it.isNotEmpty() } ?: "verbal"
                pendingMarkMethod = method
                cmd.attemptsTaken?.takeIf { it > 1 }?.let { misses = maxOf(misses, it - 1) }
                target?.let { t ->
                    if (!locked) {
                        correctCount += 1; celebrate(); recordAttempt(t, true); locked = true
                    }
                }
                advance(600)
            }
            "end" -> finishGame("facilitator_stop")
        }
        c.game.consumeInGameCommand()
    }

    // ── UI ──────────────────────────────────────────────────────────────────

    Box(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        when {
            finished -> Column(
                Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("🎉", fontSize = 96.sp)
                Text("Great job!", fontSize = 52.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            }
            target != null -> Column(
                Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // "Listen" replays the PROMPT (clue/description in those modes,
                // never the answer word). No text — the child listens.
                Row(
                    Modifier
                        .background(Color.White, CircleShape)
                        .border(3.dp, Brand.pink, CircleShape)
                        .clickable { announceTarget() }
                        .padding(horizontal = 28.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("🔊", fontSize = 24.sp)
                    Spacer(Modifier.width(12.dp))
                    Text("Listen", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                }
                Spacer(Modifier.weight(1f))
                val cols = if (choiceCount <= 4) choiceCount else 3
                LazyVerticalGrid(
                    columns = GridCells.Fixed(cols),
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                    modifier = Modifier.widthIn(max = 860.dp),
                ) {
                    items(choiceTiles, key = { it.id }) { tile ->
                        val isAnswer = tile.id == target.id
                        ChoiceTileView(
                            tile = tile,
                            glow = isAnswer && glowCorrect,
                            wiggle = wiggleCorrectId == tile.id,
                            pop = chosenCorrectId == tile.id,
                            dim = chosenCorrectId != null && chosenCorrectId != tile.id,
                            onTap = { tap(tile, target) },
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                Spacer(Modifier.height(40.dp))
            }
            else -> Text("Nothing to practice here", fontSize = 22.sp, color = Brand.muted,
                modifier = Modifier.align(Alignment.Center))
        }

        LongPressExitButton(onExit = { submitLog("facilitator_stop"); onExit() },
            modifier = Modifier.align(Alignment.TopEnd))
        ConfettiView(running = celebrating)
    }
}

/**
 * One tappable choice — visual states drive the errorless scaffolding:
 * glow (yellow, on the answer), wiggle (brief shake), pop (green ring on the
 * picked answer), dim (fade the others once found).
 */
@Composable
fun ChoiceTileView(
    tile: Tile,
    glow: Boolean,
    wiggle: Boolean,
    pop: Boolean,
    dim: Boolean,
    onTap: () -> Unit,
) {
    val c = LocalAppContainer.current
    val image by produceState<Bitmap?>(initialValue = null, tile.imageKey) {
        val key = tile.imageKey
        value = if (key.isNullOrEmpty()) null else c.media.bitmap(key, maxDim = 640)
    }

    val offsetX by animateFloatAsState(
        targetValue = if (wiggle) -8f else 0f,
        animationSpec = if (wiggle) keyframes {
            durationMillis = 450
            -8f at 0; 8f at 75; -8f at 150; 8f at 225; -8f at 300; 0f at 450
        } else spring(),
        label = "wiggle",
    )
    val scale by animateFloatAsState(if (pop) 1.06f else 1f, spring(), label = "pop")
    val alpha by animateFloatAsState(if (dim) 0.4f else 1f, tween(200), label = "dim")

    val borderColor = when {
        pop -> Brand.good
        glow -> Color(0xFFFACC15)
        else -> Color.Black.copy(alpha = 0.08f)
    }
    val borderWidth = if (pop || glow) 6.dp else 2.dp

    Box(
        Modifier
            .offset(x = offsetX.dp)
            .scale(scale)
            .alpha(alpha)
            .aspectRatio(1f)
            .clip(RoundedCornerShape(24.dp))
            .background(Color.White)
            .border(borderWidth, borderColor, RoundedCornerShape(24.dp))
            .clickable(onClick = onTap),
        contentAlignment = Alignment.Center,
    ) {
        val img = image
        if (img != null) {
            Image(img.asImageBitmap(), contentDescription = tile.label,
                contentScale = if (tile.keepAspect) ContentScale.Fit else ContentScale.Crop,
                modifier = Modifier.fillMaxSize())
        } else {
            CircularProgressIndicator(color = Brand.pinkDeep)
        }
    }
}

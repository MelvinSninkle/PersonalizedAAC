package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.game.GameController
import io.andrewpeterson.myworld.model.BoardMetrics
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.model.Category
import io.andrewpeterson.myworld.model.childPossessive
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * The kid board — port of `Views/BoardView.swift` (M3 scope: read-only board
 * with tap-to-speak; games/listening/live/edit overlays land with their
 * milestones).
 *
 * ONE uniform tile size is computed here for the WHOLE board; each column's
 * width is `tilesAcross × tile`, so lowering a section's tiles-across makes
 * that column NARROWER (tiles keep their size) and the freed space becomes
 * whitespace on the right.
 */
@Composable
fun BoardView() {
    val c = LocalAppContainer.current
    val prefs by c.displayPrefs.data.collectAsState()
    val tiles by c.board.tiles.collectAsState()
    val loading by c.board.loading.collectAsState()

    var editMode by remember { mutableStateOf(false) }
    var openRoom by remember { mutableStateOf<Category?>(null) }
    var didInitialLoad by remember { mutableStateOf(false) }
    var showUnlock by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var showDisplay by remember { mutableStateOf(false) }

    val gameSession by c.game.current.collectAsState()
    val liveCommand by c.live.latest.collectAsState()
    val staged by c.autoTeach.staged.collectAsState()

    var listening by remember { mutableStateOf(false) }
    var showSttUpsell by remember { mutableStateOf(false) }
    var showSttUnavailable by remember { mutableStateOf(false) }
    var pendingMessage by remember { mutableStateOf<List<io.andrewpeterson.myworld.live.MessageToken>?>(null) }
    val lastHeardAt by c.speechListener.lastHeardAt.collectAsState()
    val micPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) { listening = true } }

    fun toggleListening() {
        if (listening) { listening = false; return }
        if (!c.board.sttAllowed) { showSttUpsell = true; return }
        if (!c.speechListener.available) { showSttUnavailable = true; return }
        if (!c.speechListener.hasPermission) {
            micPermission.launch(android.Manifest.permission.RECORD_AUDIO); return
        }
        listening = true
    }

    // Start/stop the mic on toggle; auto-stop after 2 minutes of silence
    // (each recognized phrase reschedules via lastHeardAt).
    LaunchedEffect(listening) {
        if (listening) {
            if (gameSession != null) { listening = false; return@LaunchedEffect }
            c.speechListener.start()
            var deadline = System.currentTimeMillis() + 120_000
            while (listening) {
                kotlinx.coroutines.delay(2_000)
                if (lastHeardAt + 120_000 > deadline) deadline = lastHeardAt + 120_000
                if (System.currentTimeMillis() > deadline) { listening = false }
            }
        } else {
            c.speechListener.stop()
        }
    }

    LaunchedEffect(Unit) {
        val slug = c.auth.childSlug
        c.displayPrefs.attach(slug)
        c.board.refresh(slug)
        didInitialLoad = true
        c.live.start(slug)
        c.autoTeach.start(slug)
    }
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose { c.live.stop(); c.autoTeach.stop() }
    }

    // Route incoming facilitator commands (message overlay lands in M7).
    LaunchedEffect(liveCommand) {
        val cmd = liveCommand ?: return@LaunchedEffect
        when (cmd.action) {
            "listen-start" -> if (c.speechListener.available && c.speechListener.hasPermission) listening = true
            "listen-stop" -> listening = false
            "message" -> cmd.tokens?.takeIf { it.isNotEmpty() }?.let { pendingMessage = it }
            else -> c.game.apply(cmd)
        }
        c.live.acknowledge()
    }

    // A remotely-ended game clears current without the cover's onExit running —
    // ANY transition to no-game must publish standby (the ghost-session lesson).
    LaunchedEffect(gameSession) {
        if (gameSession == null) c.live.setStandby()
    }

    // Header Play/Teach: quiz or teach the last-pressed scope (10 sampled).
    fun startSelfQuiz() {
        val scope = io.andrewpeterson.myworld.game.PlayScope.recall(c.auth.childSlug) ?: "all"
        val playable = c.board.tilesForScope(scope).count { !it.imageKey.isNullOrEmpty() }
        val useScope = if (playable >= 2) scope else "all"
        c.game.startLocal(GameController.Mode.Matching, scope = useScope, choices = 3, sample = 10)
    }
    fun startTeachShow() {
        val scope = io.andrewpeterson.myworld.game.PlayScope.recall(c.auth.childSlug) ?: "all"
        val playable = c.board.tilesForScope(scope).count { !it.imageKey.isNullOrEmpty() }
        val useScope = if (playable >= 1) scope else "all"
        c.game.startLocal(GameController.Mode.Teach, scope = useScope)
    }

    Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        HeaderBar(
            editMode = editMode,
            onLockTap = { if (editMode) editMode = false },
            onLockLongPress = { if (!editMode) showUnlock = true },
            onTripleTap = { showSettings = true },
            onShowDisplay = { showDisplay = true },
            onTeachTap = { startTeachShow() },
            onPlayTap = { startSelfQuiz() },
            onListenTap = { toggleListening() },
            listening = listening,
        )

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val widthDp = maxWidth.value
            val visible = listOf(BoardSection.PEOPLE, BoardSection.NOUNS, BoardSection.VERBS)
                .filter { c.displayPrefs.show(it) }
            val tile = computeTileSize(widthDp, visible.map { c.displayPrefs.across(it) })

            Column(Modifier.fillMaxSize()) {
                Row(Modifier.weight(1f)) {
                    visible.forEachIndexed { idx, section ->
                        androidx.compose.foundation.layout.Box(
                            Modifier
                                .width(BoardMetrics.columnWidth(c.displayPrefs.across(section), tile).dp)
                                .fillMaxHeight(),
                        ) {
                            SectionColumn(
                                section = section,
                                tileSize = tile.dp,
                                editMode = editMode,
                                onOpenRoom = { openRoom = it },
                            )
                        }
                        if (idx < visible.size - 1) VerticalDivider()
                    }
                    Spacer(Modifier.weight(1f, fill = true))   // freed space → whitespace
                }
                if (prefs.showNeeds) {
                    HorizontalDivider()
                    NeedsStrip(tileSize = tile.dp, editMode = editMode)
                }
            }

            // Brand-new board with no tiles yet → friendly welcome (after the
            // first refresh so it never flashes mid-load).
            if (didInitialLoad && tiles.isEmpty() && !loading && !editMode) {
                EmptyBoardView(possessive = childPossessive(c.auth.childSlug)) {
                    // Re-pull — the server-side build lands tiles as it goes.
                }
            }
        }
    }

    openRoom?.let { room ->
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { openRoom = null },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
        ) {
            RoomInteriorView(room, tileSize = 120.dp) { openRoom = null }
        }
    }
    if (showUnlock) UnlockSheet(onDismiss = { showUnlock = false }, onUnlock = { editMode = true })
    if (showSettings) SettingsView { showSettings = false }
    if (showDisplay) DisplaySettingsView { showDisplay = false }
    if (showSttUpsell) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showSttUpsell = false },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = { showSttUpsell = false }) {
                    androidx.compose.material3.Text("OK")
                }
            },
            title = { androidx.compose.material3.Text("Speech-to-text is a membership feature") },
            text = { androidx.compose.material3.Text(
                "Turn spoken words into picture tiles in real time — part of every My World membership, from $4.99/month. Join in the parent app under Credits & Store. Everything you've already made stays yours forever.") },
        )
    }
    if (showSttUnavailable) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showSttUnavailable = false },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = { showSttUnavailable = false }) {
                    androidx.compose.material3.Text("OK")
                }
            },
            title = { androidx.compose.material3.Text("Speech isn't supported on this device") },
            text = { androidx.compose.material3.Text(
                "This device has no speech-recognition service (that's normal on Fire tablets). Everything else works — the board, games, Teach Me, and all of your personalized tiles.") },
        )
    }

    // Auto-teach staged an activity: countdown card → session with the
    // slugs: scope; ✕ skips this round. Never over a running game/edit.
    staged?.let { s ->
        if (gameSession == null && !editMode) {
            io.andrewpeterson.myworld.ui.game.AutoTeachCountdownCard(
                mode = s.mode,
                onFire = {
                    val session = GameController.Session(
                        mode = if (s.mode == "game") GameController.Mode.Matching
                               else GameController.Mode.Slideshow(firstPerson = s.labelStyle == "first_person"),
                        scope = "slugs:" + s.slugs.joinToString(","),
                        choices = if (s.mode == "game") 3 else null,
                        limitMin = if (s.mode == "game") s.sessionMaxMin else null,
                        secondsPerImage = s.secondsPerImage,
                    )
                    c.game.startStaged(session)
                    c.autoTeach.consumeStaged(fired = true)
                },
                onSkip = { c.autoTeach.consumeStaged(fired = false) },
            )
        }
    }

    // Parent's message-to-the-board — overlay-only, never via GameController.
    pendingMessage?.let { toks ->
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { pendingMessage = null },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
        ) {
            MessageOverlayView(tokens = toks, childId = c.auth.childSlug) { pendingMessage = null }
        }
    }

    // Full-screen game cover — routes the session's mode to its view, exactly
    // like the iOS fullScreenCover switch.
    gameSession?.let { session ->
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { /* games exit via hold-✕ or completion only */ },
            properties = androidx.compose.ui.window.DialogProperties(
                usePlatformDefaultWidth = false,
                dismissOnBackPress = false,
                dismissOnClickOutside = false,
            ),
        ) {
            val endGame: () -> Unit = {
                val routineContinues = c.game.sessionDidEnd()
                if (!routineContinues) c.live.setStandby()
            }
            when (session.mode) {
                is GameController.Mode.Matching,
                is GameController.Mode.AuditoryComprehension,
                is GameController.Mode.ClueQuiz ->
                    io.andrewpeterson.myworld.ui.game.MatchingView(session, endGame)
                is GameController.Mode.ExpressiveNaming ->
                    io.andrewpeterson.myworld.ui.game.ExpressiveNamingView(session, endGame)
                is GameController.Mode.Slideshow ->
                    io.andrewpeterson.myworld.ui.game.SlideshowView(session, endGame)
                is GameController.Mode.Teach ->
                    io.andrewpeterson.myworld.ui.game.TeachShowView(session, endGame)
                is GameController.Mode.Celebration ->
                    io.andrewpeterson.myworld.ui.game.CelebrationView(endGame)
            }
        }
    }
}

/**
 * The layout math from BoardView.swift `computeLayout` — pure function so it
 * unit-tests against known iPad widths.
 */
fun computeTileSize(widthDp: Float, acrossPerVisibleColumn: List<Int>): Float {
    val n = acrossPerVisibleColumn.size
    if (n == 0 || widthDp <= 0f) return BoardMetrics.MIN_TILE
    val totalAcross = acrossPerVisibleColumn.sum()
    if (totalAcross <= 0) return BoardMetrics.MIN_TILE

    // Width consumed by gaps, paddings, dividers (i.e. not tiles).
    var chrome = (n - 1) * BoardMetrics.DIVIDER_WIDTH
    for (a in acrossPerVisibleColumn) {
        chrome += 2 * BoardMetrics.COLUMN_PAD + (a - 1) * BoardMetrics.TILE_GAP
    }
    val availForTiles = (widthDp - chrome).coerceAtLeast(0f)

    // Constant comfortable size … but never overflow when packed.
    val idealTile = widthDp / BoardMetrics.REFERENCE_ACROSS
    val fitTile = availForTiles / totalAcross
    return maxOf(BoardMetrics.MIN_TILE, minOf(idealTile, fitTile))
}

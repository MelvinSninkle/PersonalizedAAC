package io.andrewpeterson.myworld.ui.parent

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import io.andrewpeterson.myworld.model.prettyChildName
import io.andrewpeterson.myworld.net.ProblemEntry
import io.andrewpeterson.myworld.net.StyleGuideInfo
import io.andrewpeterson.myworld.net.StyleOverview
import io.andrewpeterson.myworld.net.advanceBand
import io.andrewpeterson.myworld.net.storeProblems
import io.andrewpeterson.myworld.net.storeRearmAdd
import io.andrewpeterson.myworld.net.storeRetry
import io.andrewpeterson.myworld.net.bandStatus
import io.andrewpeterson.myworld.net.changePassword
import io.andrewpeterson.myworld.net.childSettings
import io.andrewpeterson.myworld.net.deleteAccount
import io.andrewpeterson.myworld.net.imageBytes
import io.andrewpeterson.myworld.net.saveChildSettingsKey
import io.andrewpeterson.myworld.net.setStyle
import io.andrewpeterson.myworld.net.setStyleRef
import io.andrewpeterson.myworld.net.storeCatalog
import io.andrewpeterson.myworld.net.styleOverview
import io.andrewpeterson.myworld.net.upload
import io.andrewpeterson.myworld.storage.downscaleJpeg
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The parent app home — port of `Parent/ParentHomeView.swift`'s card grid.
 * M7 wires the live-channel cards (Start a game, Message the board, the
 * auto-popping facilitator console, Quick board); the remaining cards open
 * as their milestones land (store M12-read/M9, stats M9, shop/auto-teach/
 * album/schedules/people M10).
 */
@Composable
fun ParentHomeView() {
    val c = LocalAppContainer.current
    val isRunning by c.parentLive.isRunning.collectAsState()

    var open by remember { mutableStateOf<String?>(null) }
    var facilitatorDismissed by remember { mutableStateOf(false) }
    // Live credit balance for the Credits & Store card's yellow badge —
    // the parent always knows what they have before they spend.
    var creditBalance by remember { mutableStateOf<Int?>(null) }
    // Renders that failed every attempt — alert banner with one-tap retry
    // (word redraws: first free; failed photo adds: no charge).
    var problems by remember { mutableStateOf<List<ProblemEntry>>(emptyList()) }
    var problemBusy by remember { mutableStateOf(setOf<String>()) }

    LaunchedEffect(Unit) {
        c.parentLive.start(c.auth.childSlug)
        c.board.refresh(c.auth.childSlug)   // scopes for StartGame + quick board
        creditBalance = try { c.api.storeCatalog().balance } catch (_: Exception) { null }
        problems = c.api.storeProblems(c.auth.childSlug)
    }
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose { c.parentLive.stop() }
    }
    // Auto-pop the facilitator console while a game runs (re-arms when idle).
    LaunchedEffect(isRunning) { if (!isRunning) facilitatorDismissed = false }

    val cards = listOf(
        Triple("store", "⭐", "Credits & Store"),
        Triple("addtile", "📷", "Add a tile"),
        Triple("message", "💬", "Message the board"),
        Triple("quickboard", "🗂", "Quick board"),
        // ("Family & people" is gone — everything it did is reachable from
        // Add a tile's People flow. Listening mode is its own card again.)
        Triple("listening", "🎙", "Listening mode"),
        Triple("game", "🎯", "Start a game"),
        Triple("stats", "📊", "Stats"),
        Triple("schedules", "⏰", "Schedules"),
        Triple("album", "🖼", "Album"),
        Triple("autoteach", "📚", "Auto-teach"),
    )

    Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        // Branded compact header: title + gear.
        Row(
            Modifier.fillMaxWidth().background(Brand.pink).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("🌍", fontSize = 22.sp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("My World: ${prettyChildName(c.auth.childSlug).ifEmpty { "your child" }}",
                    fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text("Tap to talk — parent tools", fontSize = 12.sp, color = Color.White.copy(alpha = 0.85f))
            }
            Box(
                Modifier.size(40.dp).background(Color.White.copy(alpha = 0.18f), CircleShape)
                    .clickable { open = "settings" },
                contentAlignment = Alignment.Center,
            ) { Text("⚙", fontSize = 19.sp) }
        }

        // ⚠️ Pictures that failed every render attempt — the parent's alert
        // with one-tap retry. Word tiles re-render (first retry per tile
        // free, then credits — server-enforced); failed photo adds restart
        // at no charge (paid at enqueue, never delivered).
        if (problems.isNotEmpty()) {
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 12.dp)
                    .background(hexColor("#fef3c7"), RoundedCornerShape(16.dp))
                    .border(1.dp, hexColor("#f59e0b"), RoundedCornerShape(16.dp))
                    .padding(14.dp),
            ) {
                Text("⚠️ ${problems.size} picture${if (problems.size == 1) "" else "s"} didn't finish",
                    fontSize = 16.sp, fontWeight = FontWeight.Bold, color = hexColor("#b45309"))
                Text("Retrying is safe — failed photo adds never re-charge, and each word's first redraw is free.",
                    fontSize = 12.sp, color = Brand.muted)
                problems.forEach { p ->
                    val pid = p.kind + "-" + (p.itemId ?: p.jobId ?: 0)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(p.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                            color = Brand.ink, modifier = Modifier.weight(1f))
                        androidx.compose.material3.TextButton(enabled = pid !in problemBusy, onClick = {
                            problemBusy = problemBusy + pid
                            scope.launch {
                                val ok = try {
                                    if (p.kind == "add" && p.jobId != null) c.api.storeRearmAdd(c.auth.childSlug, p.jobId)
                                    else if (p.itemId != null) { c.api.storeRetry(c.auth.childSlug, p.itemId, ""); true }
                                    else false
                                } catch (_: Exception) { false }
                                if (ok) problems = problems.filter { (it.kind + "-" + (it.itemId ?: it.jobId ?: 0)) != pid }
                                problemBusy = problemBusy - pid
                            }
                        }) {
                            Text(
                                if (pid in problemBusy) "Retrying…"
                                else if (p.kind == "add") "Try again (no charge)"
                                else if (p.freeRetryUsed == true) "Try again ⭐1" else "Try again (free)",
                                color = hexColor("#b45309"), fontWeight = FontWeight.Bold, fontSize = 13.sp,
                            )
                        }
                    }
                }
            }
        }

        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 160.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().padding(16.dp),
        ) {
            items(cards, key = { it.first }) { (id, emoji, title) ->
                Box(
                    Modifier
                        .background(Color.White, RoundedCornerShape(18.dp))
                        .border(1.dp, hexColor("#f3c6dd"), RoundedCornerShape(18.dp))
                        .clickable { open = id },
                ) {
                    Column(Modifier.padding(16.dp).height(88.dp)) {
                        Text(emoji, fontSize = 30.sp)
                        Spacer(Modifier.weight(1f))
                        Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
                    }
                    // Yellow balance badge on Credits & Store (iOS parity).
                    if (id == "store") creditBalance?.let { bal ->
                        Text(
                            "⭐ $bal", fontSize = 13.sp, fontWeight = FontWeight.Black,
                            color = hexColor("#92400e"),
                            modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)
                                .background(hexColor("#fde68a"), RoundedCornerShape(999.dp))
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                }
            }
        }
    }

    when (open) {
        "game" -> StartGameView { open = null }
        "message" -> MessageBoardView { open = null }
        "settings" -> ParentSettingsView { open = null }
        "quickboard" -> QuickBoardView { open = null }
        "stats" -> StatsView { open = null }
        "store" -> StoreView { open = null }
        "album" -> AlbumView { open = null }
        "schedules" -> SchedulesView { open = null }
        "listening" -> ListeningModeView { open = null }
        "autoteach" -> AutoTeachView { open = null }
        "addtile" -> io.andrewpeterson.myworld.ui.board.AddTileView(
            defaultSection = io.andrewpeterson.myworld.model.BoardSection.NOUNS,
            defaultCategoryId = null,
        ) { open = null }
        null -> {}
        else -> ComingSoonDialog(open!!) { open = null }
    }

    if (isRunning && !facilitatorDismissed && open == null) {
        FacilitatorView { facilitatorDismissed = true }
    }
}

/** Placeholder for the surfaces whose milestones haven't landed yet. */
@Composable
private fun ComingSoonDialog(id: String, onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                androidx.compose.material3.Text("OK")
            }
        },
        title = { androidx.compose.material3.Text("On its way") },
        text = { androidx.compose.material3.Text(
            "This screen lands in an upcoming build — until then, the web dashboard has it (aac.andrewpeterson.io).") },
    )
}

/** The phone fallback board — the SAME BoardView full-screen, hold-✕ exits. */
@Composable
private fun QuickBoardView(onDismiss: () -> Unit) {
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(Modifier.fillMaxSize()) {
            io.andrewpeterson.myworld.ui.board.BoardView()
            io.andrewpeterson.myworld.ui.LongPressExitButton(
                onExit = onDismiss,
                modifier = Modifier.align(Alignment.BottomEnd),
            )
        }
    }
}

/**
 * Parent settings — port of `Parent/ParentHomeView.swift`'s ParentSettingsView:
 * vocabulary band (status + unlock next), device role switch, web dashboard
 * link, sign out, and Play-policy-compliant in-app account deletion behind a
 * typed DELETE confirmation. Deep configuration stays on the web by design.
 */
@Composable
private fun ParentSettingsView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    var band by remember { mutableStateOf<io.andrewpeterson.myworld.net.BandStatus?>(null) }
    var advancing by remember { mutableStateOf(false) }
    var advanceMsg by remember { mutableStateOf<String?>(null) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var deleteText by remember { mutableStateOf("") }
    var deleteError by remember { mutableStateOf<String?>(null) }
    var showChangePw by remember { mutableStateOf(false) }
    var curPw by remember { mutableStateOf("") }
    var newPw by remember { mutableStateOf("") }
    var pwMsg by remember { mutableStateOf<String?>(null) }
    // Listening display filter (E8) — synced child settings, editable here
    // so a parent can flip them right on the device. Seeded below; the
    // loaded flag keeps the seed from firing the save callbacks.
    var listenCensor by remember { mutableStateOf(true) }
    var listenTilesOnly by remember { mutableStateOf(false) }
    var listenLoaded by remember { mutableStateOf(false) }
    // Art style — native twin of the web dashboard's style gallery
    // (/api/parent/style): current style + exact refs, switcher, own uploads.
    var styleOv by remember { mutableStateOf<StyleOverview?>(null) }
    var styleMsg by remember { mutableStateOf<String?>(null) }
    var pendingStyle by remember { mutableStateOf<StyleGuideInfo?>(null) }
    var showStyleList by remember { mutableStateOf(false) }
    var pendingUploadKind by remember { mutableStateOf<String?>(null) }
    var styleUploadKind by remember { mutableStateOf<String?>(null) }
    var styleUploading by remember { mutableStateOf(false) }

    suspend fun reloadStyles() {
        styleOv = try { c.api.styleOverview(c.auth.childSlug) } catch (_: Exception) { styleOv }
    }
    val pickStyleRef = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        val kind = styleUploadKind
        styleUploadKind = null
        if (uri == null || kind == null) return@rememberLauncherForActivityResult
        scope.launch {
            styleUploading = true
            try {
                val jpeg = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?.let { downscaleJpeg(it, maxDim = 1600) }
                } ?: throw Exception("couldn't read that photo")
                val key = c.api.upload("styleref", "jpg", jpeg, "image/jpeg")
                c.api.setStyleRef(c.auth.childSlug, kind, key)
                styleMsg = "Reference saved — new pictures follow it from now on."
                reloadStyles()
            } catch (e: Exception) {
                styleMsg = "Upload failed: ${e.message}"
            }
            styleUploading = false
        }
    }

    LaunchedEffect(Unit) {
        band = try { c.api.bandStatus(c.auth.childSlug) } catch (_: Exception) { null }
        val s = c.api.childSettings(c.auth.childSlug)
        fun bool(k: String) = (s[k] as? kotlinx.serialization.json.JsonPrimitive)
            ?.let { it.content == "true" }
        listenCensor = bool("listenCensor") ?: true
        listenTilesOnly = bool("listenTilesOnly") ?: false
        listenLoaded = true
        reloadStyles()
    }
    fun saveListen(key: String, value: Boolean) {
        if (!listenLoaded) return
        scope.launch {
            c.api.saveChildSettingsKey(c.auth.childSlug, key,
                kotlinx.serialization.json.JsonPrimitive(value))
            c.access.refresh()   // the board applies it without a relaunch
        }
    }
    fun openUrl(url: String) {
        try {
            context.startActivity(android.content.Intent(
                android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
        } catch (_: Exception) {}
    }

    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.background(Color.White, RoundedCornerShape(22.dp)).padding(22.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text("Settings", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Text(c.auth.user.value?.email ?: "", fontSize = 13.sp, color = Brand.muted)

            Spacer(Modifier.height(14.dp))
            Text("ART STYLE", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            val ov = styleOv
            if (ov == null) {
                Text("Loading…", fontSize = 13.sp, color = Brand.muted)
            } else {
                val cur = ov.styleGuide
                if (cur != null) {
                    Text("Current: ${cur.label}${if (cur.source == "family") " (your own)" else ""}",
                        fontSize = 14.sp, color = Brand.ink)
                    Row(Modifier.padding(vertical = 6.dp)) {
                        StyleRefThumb("Style", cur.refs?.main)
                        Spacer(Modifier.width(10.dp))
                        StyleRefThumb("Person", cur.refs?.person)
                        Spacer(Modifier.width(10.dp))
                        StyleRefThumb("Objects", cur.refs?.stuff)
                    }
                } else {
                    Text("No style set yet — pick one below.", fontSize = 13.sp, color = Brand.muted)
                }
                Text(
                    "Every generated picture is drawn from these references. Changes apply to NEW pictures only — tiles already on the board keep their current art.",
                    fontSize = 12.sp, color = Brand.muted,
                )
                if (ov.styles.isNotEmpty()) {
                    androidx.compose.material3.TextButton(onClick = { showStyleList = true },
                        modifier = Modifier.fillMaxWidth()) {
                        Text("Switch to another style…", color = Brand.pinkDeep)
                    }
                }
                androidx.compose.material3.TextButton(
                    onClick = { pendingUploadKind = "main" },
                    enabled = !styleUploading,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (styleUploading) "Uploading…" else "Upload your own reference…",
                        color = Brand.pinkDeep)
                }
                styleMsg?.let { Text(it, fontSize = 12.sp, color = Brand.muted) }
            }

            Spacer(Modifier.height(14.dp))
            Text("VOCABULARY LEVEL", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            val b = band
            if (b == null) {
                Text("Loading…", fontSize = 13.sp, color = Brand.muted)
            } else {
                Text("Showing: ${bandLabel(b.current)}", fontSize = 14.sp, color = Brand.ink)
                val next = b.next
                if (next != null) {
                    val m = b.mastery
                    if (m != null && b.readyToAdvance == true) {
                        Text("${m.correct} of ${m.total} recent answers correct — looks ready to grow.",
                            fontSize = 12.sp, color = Brand.muted)
                    }
                    androidx.compose.material3.TextButton(onClick = {
                        if (advancing) return@TextButton
                        advancing = true
                        scope.launch {
                            try {
                                c.api.advanceBand(c.auth.childSlug)
                                band = try { c.api.bandStatus(c.auth.childSlug) } catch (_: Exception) { band }
                                advanceMsg = "Unlocked."
                            } catch (e: Exception) { advanceMsg = "Could not unlock: ${e.message}" }
                            advancing = false
                        }
                    }) {
                        Text(if (advancing) "Unlocking…" else "Unlock ${bandLabel(next)}",
                            color = Brand.pinkDeep, fontWeight = FontWeight.SemiBold)
                    }
                } else {
                    Text("Top vocabulary band reached.", fontSize = 12.sp, color = Brand.muted)
                }
                advanceMsg?.let { Text(it, fontSize = 12.sp, color = Brand.muted) }
            }

            Spacer(Modifier.height(14.dp))
            Text("LISTENING", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Hide bad words", fontSize = 14.sp, color = Brand.ink, modifier = Modifier.weight(1f))
                androidx.compose.material3.Switch(checked = listenCensor, onCheckedChange = {
                    listenCensor = it; saveListen("listenCensor", it)
                })
            }
            Text(
                "Curse words and slurs someone says nearby show as “Bad Word” in the listening bar instead of the word itself.",
                fontSize = 12.sp, color = Brand.muted,
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Only show words with tiles", fontSize = 14.sp, color = Brand.ink, modifier = Modifier.weight(1f))
                androidx.compose.material3.Switch(checked = listenTilesOnly, onCheckedChange = {
                    listenTilesOnly = it; saveListen("listenTilesOnly", it)
                })
            }
            Text(
                "Spoken words that aren't on the board don't appear at all.",
                fontSize = 12.sp, color = Brand.muted,
            )

            Spacer(Modifier.height(14.dp))
            Text("THIS DEVICE", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            androidx.compose.material3.TextButton(onClick = {
                c.deviceMode.set(io.andrewpeterson.myworld.model.DeviceMode.Role.CHILD_BOARD); onDismiss()
            }, modifier = Modifier.fillMaxWidth()) {
                Text("Use as the child's board", color = Brand.ink)
            }
            androidx.compose.material3.TextButton(onClick = {
                openUrl("${io.andrewpeterson.myworld.net.ApiClient.ORIGIN}/parent/${c.auth.childSlug}")
            }, modifier = Modifier.fillMaxWidth()) {
                Text("Full dashboard on the web", color = Brand.ink)
            }

            Spacer(Modifier.height(14.dp))
            Text("KID-PROOFING", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            Text(
                "On the child board the back gesture is disabled and the system bars hide. " +
                    "For full lock-down, use Android's screen pinning: Settings → Security → " +
                    "App pinning (on Fire: Settings → Security & Privacy), turn it on, open the " +
                    "board, then pin it from the recent-apps view. Unpinning needs your device PIN.",
                fontSize = 12.sp, color = Brand.muted,
            )
            Spacer(Modifier.height(10.dp))
            Text("THIS DEVICE CAN…", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            Text(
                io.andrewpeterson.myworld.model.DeviceCapabilities.summary(
                    context, playBilling = c.billing.available.value),
                fontSize = 12.sp, color = Brand.muted,
            )

            Spacer(Modifier.height(14.dp))
            Text("ACCOUNT", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            // The password doubles as the board's edit-unlock gate, so
            // changing it in-app matters — no detour to the website.
            androidx.compose.material3.TextButton(onClick = { pwMsg = null; showChangePw = true },
                modifier = Modifier.fillMaxWidth()) {
                Text("Change password…", color = Brand.pinkDeep)
            }
            pwMsg?.let {
                Text(it, fontSize = 12.sp,
                    color = if (it.startsWith("Password updated")) Color(0xFF047857) else Color(0xFFDC2626))
            }
            androidx.compose.material3.TextButton(onClick = {
                scope.launch { c.auth.signOut() }; onDismiss()
            }, modifier = Modifier.fillMaxWidth()) {
                Text("Sign out", color = Color(0xFFDC2626))
            }
            androidx.compose.material3.TextButton(onClick = { showDeleteConfirm = true },
                modifier = Modifier.fillMaxWidth()) {
                Text("Delete account…", color = Color(0xFFDC2626))
            }
            deleteError?.let { Text(it, fontSize = 12.sp, color = Color(0xFFDC2626)) }

            Row(Modifier.padding(top = 8.dp)) {
                androidx.compose.material3.TextButton(onClick = {
                    openUrl("${io.andrewpeterson.myworld.net.ApiClient.ORIGIN}/terms")
                }) { Text("Terms of Service", fontSize = 12.sp, color = Brand.muted) }
                androidx.compose.material3.TextButton(onClick = {
                    openUrl("${io.andrewpeterson.myworld.net.ApiClient.ORIGIN}/privacy")
                }) { Text("Privacy Policy", fontSize = 12.sp, color = Brand.muted) }
            }

            androidx.compose.material3.TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Done", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
            }
        }
    }

    if (showChangePw) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showChangePw = false; curPw = ""; newPw = "" },
            title = { androidx.compose.material3.Text("Change password") },
            text = {
                Column {
                    androidx.compose.material3.Text(
                        "This password also unlocks board editing on the child's device.")
                    Spacer(Modifier.height(10.dp))
                    androidx.compose.material3.OutlinedTextField(
                        value = curPw, onValueChange = { curPw = it },
                        label = { androidx.compose.material3.Text("Current password") },
                        singleLine = true,
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                    )
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.material3.OutlinedTextField(
                        value = newPw, onValueChange = { newPw = it },
                        label = { androidx.compose.material3.Text("New password (8+ characters)") },
                        singleLine = true,
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                    )
                }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    val cur = curPw; val next = newPw
                    curPw = ""; newPw = ""; showChangePw = false
                    if (next.length < 8) { pwMsg = "New password must be at least 8 characters."; return@TextButton }
                    scope.launch {
                        pwMsg = try {
                            c.api.changePassword(cur, next)
                            "Password updated."
                        } catch (e: Exception) {
                            if ((e.message ?: "").contains("incorrect")) "Current password is incorrect."
                            else "Couldn't change it: ${e.message}"
                        }
                    }
                }) { androidx.compose.material3.Text("Save") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showChangePw = false; curPw = ""; newPw = "" }) {
                    androidx.compose.material3.Text("Cancel")
                }
            },
        )
    }

    if (showDeleteConfirm) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showDeleteConfirm = false; deleteText = "" },
            title = { androidx.compose.material3.Text("Delete this account?") },
            text = {
                Column {
                    androidx.compose.material3.Text(
                        "Permanently deletes this account and everything on the board — every tile, photo, generated image, recording, and all history. This cannot be undone.")
                    Spacer(Modifier.height(10.dp))
                    androidx.compose.material3.OutlinedTextField(
                        value = deleteText, onValueChange = { deleteText = it },
                        label = { androidx.compose.material3.Text("Type DELETE to confirm") },
                        singleLine = true,
                    )
                }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    if (deleteText.trim().uppercase() != "DELETE") {
                        deleteError = "Type DELETE (all caps) to confirm."
                        deleteText = ""; showDeleteConfirm = false
                        return@TextButton
                    }
                    showDeleteConfirm = false
                    scope.launch {
                        try {
                            c.api.deleteAccount()
                            c.auth.signOut(); onDismiss()
                        } catch (e: Exception) { deleteError = "Couldn't delete: ${e.message}" }
                        deleteText = ""
                    }
                }) { androidx.compose.material3.Text("Delete everything", color = Color(0xFFDC2626)) }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showDeleteConfirm = false; deleteText = "" }) {
                    androidx.compose.material3.Text("Cancel")
                }
            },
        )
    }

    // Style switch confirm — the web dashboard's exact warning copy.
    val pending = pendingStyle
    if (pending != null) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { pendingStyle = null },
            title = { androidx.compose.material3.Text("Draw new pictures in “${pending.label}”?") },
            text = {
                androidx.compose.material3.Text(
                    "Tiles already on the board keep their current pictures — the board will mix " +
                        "styles until you remake them from each tile's editor. New pictures use " +
                        "the new style right away.")
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    pendingStyle = null
                    scope.launch {
                        try {
                            c.api.setStyle(c.auth.childSlug, pending.id)
                            styleMsg = "Style switched — new pictures use “${pending.label}” from now on."
                            reloadStyles()
                        } catch (e: Exception) { styleMsg = "Couldn't switch: ${e.message}" }
                    }
                }) { androidx.compose.material3.Text("Switch style") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { pendingStyle = null }) {
                    androidx.compose.material3.Text("Cancel")
                }
            },
        )
    }

    // Built-in style picker.
    if (showStyleList) {
        androidx.compose.ui.window.Dialog(onDismissRequest = { showStyleList = false }) {
            Column(
                Modifier.background(Color.White, RoundedCornerShape(22.dp)).padding(18.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Text("Built-in styles", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                Spacer(Modifier.height(8.dp))
                val currentId = styleOv?.styleGuide?.id
                for (s in styleOv?.styles.orEmpty()) {
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable {
                                if (s.id != currentId) { showStyleList = false; pendingStyle = s }
                            }
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        StyleRefThumb("", s.previewUrl ?: s.refs?.main, size = 48)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(s.label, fontSize = 15.sp, color = Brand.ink, fontWeight = FontWeight.SemiBold)
                            s.description?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, fontSize = 12.sp, color = Brand.muted, maxLines = 2)
                            }
                        }
                        if (s.id == currentId) Text("✓", fontSize = 16.sp, color = Brand.pinkDeep)
                    }
                }
                androidx.compose.material3.TextButton(onClick = { showStyleList = false },
                    modifier = Modifier.fillMaxWidth()) {
                    Text("Cancel", color = Brand.muted)
                }
            }
        }
    }

    // Own-upload warning BEFORE the photo picker opens (pick which reference).
    if (pendingUploadKind != null) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { pendingUploadKind = null },
            title = { androidx.compose.material3.Text("Use your own reference?") },
            text = {
                androidx.compose.material3.Text(
                    "New pictures will be drawn to match it. Tiles already on the board don't " +
                        "change, so the board can look inconsistent until you remake them. " +
                        "Pick which reference to replace:")
            },
            confirmButton = {
                Column {
                    for ((kind, label) in listOf("main" to "Style scene (the overall look)",
                                                 "person" to "Person reference",
                                                 "stuff" to "Objects reference")) {
                        androidx.compose.material3.TextButton(onClick = {
                            pendingUploadKind = null
                            styleUploadKind = kind
                            pickStyleRef.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        }) { androidx.compose.material3.Text(label) }
                    }
                }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { pendingUploadKind = null }) {
                    androidx.compose.material3.Text("Cancel")
                }
            },
        )
    }
}

/** One labeled reference thumbnail, fetched through the authenticated
 *  /api/parent/style?image= stream (never a raw blob URL). */
@Composable
private fun StyleRefThumb(title: String, path: String?, size: Int = 68) {
    val c = LocalAppContainer.current
    var bmp by remember(path) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(path) {
        bmp = null
        val p = path ?: return@LaunchedEffect
        val bytes = c.api.imageBytes(p) ?: return@LaunchedEffect
        bmp = try { android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) } catch (_: Exception) { null }
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        val b = bmp
        if (b != null) {
            Image(b.asImageBitmap(), contentDescription = title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size.dp).clip(RoundedCornerShape(10.dp)))
        } else {
            Box(Modifier.size(size.dp).clip(RoundedCornerShape(10.dp)).background(hexColor("#fce4ec")),
                contentAlignment = Alignment.Center) {
                Text(if (path == null) "—" else "…", fontSize = 12.sp, color = Brand.muted)
            }
        }
        if (title.isNotEmpty()) Text(title, fontSize = 10.sp, color = Brand.muted)
    }
}

/** Vocabulary band ids → parent-friendly labels (ParentHomeView.swift parity). */
fun bandLabel(band: String?): String = when (band) {
    "12-18m" -> "12–18 months · first words"
    "18-30m" -> "18–30 months · vocabulary burst"
    "2-3y" -> "2–3 years · sentences"
    "3-4y" -> "3–4 years · grammar"
    "4y+" -> "4 years and up"
    else -> "every band"
}

package io.andrewpeterson.myworld.ui.parent

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.prettyChildName
import io.andrewpeterson.myworld.net.advanceBand
import io.andrewpeterson.myworld.net.bandStatus
import io.andrewpeterson.myworld.net.deleteAccount
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch

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

    LaunchedEffect(Unit) {
        c.parentLive.start(c.auth.childSlug)
        c.board.refresh(c.auth.childSlug)   // scopes for StartGame + quick board
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
        Triple("people", "🧑‍🤝‍🧑", "Family & people"),
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

        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 160.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().padding(16.dp),
        ) {
            items(cards, key = { it.first }) { (id, emoji, title) ->
                Column(
                    Modifier
                        .background(Color.White, RoundedCornerShape(18.dp))
                        .border(1.dp, hexColor("#f3c6dd"), RoundedCornerShape(18.dp))
                        .clickable { open = id }
                        .padding(16.dp)
                        .height(88.dp),
                ) {
                    Text(emoji, fontSize = 30.sp)
                    Spacer(Modifier.weight(1f))
                    Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
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
        "people" -> PeopleManagerView { open = null }
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

    LaunchedEffect(Unit) {
        band = try { c.api.bandStatus(c.auth.childSlug) } catch (_: Exception) { null }
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
            Text("ACCOUNT", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
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

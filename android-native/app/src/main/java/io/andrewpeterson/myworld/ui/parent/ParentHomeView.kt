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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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

/** Parent settings — sign out, switch role (fuller port lands with M9). */
@Composable
private fun ParentSettingsView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.background(Color.White, RoundedCornerShape(22.dp)).padding(22.dp)) {
            Text("Settings", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Text(c.auth.user.value?.email ?: "", fontSize = 13.sp, color = Brand.muted)
            Spacer(Modifier.height(12.dp))
            androidx.compose.material3.TextButton(onClick = {
                c.deviceMode.set(io.andrewpeterson.myworld.model.DeviceMode.Role.CHILD_BOARD); onDismiss()
            }, modifier = Modifier.fillMaxWidth()) {
                Text("Switch this device to the child board", color = Brand.ink)
            }
            androidx.compose.material3.TextButton(onClick = {
                scope.launch { c.auth.signOut() }; onDismiss()
            }, modifier = Modifier.fillMaxWidth()) {
                Text("Sign out", color = Color(0xFFDC2626))
            }
            androidx.compose.material3.TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Done", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
            }
        }
    }
}

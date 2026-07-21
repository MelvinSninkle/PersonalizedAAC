package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.audio.SpeechCache
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive

/**
 * Message-the-board composer — port of `Parent/MessageBoardView.swift`. The
 * SERVER tokenizes the text against the board (greedy-longest) and publishes
 * to the tablet via the live channel; this view previews the match count.
 * Listening mode (the other direction) is its own home card — see
 * ListeningModeView below.
 */
@Composable
fun MessageBoardView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val tabletOnline by c.parentLive.tabletOnline.collectAsState()

    var text by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    @Serializable
    data class MessageResult(val matched: Int = 0, val total: Int = 0)

    fun send() {
        if (busy || text.isBlank()) return
        busy = true; note = null
        scope.launch {
            try {
                val body = "{\"childId\":${SpeechCache.jsonQuote(c.auth.childSlug)},\"text\":${SpeechCache.jsonQuote(text.trim())}}"
                val r: MessageResult = c.api.postRawJson("/api/message-to-board", body)
                note = "Sent! ${r.matched} of ${r.total} words matched board tiles."
                text = ""
            } catch (e: Exception) {
                note = "Couldn't send: ${e.message}"
            } finally { busy = false }
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.background(Color.White, RoundedCornerShape(24.dp)).padding(22.dp)) {
            Text("Message the board", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Text(
                if (tabletOnline) "Tablet connected ✅" else "The board will show it when it's next open",
                fontSize = 13.sp, color = if (tabletOnline) Brand.goodInk else Brand.muted,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = text, onValueChange = { text = it },
                label = { Text("What do you want to say?") },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
            )
            note?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 13.sp, color = Brand.goodInk)
            }
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = { send() }, enabled = !busy && text.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text(if (busy) "Sending…" else "Show it as tiles", fontWeight = FontWeight.Bold) }

            Spacer(Modifier.height(10.dp))
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Close", color = Brand.muted)
            }
        }
    }
}

/**
 * Listening mode — its own home card (it lived inside Message the board for a
 * while; separate screens read clearer). Flips the tablet's header into the
 * live word-strip; the board auto-stops after 2 minutes of quiet.
 */
@Composable
fun ListeningModeView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val tabletOnline by c.parentLive.tabletOnline.collectAsState()

    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.background(Color.White, RoundedCornerShape(24.dp)).padding(22.dp)) {
            Text("Listening mode", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Text(
                if (tabletOnline) "Tablet connected ✅" else "The tablet must be open for listening to start",
                fontSize = 13.sp, color = if (tabletOnline) Brand.goodInk else Brand.muted,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Turn the board into a live word-strip: speech near the tablet becomes tiles as it's said. " +
                    "Audio is processed for live transcription only, no recording is kept, and it stops " +
                    "itself after 2 minutes of quiet. Make sure everyone in the room is okay with it.",
                fontSize = 13.sp, color = Brand.muted,
            )
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = { scope.launch { c.parentLive.sendCommand(mapOf("action" to JsonPrimitive("listen-start"))) } },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text("🎙 Start listening on the tablet", fontWeight = FontWeight.Bold) }
            Spacer(Modifier.height(8.dp))
            TextButton(
                onClick = { scope.launch { c.parentLive.sendCommand(mapOf("action" to JsonPrimitive("listen-stop"))) } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("⏹ Stop listening", color = Brand.pinkDeep) }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Close", color = Brand.muted)
            }
        }
    }
}

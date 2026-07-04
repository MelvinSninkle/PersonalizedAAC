package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
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
    listening: Boolean = false,
) {
    val c = LocalAppContainer.current
    val prefs by c.displayPrefs.data.collectAsState()
    val user by c.auth.user.collectAsState()
    val textColor = hexColor(prefs.colorHeaderText, Color.White)

    Box(
        Modifier.fillMaxWidth().height(48.dp).background(hexColor(prefs.colorHeaderBg)),
    ) {
        // Centered brand title (the listen strip takes this spot in M6).
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
            // Mic / listening toggle (M6 wires the engine; the gate copy is live).
            Box(
                Modifier.size(44.dp).combinedClickable(onClick = onListenTap, onLongClick = {}),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (listening) "⏹" else "🎙", fontSize = 20.sp,
                    color = if (listening) Color(0xFFDC2626) else textColor.copy(alpha = 0.9f))
            }
            Spacer(Modifier.weight(1f))
            // Teach me + Play with me (M5 wires the sessions).
            HeaderRound("📖", onTeachTap)
            Spacer(Modifier.width(8.dp))
            HeaderRound("🙋", onPlayTap)
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

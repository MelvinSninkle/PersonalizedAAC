package io.andrewpeterson.myworld.ui

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import io.andrewpeterson.myworld.model.DeviceMode
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * Port of `Views/RolePickerView.swift` — first-run "Who uses this device?".
 * Both choices are reversible from settings, so no confirmation step.
 */
@Composable
fun RolePickerView() {
    val c = LocalAppContainer.current
    var opening by remember { mutableStateOf<DeviceMode.Role?>(null) }

    Column(
        Modifier.fillMaxSize().background(hexColor("#fff7fb")).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🌍", fontSize = 64.sp)
        Spacer(Modifier.height(12.dp))
        Text("Who uses this device?", fontSize = 30.sp, fontWeight = FontWeight.Bold,
            color = Brand.pinkDeep)
        Spacer(Modifier.height(24.dp))

        val slug = c.auth.user.value?.slug
        val childName = slug?.replace(Regex("peterson$", RegexOption.IGNORE_CASE), "")
            ?.replaceFirstChar { it.uppercaseChar() }?.takeIf { it.isNotBlank() }
        RoleCard(
            emoji = "👆",
            title = "${childName?.plus("'s") ?: "Your child's"} board",
            subtitle = "Big tiles, tap to talk. Best on a tablet with screen pinning.",
            busy = opening == DeviceMode.Role.CHILD_BOARD,
        ) {
            if (opening == null) { opening = DeviceMode.Role.CHILD_BOARD; c.deviceMode.set(DeviceMode.Role.CHILD_BOARD) }
        }
        Spacer(Modifier.height(16.dp))
        RoleCard(
            emoji = "🧑",
            title = "Parent app",
            subtitle = "Add tiles, start games, see progress, message the board.",
            busy = opening == DeviceMode.Role.PARENT,
        ) {
            if (opening == null) { opening = DeviceMode.Role.PARENT; c.deviceMode.set(DeviceMode.Role.PARENT) }
        }

        Spacer(Modifier.height(24.dp))
        if (opening != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Brand.pinkDeep, strokeWidth = 2.dp)
                Spacer(Modifier.widthIn(min = 8.dp))
                Text(
                    if (opening == DeviceMode.Role.CHILD_BOARD)
                        "  Opening the board, loading pictures & voices…"
                    else "  Opening the parent app…",
                    fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand.pinkDeep,
                )
            }
        } else {
            Text("You can change this any time in Settings.", fontSize = 13.sp, color = Brand.faint)
        }
    }
}

@Composable
private fun RoleCard(emoji: String, title: String, subtitle: String, busy: Boolean, onTap: () -> Unit) {
    Row(
        Modifier
            .widthIn(max = 560.dp)
            .fillMaxWidth()
            .background(Color.White, RoundedCornerShape(20.dp))
            .border(1.dp, hexColor("#f3c6da"), RoundedCornerShape(20.dp))
            .clickable(onClick = onTap)
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(54.dp).background(Brand.pink, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Text(emoji, fontSize = 24.sp) }
        Spacer(Modifier.widthIn(min = 14.dp))
        Column(Modifier.weight(1f).padding(start = 14.dp)) {
            Text(title, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
            Text(subtitle, fontSize = 13.sp, color = Brand.muted)
        }
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Brand.pink, strokeWidth = 2.dp)
        else Text("›", fontSize = 22.sp, color = hexColor("#c9b3bf"))
    }
}

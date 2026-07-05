package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.childSettings
import io.andrewpeterson.myworld.net.saveChildSettingsKey
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Scheduling manager — port of `Parent/SchedulesView.swift` (PRD §4.6 v1):
 * list every prompt the board will fire, flip on/off, delete, add a simple
 * interval reminder. Question/game authoring stays on the web; those rows
 * round-trip UNTOUCHED because everything here works on raw JsonObjects.
 */
@Composable
fun SchedulesView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    var rows by remember { mutableStateOf<List<JsonObject>?>(null) }
    var saving by remember { mutableStateOf(false) }
    var showNew by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        rows = try {
            (c.api.childSettings(c.auth.childSlug)["schedules"] as? JsonArray)
                ?.mapNotNull { it as? JsonObject } ?: emptyList()
        } catch (_: Exception) { emptyList() }
    }

    fun save(newRows: List<JsonObject>) {
        rows = newRows
        saving = true
        scope.launch {
            c.api.saveChildSettingsKey(c.auth.childSlug, "schedules",
                buildJsonArray { newRows.forEach { add(it) } })
            saving = false
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
            Row(
                Modifier.fillMaxWidth().background(Brand.pink).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("✕", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.clickable { onDismiss() }.padding(6.dp))
                Spacer(Modifier.width(10.dp))
                Text("Schedules", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.weight(1f))
                if (saving) Text("Saving…  ", fontSize = 11.sp, color = Color.White.copy(alpha = 0.8f))
                Text("＋ Add", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.clickable { showNew = true }.padding(6.dp))
            }

            val r = rows
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                when {
                    r == null -> LoadingSpinner("Loading…")
                    r.isEmpty() -> Text(
                        "No scheduled prompts yet. Add a reminder with ＋, or build richer prompts (questions, game nudges) on the web dashboard.",
                        fontSize = 13.sp, color = Brand.muted,
                    )
                    else -> r.forEachIndexed { idx, row ->
                        ScheduleRow(
                            row = row,
                            onToggle = { enabled ->
                                val updated = r.toMutableList()
                                updated[idx] = buildJsonObject {
                                    for ((k, v) in row) if (k != "enabled") put(k, v)
                                    put("enabled", enabled)
                                }
                                save(updated)
                            },
                            onDelete = { save(r.filterIndexed { i, _ -> i != idx }) },
                        )
                        Spacer(Modifier.height(10.dp))
                    }
                }
            }
        }
    }

    if (showNew) {
        NewReminderDialog(
            onAdd = { prompt, intervalMin ->
                showNew = false
                val row = buildJsonObject {
                    put("id", "s${System.currentTimeMillis()}")
                    put("type", "reminder")
                    put("enabled", true)
                    put("prompt", prompt)
                    put("timing", "interval")
                    put("intervalMin", intervalMin)
                    put("days", buildJsonArray { (0..6).forEach { add(JsonPrimitive(it)) } })
                }
                save((rows ?: emptyList()) + row)
            },
            onDismiss = { showNew = false },
        )
    }
}

@Composable
private fun ScheduleRow(row: JsonObject, onToggle: (Boolean) -> Unit, onDelete: () -> Unit) {
    val type = (row["type"] as? JsonPrimitive)?.content ?: "reminder"
    val enabled = try { (row["enabled"] as? JsonPrimitive)?.boolean ?: true } catch (_: Exception) { true }
    val prompt = (row["prompt"] as? JsonPrimitive)?.content?.takeIf { it.isNotEmpty() }
        ?: when (type) {
            "question" -> "A quick question."
            "game" -> "Let's do a game!"
            else -> "Time for a check-in."
        }
    val typeLabel = when (type) { "question" -> "Question"; "game" -> "Game nudge"; else -> "Reminder" }
    val emoji = when (type) { "question" -> "❓"; "game" -> "🎮"; else -> "🔔" }
    val timing = run {
        val timingKind = (row["timing"] as? JsonPrimitive)?.content
        val times = (row["times"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }
        if (timingKind == "times" && !times.isNullOrEmpty()) "at " + times.joinToString(", ")
        else {
            val mins = (row["intervalMin"] as? JsonPrimitive)?.doubleOrNull ?: 45.0
            "every ${mins.toInt()} min"
        }
    }

    Row(
        Modifier.fillMaxWidth()
            .background(Color.White, RoundedCornerShape(14.dp))
            .border(1.dp, hexColor("#f3c6da"), RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(emoji, fontSize = 20.sp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(prompt, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                color = if (enabled) Brand.ink else Brand.muted)
            Text("$typeLabel · $timing", fontSize = 12.sp, color = Brand.muted)
        }
        TextButton(onClick = onDelete) { Text("🗑", fontSize = 15.sp) }
        Switch(checked = enabled, onCheckedChange = onToggle,
            colors = SwitchDefaults.colors(checkedTrackColor = Brand.pink))
    }
}

/** Minimal composer for a spoken interval reminder ("Do you need the potty?"). */
@Composable
private fun NewReminderDialog(onAdd: (String, Int) -> Unit, onDismiss: () -> Unit) {
    var prompt by remember { mutableStateOf("") }
    var intervalMin by remember { mutableStateOf(45) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New reminder") },
        text = {
            Column {
                OutlinedTextField(
                    value = prompt, onValueChange = { prompt = it },
                    label = { Text("What should the board say?") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { if (intervalMin > 5) intervalMin -= 5 }) { Text("−", fontSize = 20.sp) }
                    Text("Every $intervalMin minutes", fontSize = 14.sp, modifier = Modifier.weight(1f),
                        fontWeight = FontWeight.SemiBold)
                    TextButton(onClick = { if (intervalMin < 240) intervalMin += 5 }) { Text("＋", fontSize = 18.sp) }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onAdd(prompt.trim(), intervalMin) },
                enabled = prompt.isNotBlank(),
            ) { Text("Add", fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

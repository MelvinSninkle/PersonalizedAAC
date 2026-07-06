package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.net.deleteItem
import io.andrewpeterson.myworld.net.storeRetry
import io.andrewpeterson.myworld.net.updateItem
import io.andrewpeterson.myworld.net.upload
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch

/**
 * The full board tile editor (tap a tile while unlocked) — port of
 * `Views/TileEditSheet.swift`'s BoardTileEditSheet: rename (re-voices),
 * pin, listening-game description, move earlier/later in the folder,
 * guided redraw (REQUIRED correction text; 1st retry free), delete.
 */
@Composable
fun BoardTileEditSheet(tile: Tile, onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    var name by remember { mutableStateOf(tile.label) }
    var description by remember { mutableStateOf(tile.description ?: "") }
    var pinned by remember { mutableStateOf(tile.pinned) }
    var guidance by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    fun save() {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try {
                val renamed = name.trim() != tile.label && name.isNotBlank()
                var soundKey: String? = null
                if (renamed) {
                    // Re-voice the renamed word in the child's voice.
                    val mp3 = c.speechCache.mp3(name.trim(), c.auth.childSlug)
                    if (mp3 != null) {
                        soundKey = c.api.upload("itemsound", "mp3", mp3.readBytes(), "audio/mpeg")
                    }
                }
                c.api.updateItem(
                    id = tile.id, childId = c.auth.childSlug,
                    label = name.trim().takeIf { it.isNotEmpty() && renamed },
                    pinned = pinned.takeIf { it != tile.pinned },
                    description = description.trim().takeIf { it != (tile.description ?: "") },
                    soundKey = soundKey,
                )
                c.board.refresh(c.auth.childSlug)
                onDismiss()
            } catch (e: Exception) {
                error = "Couldn't save: ${e.message}"
            } finally { busy = false }
        }
    }

    fun redraw() {
        if (guidance.isBlank()) {
            error = "Tell it what to change first — e.g. \"make the cup blue like ours\"."
            return
        }
        busy = true; error = null
        scope.launch {
            try {
                c.api.storeRetry(c.auth.childSlug, tile.id, guidance.trim())
                note = "Redrawing with your note — the new picture lands in a couple of minutes. (First retry is free.)"
                guidance = ""
            } catch (e: Exception) {
                error = if (e.message?.contains("needs_subscription") == true)
                    "Styled redraws are part of My World memberships — join under Credits & Store."
                else "Couldn't start the redraw: ${e.message}"
            } finally { busy = false }
        }
    }

    fun move(delta: Int) {
        scope.launch {
            // Splice + i*1000 resequence within the tile's folder (web parity).
            val siblings = c.board.tiles.value
                .filter { it.categoryId == tile.categoryId && it.section == tile.section }
                .sortedWith(compareBy({ it.order }, { it.id }))
                .toMutableList()
            val i = siblings.indexOfFirst { it.id == tile.id }
            val j = i + delta
            if (i < 0 || j < 0 || j >= siblings.size) return@launch
            val moved = siblings.removeAt(i)
            siblings.add(j, moved)
            for ((idx, t) in siblings.withIndex()) {
                val newOrder = idx * 1000
                if (t.order != newOrder) {
                    try { c.api.updateItem(id = t.id, childId = c.auth.childSlug, order = newOrder) } catch (_: Exception) {}
                }
            }
            c.board.refresh(c.auth.childSlug)
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxWidth(0.94f)
                .background(Color.White, RoundedCornerShape(24.dp))
                .padding(22.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text("Edit tile", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(12.dp))

            OutlinedTextField(value = name, onValueChange = { name = it },
                label = { Text("Name (spoken as spelled)") }, singleLine = true,
                modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = description, onValueChange = { description = it },
                label = { Text("Listening-game clue (optional)") },
                placeholder = { Text("e.g. \"lives in a field, four legs, eats grass\"") },
                modifier = Modifier.fillMaxWidth())

            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Pinned (always visible)", fontSize = 15.sp, color = Brand.ink,
                    modifier = Modifier.weight(1f))
                Switch(checked = pinned, onCheckedChange = { pinned = it },
                    colors = SwitchDefaults.colors(checkedTrackColor = Brand.pink))
            }

            Spacer(Modifier.height(10.dp))
            Row {
                TextButton(onClick = { move(-1) }) { Text("← Move earlier", color = Brand.pinkDeep) }
                TextButton(onClick = { move(1) }) { Text("Move later →", color = Brand.pinkDeep) }
            }

            Spacer(Modifier.height(12.dp))
            Text("REDRAW THE PICTURE", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            // §8: ONE TAP — regenerates this picture in the child's selected
            // style automatically. No style hunting, no note required.
            TextButton(onClick = {
                if (busy) return@TextButton
                busy = true; error = null
                scope.launch {
                    try {
                        c.api.storeRetry(c.auth.childSlug, tile.id, "")
                        note = "Matching your child's style — the new picture lands in a couple of minutes. (First retry per tile is free.)"
                    } catch (e: Exception) {
                        error = if (e.message?.contains("needs_subscription") == true)
                            "Styled redraws are part of My World memberships — join under Credits & Store."
                        else "Couldn't start: ${e.message}"
                    } finally { busy = false }
                }
            }, enabled = !busy) {
                Text("✨ Match my child's style", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
            }
            OutlinedTextField(value = guidance, onValueChange = { guidance = it },
                label = { Text("…or say what should change") },
                placeholder = { Text("e.g. \"the cup should be blue like ours\"") },
                modifier = Modifier.fillMaxWidth())
            TextButton(onClick = { redraw() }, enabled = !busy) {
                Text("🎨 Redraw with my note (1st free)", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
            }

            note?.let { Text(it, fontSize = 13.sp, color = Brand.goodInk) }
            error?.let { Text(it, fontSize = 13.sp, color = Color(0xFFDC2626)) }

            Spacer(Modifier.height(14.dp))
            Button(onClick = { save() }, enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth().height(48.dp)) {
                Text(if (busy) "Saving…" else "Save", fontWeight = FontWeight.Bold)
            }
            if (!confirmDelete) {
                TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("Delete this tile…", color = Color(0xFFDC2626))
                }
            } else {
                Button(onClick = {
                    scope.launch {
                        try {
                            c.api.deleteItem(tile.id, c.auth.childSlug)
                            c.board.refresh(c.auth.childSlug)
                            onDismiss()
                        } catch (e: Exception) { error = "Couldn't delete: ${e.message}" }
                    }
                }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
                    modifier = Modifier.fillMaxWidth()) {
                    Text("Yes — delete \"${tile.label}\" forever", fontWeight = FontWeight.Bold)
                }
            }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Close", color = Brand.muted)
            }
        }
    }
}

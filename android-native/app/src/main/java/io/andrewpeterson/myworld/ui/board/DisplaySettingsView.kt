package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.DisplayPrefsData
import io.andrewpeterson.myworld.net.childSettings
import io.andrewpeterson.myworld.net.saveChildSettingsKey
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * "⚙ Display" — port of `Views/DisplaySettingsView.swift`, in the canonical
 * themed order every surface shares (most common first): Board look →
 * Board tools → Touch & play → Listening → Safety & unlock.
 *
 * Board-look edits ride DisplayPrefs (SharedPreferences + synced kidDisplay);
 * everything below the tools header is a ROOT child-settings key, merge-
 * written one at a time (saveChildSettingsKey) then re-read by AccessPrefs so
 * the live board applies it without a relaunch. Colors use preset swatch
 * rows (Compose has no system color picker; the full wheel stays on the web
 * dashboard, which shares the same kidDisplay blob).
 */
@Composable
fun DisplaySettingsView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val d by c.displayPrefs.data.collectAsState()

    // Synced root-key toggles — seeded once; the loaded flag keeps the seed
    // from firing the save callbacks (the ParentSettingsView pattern).
    var toolListen by remember { mutableStateOf(true) }
    var toolTeach by remember { mutableStateOf(true) }
    var toolPlay by remember { mutableStateOf(true) }
    var toolSentence by remember { mutableStateOf(true) }
    var tapInterrupt by remember { mutableStateOf(false) }
    var doubleTapTeach by remember { mutableStateOf(false) }
    var teachTapSec by remember { mutableStateOf(2.0f) }
    var exitHoldSec by remember { mutableStateOf(1.2f) }
    var listenCensor by remember { mutableStateOf(true) }
    var listenTilesOnly by remember { mutableStateOf(false) }
    var easyClose by remember { mutableStateOf(false) }
    var easyUnlock by remember { mutableStateOf(false) }
    var syncedLoaded by remember { mutableStateOf(false) }
    var syncedMsg by remember { mutableStateOf<String?>(null) }
    // easyUnlock enable = re-type the account password first (E6b, same as
    // web + iOS). Turning it OFF is friction-free.
    var confirmEasyUnlock by remember { mutableStateOf(false) }
    var unlockPassword by remember { mutableStateOf("") }
    var unlockBusy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val s = c.api.childSettings(c.auth.childSlug)
        fun bool(k: String) = (s[k] as? JsonPrimitive)?.let { it.content == "true" }
        fun int(k: String) = (s[k] as? JsonPrimitive)?.content?.toIntOrNull()
        toolListen = bool("toolListen") ?: true
        toolTeach = bool("toolTeach") ?: true
        toolPlay = bool("toolPlay") ?: true
        toolSentence = bool("toolSentence") ?: true
        tapInterrupt = bool("tapInterrupt") ?: false
        doubleTapTeach = bool("doubleTapTeach") ?: false
        teachTapSec = io.andrewpeterson.myworld.access.TouchConfig.clampMs(int("teachTapMs"), 500, 5000, 2000) / 1000f
        exitHoldSec = io.andrewpeterson.myworld.access.TouchConfig.clampMs(int("exitHoldMs"), 300, 3000, 1200) / 1000f
        listenCensor = bool("listenCensor") ?: true
        listenTilesOnly = bool("listenTilesOnly") ?: false
        easyClose = bool("easyClose") ?: false
        easyUnlock = bool("easyUnlock") ?: false
        syncedLoaded = true
    }
    fun saveSynced(key: String, value: Boolean) {
        if (!syncedLoaded) return
        scope.launch {
            c.api.saveChildSettingsKey(c.auth.childSlug, key, JsonPrimitive(value))
            c.access.refresh()   // the board applies it without a relaunch
        }
    }
    fun saveSyncedInt(key: String, value: Int) {
        if (!syncedLoaded) return
        scope.launch {
            c.api.saveChildSettingsKey(c.auth.childSlug, key, JsonPrimitive(value))
            c.access.refresh()
        }
    }
    /** E6b: verify the account password (POST /api/auth/login) BEFORE
     *  easyUnlock can stick — never a one-tap waiver. */
    fun confirmUnlockWaiver() {
        if (unlockBusy || unlockPassword.isEmpty()) return
        unlockBusy = true
        scope.launch {
            try {
                val resp = c.api.login(c.auth.lastEmail(), unlockPassword)
                if (resp.ok) {
                    c.api.saveChildSettingsKey(c.auth.childSlug, "easyUnlock", JsonPrimitive(true))
                    c.access.refresh()
                    easyUnlock = true
                    syncedMsg = null
                    confirmEasyUnlock = false
                } else {
                    syncedMsg = "That password didn't work. The unlock gate stays on."
                }
            } catch (_: Exception) {
                syncedMsg = "That password didn't work. The unlock gate stays on."
            } finally {
                unlockBusy = false
                unlockPassword = ""
            }
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .fillMaxWidth(0.92f)
                .background(Color.White, RoundedCornerShape(22.dp))
                .padding(22.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text("Display", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(12.dp))

            // ── 1 · Board look ──
            ToggleRow("Hide labels", d.hideLabels) { on ->
                c.displayPrefs.update { it.copy(hideLabels = on) }
            }

            SectionHeader("TILES ACROSS")
            StepperRow("People", d.acrossPeople) { v -> c.displayPrefs.update { it.copy(acrossPeople = v) } }
            StepperRow("Nouns", d.acrossNouns) { v -> c.displayPrefs.update { it.copy(acrossNouns = v) } }
            StepperRow("Verbs", d.acrossVerbs) { v -> c.displayPrefs.update { it.copy(acrossVerbs = v) } }

            SectionHeader("SECTIONS")
            ToggleRow("People", d.showPeople) { on -> c.displayPrefs.update { it.copy(showPeople = on) } }
            ToggleRow("Nouns", d.showNouns) { on -> c.displayPrefs.update { it.copy(showNouns = on) } }
            ToggleRow("Verbs", d.showVerbs) { on -> c.displayPrefs.update { it.copy(showVerbs = on) } }
            ToggleRow("Needs strip", d.showNeeds) { on -> c.displayPrefs.update { it.copy(showNeeds = on) } }

            SectionHeader("SECTION COLORS")
            ColorRow("People", d.colorPeople) { hex -> c.displayPrefs.update { it.copy(colorPeople = hex) } }
            ColorRow("Nouns", d.colorNouns) { hex -> c.displayPrefs.update { it.copy(colorNouns = hex) } }
            ColorRow("Verbs", d.colorVerbs) { hex -> c.displayPrefs.update { it.copy(colorVerbs = hex) } }
            ColorRow("Needs", d.colorNeeds) { hex -> c.displayPrefs.update { it.copy(colorNeeds = hex) } }

            SectionHeader("HEADER COLORS")
            ColorRow("Background", d.colorHeaderBg) { hex -> c.displayPrefs.update { it.copy(colorHeaderBg = hex) } }
            ColorRow("Text", d.colorHeaderText) { hex -> c.displayPrefs.update { it.copy(colorHeaderText = hex) } }

            // ── Synced sections: everything below follows the child ──
            SectionHeader("BOARD TOOLS")
            Text("Which buttons show in the board's header. Everything from here down follows your child. It applies on every device this board is used on.",
                fontSize = 12.sp, color = Brand.muted)
            ToggleRow("🎙 Listening (live word strip)", toolListen) { on ->
                toolListen = on; saveSynced("toolListen", on)
            }
            ToggleRow("📖 Teach (word slideshows)", toolTeach) { on ->
                toolTeach = on; saveSynced("toolTeach", on)
            }
            ToggleRow("🙋 Play (find-the-word game)", toolPlay) { on ->
                toolPlay = on; saveSynced("toolPlay", on)
            }
            ToggleRow("✏️ Sentence mode", toolSentence) { on ->
                toolSentence = on; saveSynced("toolSentence", on)
            }

            SectionHeader("TOUCH & PLAY")
            ToggleRow("New taps interrupt the word", tapInterrupt) { on ->
                tapInterrupt = on; saveSynced("tapInterrupt", on)
            }
            Text("Off: each word finishes before the next tap counts, steadier for new talkers.",
                fontSize = 12.sp, color = Brand.muted)
            ToggleRow("Tap again to learn", doubleTapTeach) { on ->
                doubleTapTeach = on; saveSynced("doubleTapTeach", on)
            }
            Text("Tap a tile: hear the word. Tap again quickly: hear a fact, up to three facts on back-to-back taps, then the word again.",
                fontSize = 12.sp, color = Brand.muted)
            if (doubleTapTeach) {
                Text("How quick \"again\" has to be: ${"%.1f".format(teachTapSec)}s",
                    fontSize = 12.sp, color = Brand.ink)
                androidx.compose.material3.Slider(
                    value = teachTapSec, valueRange = 0.5f..5f, steps = 17,
                    onValueChange = { teachTapSec = it },
                    onValueChangeFinished = { saveSyncedInt("teachTapMs", (teachTapSec * 1000).toInt()) },
                )
            }

            SectionHeader("LISTENING")
            ToggleRow("Hide bad words", listenCensor) { on ->
                listenCensor = on; saveSynced("listenCensor", on)
            }
            ToggleRow("Only show words with tiles", listenTilesOnly) { on ->
                listenTilesOnly = on; saveSynced("listenTilesOnly", on)
            }

            SectionHeader("SAFETY & UNLOCK")
            ToggleRow("Close buttons work with a quick tap", easyClose) { on ->
                easyClose = on; saveSynced("easyClose", on)
            }
            if (!easyClose) {
                Text("✕ hold length: ${"%.1f".format(exitHoldSec)}s. Longer is harder for a child to quit by accident.",
                    fontSize = 12.sp, color = Brand.ink)
                androidx.compose.material3.Slider(
                    value = exitHoldSec, valueRange = 0.3f..3f, steps = 26,
                    onValueChange = { exitHoldSec = it },
                    onValueChangeFinished = { saveSyncedInt("exitHoldMs", (exitHoldSec * 1000).toInt()) },
                )
            }
            ToggleRow("Unlock editing without a password", easyUnlock) { on ->
                if (!syncedLoaded) return@ToggleRow
                if (on) {
                    unlockPassword = ""
                    confirmEasyUnlock = true   // not real until the password confirms it
                } else {
                    easyUnlock = false
                    saveSynced("easyUnlock", false)
                }
            }
            Text("For older, more capable kids who edit their own board.",
                fontSize = 12.sp, color = Brand.muted)
            syncedMsg?.let { Text(it, fontSize = 12.sp, color = Color(0xFFC0392B)) }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    scope.launch {
                        c.displayPrefs.reloadFromServer()
                        c.board.refresh(c.auth.childSlug)
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Refresh board from server") }
            TextButton(onClick = { c.displayPrefs.resetToDefaults() },
                modifier = Modifier.fillMaxWidth()) {
                Text("Reset look to defaults", color = Brand.muted)
            }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Done", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
            }
        }
    }

    if (confirmEasyUnlock) {
        Dialog(onDismissRequest = { confirmEasyUnlock = false; unlockPassword = "" }) {
            Column(
                Modifier.background(Color.White, RoundedCornerShape(22.dp)).padding(24.dp),
            ) {
                Text("Skip the password on the board's lock?", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                Spacer(Modifier.height(8.dp))
                Text(
                    "This only changes the board's lock. Your account password stays exactly " +
                        "the same for signing in everywhere. With this on, anyone holding this " +
                        "device, including your child, can open edit mode, change or delete " +
                        "tiles, and reach the parent dashboard. Enter your account password once to confirm.",
                    fontSize = 13.sp, color = Brand.ink,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = unlockPassword, onValueChange = { unlockPassword = it },
                    label = { Text("Your password") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { confirmEasyUnlock = false; unlockPassword = "" }) {
                        Text("Cancel", color = Brand.muted)
                    }
                    Button(
                        onClick = { confirmUnlockWaiver() },
                        enabled = !unlockBusy && unlockPassword.isNotEmpty(),
                        colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                    ) { Text(if (unlockBusy) "Checking…" else "Remove the password") }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(text, fontSize = 12.sp, fontWeight = FontWeight.Black, color = Brand.pinkDeep,
        modifier = Modifier.padding(top = 14.dp, bottom = 4.dp))
}

@Composable
private fun ToggleRow(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 15.sp, color = Brand.ink, modifier = Modifier.weight(1f))
        Switch(checked = value, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = Brand.pink))
    }
}

@Composable
private fun StepperRow(label: String, value: Int, onChange: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 15.sp, color = Brand.ink, modifier = Modifier.weight(1f))
        TextButton(onClick = { if (value > 1) onChange(value - 1) }) { Text("−", fontSize = 20.sp, color = Brand.pinkDeep) }
        Text("$value", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Brand.ink,
            modifier = Modifier.width(28.dp), )
        // 1–8, matching the web modal + iOS steppers.
        TextButton(onClick = { if (value < 8) onChange(value + 1) }) { Text("+", fontSize = 20.sp, color = Brand.pinkDeep) }
    }
}

/** The preset palette — friendly board colors incl. every shipped default. */
private val SWATCHES = listOf(
    "#ffffff", "#fff7e6", "#ffd400", "#fde68a", "#fce4ec", "#ff1493",
    "#ffe4e6", "#d1fae5", "#c8e6c9", "#dbeafe", "#bfdbfe", "#ede9fe",
    "#e5e7eb", "#1f2937",
)

/** Labeled swatch-row color picker; keeps the value as the same hex string
 *  shape the web app stores (kidDisplay round-trips unchanged). */
@Composable
private fun ColorRow(label: String, value: String, onChange: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, fontSize = 14.sp, color = Brand.ink)
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (hex in SWATCHES) {
                val selected = value.equals(hex, ignoreCase = true)
                androidx.compose.foundation.layout.Box(
                    Modifier
                        .size(if (selected) 34.dp else 30.dp)
                        .clip(CircleShape)
                        .background(colorFromHex(hex))
                        .border(
                            width = if (selected) 3.dp else 1.dp,
                            color = if (selected) Brand.pink else Color(0xFFB8C2D0),
                            shape = CircleShape,
                        )
                        .clickable { onChange(hex) },
                )
            }
        }
    }
}

private fun colorFromHex(hex: String): Color = try {
    Color(android.graphics.Color.parseColor(hex))
} catch (_: Exception) { Color.White }

package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
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
import io.andrewpeterson.myworld.net.AutoTeachSettings
import io.andrewpeterson.myworld.net.AutoTeachState
import io.andrewpeterson.myworld.net.CareWindow
import io.andrewpeterson.myworld.net.autoTeachState
import io.andrewpeterson.myworld.net.childSettings
import io.andrewpeterson.myworld.net.saveAutoTeach
import io.andrewpeterson.myworld.net.saveQuietHours
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Auto-teach controls + dashboard — port of `Parent/AutoTeachView.swift`:
 * settings (enable hard-gated on quiet hours, cadence, tier, daily game
 * time, cooldown), the required quiet-hours editor, live gate status
 * ("why isn't it running right now?"), and the mastery roll-up.
 */
@Composable
fun AutoTeachView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    var state by remember { mutableStateOf<AutoTeachState?>(null) }
    var settings by remember { mutableStateOf(AutoTeachSettings()) }
    var error by remember { mutableStateOf<String?>(null) }
    var needsQuietAlert by remember { mutableStateOf(false) }

    // Quiet hours editor state.
    var wake by remember { mutableStateOf("07:00") }
    var bedtime by remember { mutableStateOf("19:30") }
    var care by remember { mutableStateOf<List<CareWindow>>(emptyList()) }
    var noOutsideCare by remember { mutableStateOf(false) }
    var quietLoaded by remember { mutableStateOf(false) }

    // Mirrors the server's scheduleReady() so the toggle gates locally.
    val quietHoursReady = wake.isNotEmpty() && bedtime.isNotEmpty() &&
        (noOutsideCare || care.any { it.days.isNotEmpty() })

    suspend fun refetchState() {
        try { state = c.api.autoTeachState(c.auth.childSlug) } catch (_: Exception) {}
    }
    fun saveSettings() {
        scope.launch { c.api.saveAutoTeach(c.auth.childSlug, settings); refetchState() }
    }
    fun saveQuiet() {
        if (!quietLoaded) return
        scope.launch {
            c.api.saveQuietHours(c.auth.childSlug, wake, bedtime, care, noOutsideCare)
            refetchState()
        }
    }

    LaunchedEffect(Unit) {
        try {
            val s = c.api.autoTeachState(c.auth.childSlug)
            state = s; settings = s.settings
        } catch (e: Exception) { error = "Could not load: ${e.message}" }
        // Quiet-hours blob (settings.schedule) into the editor.
        val sched = c.api.childSettings(c.auth.childSlug)["schedule"] as? JsonObject
        (sched?.get("wake") as? JsonPrimitive)?.content?.takeIf { it.isNotEmpty() }?.let { wake = it }
        (sched?.get("bedtime") as? JsonPrimitive)?.content?.takeIf { it.isNotEmpty() }?.let { bedtime = it }
        noOutsideCare = (sched?.get("noOutsideCare") as? JsonPrimitive)?.booleanOrNull ?: false
        care = ((sched?.get("locations") as? JsonArray) ?: emptyList()).mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val t = (o["type"] as? JsonPrimitive)?.content ?: return@mapNotNull null
            if (t != "school" && t != "therapy") return@mapNotNull null
            CareWindow(
                type = t,
                days = ((o["days"] as? JsonArray) ?: emptyList())
                    .mapNotNull { (it as? JsonPrimitive)?.intOrNull }.toSet(),
                start = (o["start"] as? JsonPrimitive)?.content ?: "09:00",
                end = (o["end"] as? JsonPrimitive)?.content ?: "15:00",
            )
        }
        quietLoaded = true
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
                Text("Auto-teach", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
            }

            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                error?.let { Text(it, fontSize = 13.sp, color = Color(0xFFDC2626)) }

                // ── Settings ────────────────────────────────────────────
                StatCard("Auto-teach the whole board") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Run learning automatically", fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold, color = Brand.ink,
                            modifier = Modifier.weight(1f))
                        Switch(
                            checked = settings.enabled,
                            onCheckedChange = { on ->
                                // HARD GATE: no quiet hours → no auto-teach.
                                if (on && !quietHoursReady) { needsQuietAlert = true; return@Switch }
                                settings = settings.copy(enabled = on); saveSettings()
                            },
                            colors = SwitchDefaults.colors(checkedTrackColor = Brand.pink),
                        )
                    }
                    if (!quietHoursReady) {
                        Text("Set sleep times and school/therapy windows below to unlock.",
                            fontSize = 12.sp, color = Brand.muted)
                    }
                    Spacer(Modifier.height(8.dp))
                    SettingRow("Cadence") {
                        OptionMenu(
                            listOf("conservative" to "Conservative", "standard" to "Standard", "intensive" to "Intensive"),
                            settings.cadence,
                        ) { settings = settings.copy(cadence = it); saveSettings() }
                    }
                    SettingRow("Attention tier") {
                        OptionMenu(
                            listOf("under3" to "Under 3", "3to5" to "3-5", "5plus" to "5 and up"),
                            settings.tier,
                        ) { settings = settings.copy(tier = it); saveSettings() }
                    }
                    SettingRow("Daily game time") {
                        TimeChip(settings.dailyGameAt) {
                            settings = settings.copy(dailyGameAt = it); saveSettings()
                        }
                    }
                    SettingRow("Cooldown") {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = {
                                if (settings.cooldownMin > 15) {
                                    settings = settings.copy(cooldownMin = settings.cooldownMin - 5); saveSettings()
                                }
                            }) { Text("−", fontSize = 18.sp) }
                            Text("${settings.cooldownMin} min", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            TextButton(onClick = {
                                if (settings.cooldownMin < 120) {
                                    settings = settings.copy(cooldownMin = settings.cooldownMin + 5); saveSettings()
                                }
                            }) { Text("＋", fontSize = 16.sp) }
                        }
                    }
                }

                Spacer(Modifier.height(14.dp))

                // ── Quiet hours (required before enabling) ──────────────
                StatCard("Quiet hours — when NOT to run") {
                    Text("Auto-teach never fires while your child is asleep, at school, or in therapy. Required before it can be turned on.",
                        fontSize = 12.sp, color = Brand.muted)
                    Spacer(Modifier.height(8.dp))
                    SettingRow("Wake time") { TimeChip(wake) { wake = it; saveQuiet() } }
                    SettingRow("Bedtime") { TimeChip(bedtime) { bedtime = it; saveQuiet() } }

                    care.forEachIndexed { idx, w ->
                        CareWindowRow(
                            w,
                            onChange = { updated ->
                                care = care.toMutableList().also { it[idx] = updated }; saveQuiet()
                            },
                            onDelete = {
                                care = care.filterIndexed { i, _ -> i != idx }; saveQuiet()
                            },
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    Row {
                        AddChip("＋ School window") {
                            care = care + CareWindow(type = "school")
                            saveQuiet()
                        }
                        Spacer(Modifier.width(10.dp))
                        AddChip("＋ Therapy window") {
                            care = care + CareWindow(type = "therapy", days = setOf(2), start = "13:00", end = "14:00")
                            saveQuiet()
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("No school or therapy right now", fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold, color = Brand.ink,
                            modifier = Modifier.weight(1f))
                        Switch(checked = noOutsideCare,
                            onCheckedChange = { noOutsideCare = it; saveQuiet() },
                            colors = SwitchDefaults.colors(checkedTrackColor = Brand.pink))
                    }
                }

                Spacer(Modifier.height(14.dp))

                // ── Gates ("why isn't it running right now?") ───────────
                StatCard("Status right now") {
                    val g = state?.gates
                    if (g == null) {
                        Text("Loading status…", fontSize = 12.sp, color = Brand.muted)
                    } else {
                        GateLine(g.subscribed ?: true, "Membership active",
                            "Automatic teaching is part of My World memberships (from $4.99/mo) — join in Credits & Store")
                        GateLine(g.enabled, "Auto-teach is on", "Auto-teach is off")
                        GateLine(g.scheduleReady ?: true, "Quiet hours are set",
                            "Quiet hours missing — set them above")
                        GateLine(!g.inBlackout, "Currently a teachable window",
                            "Inside a blackout (sleep / school / meal)")
                        GateLine(!g.recentlyActive, "Child isn't actively tapping",
                            "Child is using the board — won't interrupt")
                        if (g.cooldownLeftMin > 0)
                            GateLine(false, "", "Cooldown: next allowed in ${g.cooldownLeftMin} min")
                        else GateLine(true, "Cooldown clear", "")
                        Spacer(Modifier.height(6.dp))
                        Row {
                            Text("Today's exposure budget", fontSize = 12.sp, color = Brand.muted,
                                modifier = Modifier.weight(1f))
                            Text("${g.budgetUsedMin} / ${g.budgetCapMin} min", fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (g.budgetExhausted) Brand.muted else Brand.ink)
                        }
                    }
                }

                Spacer(Modifier.height(14.dp))

                // ── Mastery roll-up ─────────────────────────────────────
                StatCard("Progress by category") {
                    val mastery = state?.mastery ?: emptyList()
                    if (mastery.isEmpty()) {
                        Text("No taxonomy data yet.", fontSize = 12.sp, color = Brand.muted)
                    }
                    mastery.sortedByDescending { it.total }.forEach { row ->
                        Row {
                            Text(row.category, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                                color = Brand.ink, modifier = Modifier.weight(1f))
                            Text("${row.mastered + row.maintenance} / ${row.total} mastered",
                                fontSize = 11.sp, color = Brand.muted)
                        }
                        Spacer(Modifier.height(4.dp))
                        // Stacked bar: maintenance · mastered · acquired · active · unmet.
                        Row(Modifier.fillMaxWidth().height(8.dp)
                            .background(hexColor("#f1e3ec"), RoundedCornerShape(50))) {
                            MasterySeg(row.maintenance, row.total, hexColor("#10b981"))
                            MasterySeg(row.mastered, row.total, hexColor("#059669"))
                            MasterySeg(row.acquired, row.total, Brand.pinkDeep)
                            MasterySeg(row.active, row.total, Brand.pink)
                        }
                        Spacer(Modifier.height(10.dp))
                    }
                }

                Spacer(Modifier.height(12.dp))
                Text(
                    "Auto-teach runs short exposure slideshows (~45-90s) at your chosen cadence during teachable windows, plus one game session per day at the time you pick. It honors quiet hours, school, and meal windows from your schedule, and pauses when the child is actively using the board. Mastery follows the clinical 80/90 rule — words move to a biweekly maintenance check rather than disappearing.",
                    fontSize = 11.sp, color = Brand.muted,
                )
            }
        }
    }

    if (needsQuietAlert) {
        AlertDialog(
            onDismissRequest = { needsQuietAlert = false },
            confirmButton = {
                TextButton(onClick = { needsQuietAlert = false }) { Text("OK") }
            },
            title = { Text("Quiet hours first") },
            text = { Text("Before auto-teach can run, tell it when NOT to: set sleep times and add the school/therapy windows below (or confirm there are none). It will never fire inside those.") },
        )
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.MasterySeg(n: Int, total: Int, color: Color) {
    if (n > 0 && total > 0) {
        Box(Modifier.weight(n.toFloat()).height(8.dp).background(color))
    }
}

@Composable
private fun SettingRow(title: String, value: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp)
            .background(hexColor("#fff7fb"), RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink,
            modifier = Modifier.weight(1f))
        value()
    }
}

@Composable
private fun OptionMenu(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) {
            Text((options.firstOrNull { it.first == selected }?.second ?: selected) + "  ▾",
                color = Brand.pinkDeep, fontWeight = FontWeight.SemiBold)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, label) ->
                DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onSelect(value) })
            }
        }
    }
}

/** "HH:MM" chip that opens a Material time picker; every change saves. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeChip(value: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    TextButton(onClick = { open = true }) {
        Text(value, color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
    }
    if (open) {
        val parts = value.split(":")
        val pickerState = rememberTimePickerState(
            initialHour = parts.getOrNull(0)?.toIntOrNull() ?: 12,
            initialMinute = parts.getOrNull(1)?.toIntOrNull() ?: 0,
            is24Hour = false,
        )
        AlertDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    open = false
                    onChange("%02d:%02d".format(pickerState.hour, pickerState.minute))
                }) { Text("Set", fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
            text = { TimePicker(state = pickerState) },
        )
    }
}

@Composable
private fun AddChip(label: String, onTap: () -> Unit) {
    Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep,
        modifier = Modifier
            .background(hexColor("#fce4ef"), RoundedCornerShape(50))
            .clickable(onClick = onTap)
            .padding(horizontal = 12.dp, vertical = 8.dp))
}

@Composable
private fun GateLine(ok: Boolean, okText: String, koText: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
        Text(if (ok) "✅" else "⏸", fontSize = 13.sp)
        Spacer(Modifier.width(8.dp))
        Text(if (ok) okText else koText, fontSize = 13.sp, color = Brand.ink)
    }
}

@Composable
private fun CareWindowRow(w: CareWindow, onChange: (CareWindow) -> Unit, onDelete: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(hexColor("#fff7fb"), RoundedCornerShape(10.dp)).padding(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (w.type == "therapy") "🩺 Therapy" else "🏫 School",
                fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Brand.ink,
                modifier = Modifier.weight(1f))
            TimeChip(w.start) { onChange(w.copy(start = it)) }
            Text("–", color = Brand.muted)
            TimeChip(w.end) { onChange(w.copy(end = it)) }
            TextButton(onClick = onDelete) { Text("🗑", fontSize = 14.sp) }
        }
        Row {
            val letters = listOf("S", "M", "T", "W", "T", "F", "S")
            for (d in 0..6) {
                val on = d in w.days
                Box(
                    Modifier.size(28.dp)
                        .background(if (on) Brand.pink else Color.White, CircleShape)
                        .clickable {
                            onChange(w.copy(days = if (on) w.days - d else w.days + d))
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(letters[d], fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        color = if (on) Color.White else Brand.muted)
                }
                Spacer(Modifier.width(6.dp))
            }
        }
    }
}

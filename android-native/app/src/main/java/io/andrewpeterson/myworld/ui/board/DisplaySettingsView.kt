package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.DisplayPrefsData
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.coroutines.launch

/**
 * "⚙ Display" — port of `Views/DisplaySettingsView.swift`: hide labels,
 * per-section show + tiles-across, refresh from server. (Band/header color
 * pickers use the same data; presets keep it simple on Android v1 — the full
 * palette is editable from the web dashboard, which shares the same
 * child_settings.kidDisplay blob.)
 */
@Composable
fun DisplaySettingsView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val d by c.displayPrefs.data.collectAsState()

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

            ToggleRow("Hide labels", d.hideLabels) { on ->
                c.displayPrefs.update { it.copy(hideLabels = on) }
            }

            SectionHeader("SECTIONS")
            ToggleRow("People", d.showPeople) { on -> c.displayPrefs.update { it.copy(showPeople = on) } }
            ToggleRow("Nouns", d.showNouns) { on -> c.displayPrefs.update { it.copy(showNouns = on) } }
            ToggleRow("Verbs", d.showVerbs) { on -> c.displayPrefs.update { it.copy(showVerbs = on) } }
            ToggleRow("Needs strip", d.showNeeds) { on -> c.displayPrefs.update { it.copy(showNeeds = on) } }

            SectionHeader("TILES ACROSS")
            StepperRow("People", d.acrossPeople) { v -> c.displayPrefs.update { it.copy(acrossPeople = v) } }
            StepperRow("Nouns", d.acrossNouns) { v -> c.displayPrefs.update { it.copy(acrossNouns = v) } }
            StepperRow("Verbs", d.acrossVerbs) { v -> c.displayPrefs.update { it.copy(acrossVerbs = v) } }

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
                Text("Reset to defaults", color = Brand.muted)
            }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Done", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
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
        TextButton(onClick = { if (value < 6) onChange(value + 1) }) { Text("+", fontSize = 20.sp, color = Brand.pinkDeep) }
    }
}

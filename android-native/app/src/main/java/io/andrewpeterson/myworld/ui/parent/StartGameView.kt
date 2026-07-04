package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * Parent game launcher — port of `Parent/StartGameView.swift` (core surface:
 * activity mode + scope + choices + sample + time limit → publishes the same
 * `start` live command the web console sends).
 */
@Composable
fun StartGameView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val tabletOnline by c.parentLive.tabletOnline.collectAsState()

    val modes = listOf(
        "matching" to "Matching game",
        "clue_quiz" to "Clue quiz",
        "auditory_comprehension" to "Listen & find",
        "expressive_naming" to "Say the word",
        "learn_slideshow" to "Learn slideshow",
        "teach_slideshow" to "Teach Me slideshow",
    )
    var modeIdx by remember { mutableIntStateOf(0) }
    var scopeSel by remember { mutableStateOf("all") }
    var choices by remember { mutableIntStateOf(3) }
    var sample by remember { mutableIntStateOf(0) }
    var limitMin by remember { mutableIntStateOf(0) }
    var sent by remember { mutableStateOf(false) }

    val scopes = buildList {
        add("all" to "Everything")
        add("people" to "People"); add("nouns" to "Nouns"); add("verbs" to "Verbs"); add("needs" to "Needs")
        for (s in listOf(BoardSection.PEOPLE, BoardSection.NOUNS, BoardSection.VERBS)) {
            for (cat in c.board.roots(s)) add("cat:${cat.id}" to cat.label)
        }
    }

    fun startGame() {
        scope.launch {
            val fields = mutableMapOf(
                "action" to JsonPrimitive("start"),
                "mode" to JsonPrimitive(modes[modeIdx].first),
                "scope" to JsonPrimitive(scopeSel),
                "choices" to JsonPrimitive(choices),
            )
            if (sample > 0) fields["sample"] = JsonPrimitive(sample)
            if (limitMin > 0) fields["limitMin"] = JsonPrimitive(limitMin)
            c.parentLive.sendCommand(fields)
            sent = true
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxWidth(0.94f)
                .background(Color.White, RoundedCornerShape(24.dp))
                .padding(22.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text("Start an activity", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Text(
                if (tabletOnline) "Tablet connected ✅" else "Waiting for the tablet… (open the board)",
                fontSize = 13.sp, color = if (tabletOnline) Brand.goodInk else Brand.muted,
            )
            Spacer(Modifier.height(14.dp))

            Text("ACTIVITY", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            modes.forEachIndexed { i, (_, label) ->
                PickRow(label, selected = modeIdx == i) { modeIdx = i }
            }

            Spacer(Modifier.height(12.dp))
            Text("WHAT TO PRACTICE", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            scopes.forEach { (value, label) ->
                PickRow(label, selected = scopeSel == value) { scopeSel = value }
            }

            Spacer(Modifier.height(12.dp))
            StepRow("Choices on screen", choices, 2, 6) { choices = it }
            StepRow("How many words (0 = all)", sample, 0, 20) { sample = it }
            StepRow("Time limit (min, 0 = none)", limitMin, 0, 30) { limitMin = it }

            Spacer(Modifier.height(18.dp))
            Button(
                onClick = { startGame() },
                enabled = !sent,
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text(if (sent) "Sent to the board ✅" else "Start on the board", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Close", color = Brand.muted)
            }
        }
    }
}

@Composable
private fun PickRow(label: String, selected: Boolean, onTap: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp)
            .background(if (selected) hexColor("#fce4ec") else Color.Transparent, RoundedCornerShape(10.dp))
            .border(1.dp, if (selected) Brand.pink else Color.Transparent, RoundedCornerShape(10.dp))
            .clickable(onClick = onTap)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 15.sp, color = Brand.ink, modifier = Modifier.weight(1f))
        if (selected) Text("✓", color = Brand.pink, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun StepRow(label: String, value: Int, min: Int, max: Int, onChange: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 14.sp, color = Brand.ink, modifier = Modifier.weight(1f))
        TextButton(onClick = { if (value > min) onChange(value - 1) }) { Text("−", fontSize = 20.sp, color = Brand.pinkDeep) }
        Text("$value", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
        TextButton(onClick = { if (value < max) onChange(value + 1) }) { Text("+", fontSize = 20.sp, color = Brand.pinkDeep) }
    }
}

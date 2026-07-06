package io.andrewpeterson.myworld.ui.parent

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * The facilitator console — port of `Parent/FacilitatorView.swift`. Auto-pops
 * while the tablet reports a running game: shows the live target + progress,
 * and the mark buttons (the mark IS the credit + input method), skip, end.
 */
@Composable
fun FacilitatorView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val status by c.parentLive.status.collectAsState()

    val payload = status?.payload
    val target = payload?.target

    fun send(vararg pairs: Pair<String, String>) {
        scope.launch {
            c.parentLive.sendCommand(pairs.associate { it.first to JsonPrimitive(it.second) })
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.background(Color.White, RoundedCornerShape(24.dp)).padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Helping hand", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(4.dp))
            Text(
                if (payload != null) "Question ${(payload.i ?: 0) + 1} of ${payload.total ?: 0} · ⭐ ${payload.correctCount ?: 0}"
                else "Waiting for the board…",
                fontSize = 13.sp, color = Brand.muted,
            )
            Spacer(Modifier.height(14.dp))

            // The live target the child is being asked for.
            val image by produceState<Bitmap?>(initialValue = null, target?.imageKey) {
                val key = target?.imageKey
                value = if (key.isNullOrEmpty()) null else c.media.bitmap(key)
            }
            val img = image
            if (img != null) {
                Image(img.asImageBitmap(), contentDescription = target?.label,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(140.dp).clip(RoundedCornerShape(20.dp)))
            }
            target?.let {
                Spacer(Modifier.height(6.dp))
                Text(it.label, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
            }

            Spacer(Modifier.height(16.dp))
            Text("HOW DID THEY ANSWER?", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MarkButton("🗣 Said it", Brand.verbalInk) { send("action" to "mark", "method" to "verbal") }
                MarkButton("✋ Gesture", Brand.objectInk) { send("action" to "mark", "method" to "gesture") }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MarkButton("🧸 Object", Brand.objectInk) { send("action" to "mark", "method" to "object") }
                MarkButton("🤝 Helped", Brand.tapInk) { send("action" to "mark", "method" to "physical") }
            }

            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.background(hexColor("#fff0f6"), RoundedCornerShape(999.dp))
                        .clickable { send("action" to "skip") }
                        .padding(horizontal = 20.dp, vertical = 11.dp),
                ) { Text("Skip →", fontWeight = FontWeight.Bold, color = Brand.pinkDeep) }
                Box(
                    Modifier.background(Color(0xFFFEE2E2), RoundedCornerShape(999.dp))
                        .clickable { send("action" to "end"); onDismiss() }
                        .padding(horizontal = 20.dp, vertical = 11.dp),
                ) { Text("End", fontWeight = FontWeight.Bold, color = Color(0xFFDC2626)) }
            }
            Spacer(Modifier.height(6.dp))
            Box(Modifier.clickable(onClick = onDismiss).padding(8.dp)) {
                Text("Hide (game keeps going)", fontSize = 12.sp, color = Brand.muted)
            }
        }
    }
}

@Composable
private fun MarkButton(label: String, tint: Color, onTap: () -> Unit) {
    Box(
        Modifier.background(tint.copy(alpha = 0.12f), RoundedCornerShape(14.dp))
            .clickable(onClick = onTap)
            .padding(horizontal = 18.dp, vertical = 12.dp),
    ) {
        Text(label, fontWeight = FontWeight.Bold, color = tint, fontSize = 15.sp)
    }
}

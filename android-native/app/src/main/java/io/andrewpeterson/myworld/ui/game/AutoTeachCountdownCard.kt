package io.andrewpeterson.myworld.ui.game

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.delay

/**
 * "Learning time! 📚" — the friendly 10-second staging card auto-teach shows
 * before its slideshow/game takes the screen. A grown-up can ✕ to skip this
 * round. Port of `AutoTeachCountdownCard` in ScheduledPromptViews.swift.
 */
@Composable
fun AutoTeachCountdownCard(mode: String, onFire: () -> Unit, onSkip: () -> Unit) {
    var left by remember { mutableIntStateOf(10) }
    LaunchedEffect(Unit) {
        while (left > 0) {
            delay(1_000)
            left -= 1
        }
        onFire()
    }

    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f))) {
        Column(
            Modifier
                .align(Alignment.Center)
                .widthIn(max = 420.dp)
                .background(Color.White, RoundedCornerShape(26.dp))
                .padding(30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.align(Alignment.End)) {
                Box(
                    Modifier.size(40.dp).background(hexColor("#fce4ec"), CircleShape)
                        .clickable(onClick = onSkip),
                    contentAlignment = Alignment.Center,
                ) { Text("✕", fontSize = 17.sp, color = Brand.pinkDeep) }
            }
            Text("📚", fontSize = 52.sp)
            Spacer(Modifier.height(6.dp))
            Text("Learning time!", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(8.dp))
            Text(
                (if (mode == "game") "A quick game is starting" else "A picture show is starting") +
                    " in $left…",
                fontSize = 15.sp, color = Brand.muted,
            )
        }
    }
}

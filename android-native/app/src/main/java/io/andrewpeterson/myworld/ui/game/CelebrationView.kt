package io.andrewpeterson.myworld.ui.game

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.delay

/**
 * Standalone celebration — confetti + a spoken cheer, auto-closes.
 * Port of `Views/CelebrationView.swift`.
 */
@Composable
fun CelebrationView(onExit: () -> Unit) {
    val c = LocalAppContainer.current
    LaunchedEffect(Unit) {
        c.gameAudio.playCheer(c.auth.childSlug)
        delay(4_400)
        onExit()
    }
    Box(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("🎉", fontSize = 110.sp)
            Text("Hooray!", fontSize = 52.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
        }
        ConfettiView(running = true)
    }
}

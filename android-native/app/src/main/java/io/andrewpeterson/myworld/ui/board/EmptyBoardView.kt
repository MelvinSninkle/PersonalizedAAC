package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.delay

/**
 * Brand-new board with no tiles yet — friendly full-screen welcome that keeps
 * pulling while the server-side seed build lands words (port of
 * `Views/EmptyBoardView.swift`; the build itself is server-durable, started
 * by onboarding — this view just watches it arrive).
 */
@Composable
fun EmptyBoardView(possessive: String, onRefreshed: () -> Unit) {
    val c = LocalAppContainer.current

    // Poll every 12s — finished tiles pop in without any button pressing.
    LaunchedEffect(Unit) {
        while (true) {
            delay(12_000)
            c.board.refresh(c.auth.childSlug)
            onRefreshed()
        }
    }

    Column(
        Modifier.fillMaxSize().background(hexColor("#fff7fb")),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🌍", fontSize = 64.sp)
        Spacer(Modifier.height(16.dp))
        Text(
            "Building $possessive board…",
            fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "The first words are being drawn and voiced right now.\nThey'll appear here as they finish — nothing to do.",
            fontSize = 15.sp, color = Brand.muted, textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 32.dp),
        )
        Spacer(Modifier.height(20.dp))
        CircularProgressIndicator(color = Brand.pink)
    }
}

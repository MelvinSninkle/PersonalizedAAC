package io.andrewpeterson.myworld.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.ui.theme.Brand

/**
 * The universal hold-to-exit ✕ every full-screen child view uses — port of
 * `Views/LongPressExitButton.swift`. A quick tap does NOTHING (kids mash);
 * only a deliberate long-press (~0.7s, Android's system long-press) exits,
 * with a haptic confirm.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LongPressExitButton(
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = Brand.pinkDeep,
    background: Color = Color.Black.copy(alpha = 0.06f),
) {
    val haptics = LocalHapticFeedback.current
    Box(
        modifier
            .padding(14.dp)
            .size(50.dp)
            .background(background, CircleShape)
            .combinedClickable(
                onClick = { /* deliberate no-op — tap must never exit */ },
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onExit()
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text("✕", fontSize = 22.sp, color = tint)
    }
}

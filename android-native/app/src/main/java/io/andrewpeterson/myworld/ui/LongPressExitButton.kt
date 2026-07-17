package io.andrewpeterson.myworld.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.ui.input.pointer.pointerInput
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
            // Custom hold gesture (combinedClickable's long-press length is a
            // fixed system constant): the hold length is the parent's
            // exitHoldMs slider; quick-tap close (easyClose) fires on release.
            .pointerInput(Unit) {
                androidx.compose.foundation.gestures.awaitEachGesture {
                    val down = androidx.compose.foundation.gestures.awaitFirstDown()
                    down.consume()
                    if (io.andrewpeterson.myworld.access.TouchConfig.easyClose) {
                        val up = androidx.compose.foundation.gestures.waitForUpOrCancellation()
                        if (up != null) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            onExit()
                        }
                    } else {
                        val holdMs = io.andrewpeterson.myworld.access.TouchConfig.exitHoldMs.toLong()
                        // Inner block completes (true) on release OR cancel →
                        // no exit; only a genuine full-length hold times out.
                        val released = kotlinx.coroutines.withTimeoutOrNull(holdMs) {
                            androidx.compose.foundation.gestures.waitForUpOrCancellation(); true
                        }
                        if (released == null) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            onExit()
                        }
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text("✕", fontSize = 22.sp, color = tint)
    }
}

package io.andrewpeterson.myworld.ui.game

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import kotlin.random.Random

/**
 * Confetti burst — port of `Views/ConfettiView.swift` (Canvas + TimelineView
 * particles become Compose Canvas + an infinite transition clock).
 */
@Composable
fun ConfettiView(running: Boolean, modifier: Modifier = Modifier) {
    if (!running) return
    val particles = remember {
        List(90) {
            Particle(
                x = Random.nextFloat(),
                speed = 0.55f + Random.nextFloat() * 0.9f,
                phase = Random.nextFloat(),
                size = 8f + Random.nextFloat() * 10f,
                color = CONFETTI_COLORS[Random.nextInt(CONFETTI_COLORS.size)],
                sway = 18f + Random.nextFloat() * 26f,
            )
        }
    }
    val transition = rememberInfiniteTransition(label = "confetti")
    val t by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing)),
        label = "confettiClock",
    )

    Canvas(modifier.fillMaxSize()) {
        for (p in particles) {
            val progress = ((t * p.speed) + p.phase) % 1f
            val y = progress * size.height * 1.1f - size.height * 0.05f
            val x = p.x * size.width +
                kotlin.math.sin(progress * 6.28f * 2 + p.phase * 6.28f) * p.sway
            drawRect(
                color = p.color,
                topLeft = Offset(x, y),
                size = Size(p.size, p.size * 0.6f),
                alpha = (1f - progress).coerceIn(0.15f, 1f),
            )
        }
    }
}

private data class Particle(
    val x: Float, val speed: Float, val phase: Float,
    val size: Float, val color: Color, val sway: Float,
)

private val CONFETTI_COLORS = listOf(
    Color(0xFFFF1493), Color(0xFFFACC15), Color(0xFF16A34A),
    Color(0xFF3B82F6), Color(0xFFA855F7), Color(0xFFF97316),
)

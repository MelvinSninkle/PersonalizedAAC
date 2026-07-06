package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * Small hand-rolled chart kit for the stats screens — a multi-line chart on
 * Compose Canvas plus the shared card/segment chrome. Deliberately no chart
 * library: the iOS Swift Charts screens are simple line + bar surfaces and a
 * ~100-line Canvas port keeps behavior exact and dependencies zero.
 */

data class ChartSeries(val name: String, val values: List<Float>)

/** Categorical palette — pink first (brand), then clearly-separable hues. */
val CHART_COLORS = listOf(
    "#ff1493", "#3b82f6", "#10b981", "#f59e0b",
    "#8b5cf6", "#ef4444", "#14b8a6", "#6b7280",
).map { hexColor(it) }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MultiLineChart(
    series: List<ChartSeries>,
    labels: List<String>,
    modifier: Modifier = Modifier,
    yMax: Float? = null,          // fixed domain top (100 for accuracy charts)
    chartHeight: Dp = 220.dp,
) {
    val drawn = series.filter { it.values.isNotEmpty() }
    if (drawn.isEmpty()) return
    val maxV = yMax ?: maxOf(1f, drawn.maxOf { s -> s.values.max() })

    Column(modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(chartHeight)) {
            val leftPad = 42.dp.toPx()
            val bottomPad = 22.dp.toPx()
            val w = size.width - leftPad
            val h = size.height - bottomPad
            val n = maxOf(2, labels.size)

            val axisPaint = android.graphics.Paint().apply {
                color = android.graphics.Color.parseColor("#8a8f98")
                textSize = 9.sp.toPx()
                isAntiAlias = true
            }

            // Horizontal grid + y labels (0, 25, 50, 75, 100% of domain).
            for (i in 0..4) {
                val frac = i / 4f
                val y = h - h * frac
                drawLine(
                    color = Color(0x14000000),
                    start = Offset(leftPad, y), end = Offset(size.width, y),
                    strokeWidth = 1.dp.toPx(),
                )
                val v = (maxV * frac)
                val text = if (maxV <= 100f && yMax != null) "${v.toInt()}"
                else if (v >= 1000f) "${(v / 1000f).toInt()}k" else "${v.toInt()}"
                drawContext.canvas.nativeCanvas.drawText(text, 4.dp.toPx(), y + 3.dp.toPx(), axisPaint)
            }

            // X labels every ~n/6 buckets.
            val step = maxOf(1, n / 6)
            for (i in labels.indices step step) {
                val x = leftPad + w * i / (n - 1)
                drawContext.canvas.nativeCanvas.drawText(
                    labels[i], x, size.height - 4.dp.toPx(), axisPaint)
            }

            // One polyline per series.
            drawn.forEachIndexed { si, s ->
                val color = CHART_COLORS[si % CHART_COLORS.size]
                val path = Path()
                var started = false
                s.values.forEachIndexed { i, v ->
                    if (i >= n) return@forEachIndexed
                    val x = leftPad + w * i / (n - 1)
                    val y = h - h * (v / maxV).coerceIn(0f, 1f)
                    if (!started) { path.moveTo(x, y); started = true } else path.lineTo(x, y)
                }
                drawPath(path, color, style = Stroke(width = 2.5f.dp.toPx()))
            }
        }

        // Legend — wraps like the iOS bottom legend.
        FlowRow(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            drawn.forEachIndexed { si, s ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(9.dp).background(CHART_COLORS[si % CHART_COLORS.size], CircleShape))
                    Spacer(Modifier.width(5.dp))
                    Text(s.name, fontSize = 11.sp, color = Brand.ink)
                }
            }
        }
    }
}

/** Horizontal share/progress bar (mastery rows, accuracy-by-method). */
@Composable
fun ShareBar(fraction: Float, color: Color, modifier: Modifier = Modifier, height: Dp = 8.dp) {
    Box(
        modifier.fillMaxWidth().height(height)
            .background(hexColor("#f1e3ec"), RoundedCornerShape(50)),
    ) {
        Box(
            Modifier.fillMaxWidth(fraction.coerceIn(0.02f, 1f)).height(height)
                .background(color, RoundedCornerShape(50)),
        )
    }
}

/** The rounded white stat card every stats surface uses. */
@Composable
fun StatCard(title: String? = null, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth()
            .background(Color.White, RoundedCornerShape(16.dp))
            .border(1.dp, hexColor("#f3c6dd"), RoundedCornerShape(16.dp))
            .padding(14.dp),
    ) {
        title?.let {
            Text(it, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(10.dp))
        }
        content()
    }
}

/** Segmented range picker ("7 days / 30 days / 90 days / 1 year"). */
@Composable
fun SegmentedChips(
    options: List<Pair<String, Int>>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().background(hexColor("#f7e6f0"), RoundedCornerShape(12.dp)).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { (label, value) ->
            val active = value == selected
            Box(
                Modifier.weight(1f)
                    .background(if (active) Brand.pink else Color.Transparent, RoundedCornerShape(9.dp))
                    .clickable { onSelect(value) }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, fontSize = 13.sp,
                    fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                    color = if (active) Color.White else Brand.ink)
            }
        }
    }
}

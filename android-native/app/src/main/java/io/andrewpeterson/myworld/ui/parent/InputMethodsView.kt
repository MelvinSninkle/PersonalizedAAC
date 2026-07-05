package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.InputMethodsResponse
import io.andrewpeterson.myworld.net.inputMethods
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * How the child answers — tap vs verbal vs object vs physical vs gesture.
 * Port of `Parent/InputMethodsView.swift`: the mercy bridge logs a verbal or
 * physical response as correct exactly like a tap, so this mix tells the
 * parent + SLP whether the child is moving toward independent tapping.
 */

private val METHOD_ORDER = listOf("tap", "verbal", "object", "physical", "gesture", "other")

private fun methodLabel(m: String): String = when (m) {
    "tap" -> "Tapped"
    "verbal" -> "Said it"
    "object" -> "Showed object"
    "physical" -> "Physical prompt"
    "gesture" -> "Gesture"
    else -> "Other"
}

private fun methodColor(m: String): Color = when (m) {
    "tap" -> hexColor("#2563eb")
    "verbal" -> hexColor("#10b981")
    "object" -> hexColor("#8b5cf6")
    "physical" -> hexColor("#f59e0b")
    "gesture" -> hexColor("#ec4899")
    else -> hexColor("#6b7280")
}

@Composable
internal fun InputMethodsPage() {
    val c = LocalAppContainer.current
    var days by remember { mutableStateOf(30) }
    var data by remember { mutableStateOf<InputMethodsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(days) {
        data = null; error = null
        try { data = c.api.inputMethods(c.auth.childSlug, days = days) }
        catch (e: Exception) { error = "Could not load: ${e.message}" }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        SegmentedChips(listOf("7 days" to 7, "30 days" to 30, "90 days" to 90), days) { days = it }
        Spacer(Modifier.height(14.dp))
        val d = data
        when {
            error != null -> Text(error!!, fontSize = 13.sp, color = Color(0xFFDC2626))
            d == null -> LoadingSpinner("Loading…")
            else -> {
                BreakdownCard(d)
                Spacer(Modifier.height(14.dp))
                TrendCard(d)
                Spacer(Modifier.height(14.dp))
                AccuracyByMethodCard(d)
            }
        }
    }
}

/** One stacked bar showing each method's share, with a counted legend. */
@Composable
private fun BreakdownCard(d: InputMethodsResponse) {
    val total = METHOD_ORDER.sumOf { d.totals[it] ?: 0 }
    StatCard("Response mix") {
        if (total == 0) {
            Text("No game responses recorded yet.", fontSize = 12.sp, color = Brand.muted)
            return@StatCard
        }
        Row(Modifier.fillMaxWidth().height(18.dp).clip(RoundedCornerShape(50))) {
            METHOD_ORDER.forEach { m ->
                val n = d.totals[m] ?: 0
                if (n > 0) {
                    Box(Modifier.weight(n.toFloat()).height(18.dp).background(methodColor(m)))
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        METHOD_ORDER.forEach { m ->
            val n = d.totals[m] ?: 0
            if (n > 0) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                    Box(Modifier.size(10.dp).background(methodColor(m), CircleShape))
                    Spacer(Modifier.width(8.dp))
                    Text(methodLabel(m), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        color = Brand.ink, modifier = Modifier.weight(1f))
                    Text("$n · ${n * 100 / total}%", fontSize = 12.sp, color = Brand.muted)
                }
            }
        }
    }
}

@Composable
private fun TrendCard(d: InputMethodsResponse) {
    val series = d.series
        .filter { s -> s.data.any { it > 0 } }
        .map { s -> ChartSeries(methodLabel(s.method), s.data.map { it.toFloat() }) }
    StatCard("How they answered over time") {
        if (series.isEmpty()) {
            Text("Not enough data yet for a trend line.", fontSize = 12.sp, color = Brand.muted)
        } else {
            MultiLineChart(series, d.buckets, chartHeight = 200.dp)
        }
    }
}

@Composable
private fun AccuracyByMethodCard(d: InputMethodsResponse) {
    StatCard("Accuracy by method") {
        var any = false
        METHOD_ORDER.forEach { m ->
            val cRow = d.correctBy[m] ?: return@forEach
            if (cRow.total <= 0) return@forEach
            any = true
            val pct = cRow.ok * 100 / cRow.total
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).background(methodColor(m), CircleShape))
                Spacer(Modifier.width(8.dp))
                Text(methodLabel(m), fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    color = Brand.ink, modifier = Modifier.weight(1f))
                Text("$pct% · ${cRow.ok}/${cRow.total}", fontSize = 12.sp, color = Brand.muted)
            }
            Spacer(Modifier.height(4.dp))
            ShareBar(fraction = pct / 100f, color = methodColor(m))
            Spacer(Modifier.height(10.dp))
        }
        if (!any) Text("No scored responses yet.", fontSize = 12.sp, color = Brand.muted)
    }
}

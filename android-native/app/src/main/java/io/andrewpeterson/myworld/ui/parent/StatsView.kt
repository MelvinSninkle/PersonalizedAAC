package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import io.andrewpeterson.myworld.model.prettyChildName
import io.andrewpeterson.myworld.net.AnalyticsResponse
import io.andrewpeterson.myworld.net.analytics
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import io.andrewpeterson.myworld.ui.theme.prettySkillName

/**
 * The stats hub — port of `Parent/StatsView.swift`: six focused sub-pages
 * behind one full-screen dialog with its own back navigation.
 */
@Composable
fun StatsView(onDismiss: () -> Unit) {
    var page by remember { mutableStateOf<String?>(null) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
            // Top bar: back within the hub, or close.
            Row(
                Modifier.fillMaxWidth().background(Brand.pink).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (page == null) "✕" else "‹ Back",
                    fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.clickable { if (page == null) onDismiss() else page = null }
                        .padding(6.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text(pageTitle(page), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
            }

            when (page) {
                null -> StatsHub { page = it }
                "usage" -> UsagePage()
                "topwords" -> TopWordsPage()
                "history" -> WordHistoryPage()
                "accuracy" -> AccuracyPage()
                "inputs" -> InputMethodsPage()
                "mastery" -> MasterySessionsPage()
            }
        }
    }
}

private fun pageTitle(page: String?): String = when (page) {
    "usage" -> "Usage over time"
    "topwords" -> "Top words"
    "history" -> "Word history"
    "accuracy" -> "Game accuracy"
    "inputs" -> "How they answer"
    "mastery" -> "Mastery & sessions"
    else -> "Stats"
}

@Composable
private fun StatsHub(onOpen: (String) -> Unit) {
    val rows = listOf(
        Triple("usage", "📈", "Usage over time" to "Taps per category, day by day"),
        Triple("topwords", "🏆", "Top words" to "Most-tapped words this month"),
        Triple("history", "🔎", "Word history" to "Search every tap, by word and time"),
        Triple("accuracy", "🎯", "Game accuracy" to "Pass rate by category and by game mode"),
        Triple("inputs", "🖐", "How they answer" to "Tap · verbal · object · physical · gesture"),
        Triple("mastery", "🏅", "Mastery & sessions" to "30-day mastery and recent activity"),
    )
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        rows.forEach { (id, emoji, texts) ->
            Row(
                Modifier.fillMaxWidth()
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .border(1.dp, hexColor("#f3c6dd"), RoundedCornerShape(16.dp))
                    .clickable { onOpen(id) }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(50.dp).background(Brand.pink, CircleShape), contentAlignment = Alignment.Center) {
                    Text(emoji, fontSize = 22.sp)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(texts.first, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
                    Text(texts.second, fontSize = 12.sp, color = Brand.muted)
                }
                Text("›", fontSize = 20.sp, color = Brand.muted)
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

// ── Shared loader chrome ────────────────────────────────────────────────────

@Composable
fun LoadingSpinner(label: String) {
    Column(
        Modifier.fillMaxWidth().padding(top = 60.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = Brand.pink)
        Spacer(Modifier.height(10.dp))
        Text(label, fontSize = 13.sp, color = Brand.muted)
    }
}

// ── Usage over time (the web dashboard's headline "Use" chart) ──────────────

@Composable
private fun UsagePage() {
    val c = LocalAppContainer.current
    var bucket by remember { mutableStateOf(0) }   // 0=day 1=week 2=month
    var data by remember { mutableStateOf<AnalyticsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(bucket) {
        data = null; error = null
        try {
            data = c.api.analytics(c.auth.childSlug, listOf("day", "week", "month")[bucket])
        } catch (e: Exception) { error = "Could not load: ${e.message}" }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        SegmentedChips(listOf("Day" to 0, "Week" to 1, "Month" to 2), bucket) { bucket = it }
        Spacer(Modifier.height(14.dp))
        val d = data
        when {
            error != null -> Text(error!!, fontSize = 13.sp, color = Color(0xFFDC2626))
            d == null -> LoadingSpinner("Loading usage…")
            else -> StatCard("Taps per category") {
                Text(
                    "How often ${prettyChildName(c.auth.childSlug).ifEmpty { "your child" }} communicates with each category on their own.",
                    fontSize = 12.sp, color = Brand.muted,
                )
                Spacer(Modifier.height(10.dp))
                // Top 8 categories by total taps — same cap as the web chart.
                val top = d.useSeries.sortedByDescending { it.data.sum() }.take(8)
                val series = top.map { s ->
                    ChartSeries(prettySkillName(s.name), s.data.map { it.toFloat() })
                }
                if (series.isEmpty() || series.all { s -> s.values.all { it == 0f } }) {
                    Text("No board activity yet. This lights up as the board gets used.",
                        fontSize = 12.sp, color = Brand.muted,
                        modifier = Modifier.padding(vertical = 10.dp))
                } else {
                    MultiLineChart(series, d.labels, chartHeight = 260.dp)
                }
            }
        }
    }
}

// ── Game accuracy: by category + by game mode ───────────────────────────────

@Composable
private fun AccuracyPage() {
    val c = LocalAppContainer.current
    var data by remember { mutableStateOf<AnalyticsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try { data = c.api.analytics(c.auth.childSlug) }
        catch (e: Exception) { error = "Could not load: ${e.message}" }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        val d = data
        when {
            error != null -> Text(error!!, fontSize = 13.sp, color = Color(0xFFDC2626))
            d == null -> LoadingSpinner("Loading game data…")
            else -> {
                StatCard("Pass rate by category") {
                    val series = d.gameSeries.take(6).map { s ->
                        ChartSeries(prettySkillName(s.name), s.data.map { it.toFloat() })
                    }.filter { s -> s.values.any { it > 0f } }
                    if (series.isEmpty()) {
                        Text("No games scored yet. Accuracy by category lights up here when game data arrives.",
                            fontSize = 12.sp, color = Brand.muted)
                    } else {
                        MultiLineChart(series, d.labels, yMax = 100f)
                    }
                }
                Spacer(Modifier.height(14.dp))
                // Each mode is a qualitatively different measurement — never
                // aggregate matching with expressive naming (PRD §5.1).
                StatCard("Pass rate by game mode") {
                    val series = d.modeSeries.map { s ->
                        ChartSeries(prettySkillName(s.name), s.data.map { it.toFloat() })
                    }.filter { s -> s.values.any { it > 0f } }
                    if (series.isEmpty()) {
                        Text("No matching/slideshow/auditory/expressive sessions yet. Each mode gets its own line here.",
                            fontSize = 12.sp, color = Brand.muted)
                    } else {
                        MultiLineChart(series, d.labels, yMax = 100f, chartHeight = 200.dp)
                    }
                }
            }
        }
    }
}

// ── Mastery bars + recent sessions ──────────────────────────────────────────

@Composable
private fun MasterySessionsPage() {
    val c = LocalAppContainer.current
    var data by remember { mutableStateOf<AnalyticsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try { data = c.api.analytics(c.auth.childSlug) }
        catch (e: Exception) { error = "Could not load: ${e.message}" }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        val d = data
        when {
            error != null -> Text(error!!, fontSize = 13.sp, color = Color(0xFFDC2626))
            d == null -> LoadingSpinner("Loading…")
            else -> {
                StatCard("Mastery · last 30 days") {
                    if (d.mastery.isEmpty()) {
                        Text("No game data yet. Start a game and this fills in.",
                            fontSize = 12.sp, color = Brand.muted)
                    }
                    d.mastery.forEach { r ->
                        Row {
                            Text(prettySkillName(r.name), fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold, color = Brand.ink,
                                modifier = Modifier.weight(1f))
                            Text("${r.pct}%", fontSize = 12.sp, color = Brand.muted)
                        }
                        Spacer(Modifier.height(4.dp))
                        ShareBar(
                            fraction = r.pct / 100f,
                            color = if (r.pct >= 80) hexColor("#10b981") else Brand.pink,
                            height = 10.dp,
                        )
                        Spacer(Modifier.height(10.dp))
                    }
                }
                Spacer(Modifier.height(14.dp))
                StatCard("Recent sessions") {
                    if (d.recentSessions.isEmpty()) {
                        Text("No sessions yet.", fontSize = 12.sp, color = Brand.muted)
                    }
                    d.recentSessions.take(20).forEach { s ->
                        Row(Modifier.padding(vertical = 6.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(s.mode ?: "Game", fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold, color = Brand.ink)
                                Text(listOfNotNull(s.category, s.date).joinToString(" · "),
                                    fontSize = 12.sp, color = Brand.muted)
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(s.result ?: "—", fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold, color = Brand.ink)
                                Text(s.length ?: "", fontSize = 11.sp, color = Brand.muted)
                            }
                        }
                        HorizontalDivider(color = hexColor("#f1e3ec"))
                    }
                }
            }
        }
    }
}

package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.TopWord
import io.andrewpeterson.myworld.net.WordEvent
import io.andrewpeterson.myworld.net.topWords
import io.andrewpeterson.myworld.net.wordHistory
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * Top words + word history — ports of `Parent/TopWordsView.swift` and
 * `Parent/WordHistoryView.swift`. Both live inside the StatsView hub dialog.
 */

// ── Top words ───────────────────────────────────────────────────────────────

@Composable
internal fun TopWordsPage() {
    val c = LocalAppContainer.current
    var days by remember { mutableStateOf(30) }
    var rows by remember { mutableStateOf<List<TopWord>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(days) {
        rows = null; error = null
        try { rows = c.api.topWords(c.auth.childSlug, days = days, limit = 100).rows }
        catch (e: Exception) { error = "Could not load top words: ${e.message}" }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        SegmentedChips(
            listOf("7 days" to 7, "30 days" to 30, "90 days" to 90, "1 year" to 365),
            days,
        ) { days = it }
        Spacer(Modifier.height(14.dp))
        val r = rows
        when {
            error != null -> Text(error!!, fontSize = 13.sp, color = Color(0xFFDC2626))
            r == null -> LoadingSpinner("Loading…")
            r.isEmpty() -> Text(
                "No taps yet in the last $days days. As the child uses the board, words climb to the top here.",
                fontSize = 13.sp, color = Brand.muted,
                modifier = Modifier.padding(vertical = 40.dp),
            )
            else -> StatCard {
                val topCount = r.first().count.coerceAtLeast(1)
                r.forEachIndexed { i, row ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${i + 1}.", fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                            color = Brand.muted, modifier = Modifier.width(30.dp))
                        Column(Modifier.weight(1f)) {
                            Text(row.label, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
                            row.category?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, fontSize = 11.sp, color = Brand.muted)
                            }
                        }
                        Text("${row.count}", fontSize = 16.sp, fontWeight = FontWeight.Bold,
                            color = Brand.pinkDeep)
                    }
                    Spacer(Modifier.height(5.dp))
                    Row {
                        Spacer(Modifier.width(30.dp))
                        ShareBar(fraction = row.count.toFloat() / topCount, color = Brand.pink,
                            height = 6.dp, modifier = Modifier.weight(1f))
                    }
                    if (i < r.size - 1) {
                        Spacer(Modifier.height(8.dp))
                        HorizontalDivider(color = androidx.compose.ui.graphics.Color(0x14000000))
                        Spacer(Modifier.height(8.dp))
                    }
                }
            }
        }
    }
}

// ── Word history (searchable tap log, server pages 200 at a time) ───────────

@Composable
internal fun WordHistoryPage() {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var days by remember { mutableStateOf(30) }
    var rows by remember { mutableStateOf<List<WordEvent>>(emptyList()) }
    var hasMore by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var loadedOnce by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load(append: Boolean) {
        loading = true; error = null
        try {
            val since = Instant.now().minus(days.toLong(), ChronoUnit.DAYS).toString()
            val resp = c.api.wordHistory(
                c.auth.childSlug, query = query.trim(),
                sinceIso = since, untilIso = Instant.now().toString(),
                limit = 200, offset = if (append) rows.size else 0,
            )
            rows = if (append) rows + resp.rows else resp.rows
            hasMore = resp.hasMore
        } catch (e: Exception) { error = "Could not load: ${e.message}" }
        loading = false; loadedOnce = true
    }

    // 350ms debounce so every keystroke isn't a request (iOS parity).
    LaunchedEffect(query, days) {
        delay(350)
        load(append = false)
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        OutlinedTextField(
            value = query, onValueChange = { query = it },
            label = { Text("Search for a word…") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        SegmentedChips(
            listOf("7 days" to 7, "30 days" to 30, "90 days" to 90, "1 year" to 365),
            days,
        ) { days = it }
        Spacer(Modifier.height(14.dp))
        when {
            error != null -> Text(error!!, fontSize = 13.sp, color = Color(0xFFDC2626))
            loadedOnce && rows.isEmpty() -> Text(
                if (query.isEmpty()) "No taps in this window."
                else "No taps matching \"$query\" in this window.",
                fontSize = 13.sp, color = Brand.muted,
                modifier = Modifier.padding(vertical = 40.dp),
            )
            !loadedOnce -> LoadingSpinner("Loading…")
            else -> {
                StatCard {
                    rows.forEachIndexed { i, ev ->
                        Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(ev.label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
                                ev.category?.takeIf { it.isNotEmpty() }?.let {
                                    Text(it, fontSize = 11.sp, color = Brand.muted)
                                }
                            }
                            Text(historyDateText(ev.whenAt), fontSize = 12.sp, color = Brand.muted)
                        }
                        if (i < rows.size - 1) HorizontalDivider(color = androidx.compose.ui.graphics.Color(0x14000000))
                    }
                }
                if (hasMore) {
                    TextButton(
                        onClick = { scope.launch { load(append = true) } },
                        enabled = !loading,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (loading) "Loading…" else "Load more",
                            color = Brand.pinkDeep, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

/** Today → "3:42 PM", earlier → "Jun 12 · 3:42 PM" (iOS parity). */
internal fun historyDateText(iso: String): String = try {
    val instant = Instant.parse(iso)
    val zone = ZoneId.systemDefault()
    val dt = instant.atZone(zone)
    val time = dt.format(DateTimeFormatter.ofPattern("h:mm a"))
    val today = Instant.now().atZone(zone).toLocalDate()
    if (dt.toLocalDate() == today) time
    else dt.format(DateTimeFormatter.ofPattern("MMM d")) + " · " + time
} catch (_: Exception) { iso.take(10) }

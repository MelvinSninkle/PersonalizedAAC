package io.andrewpeterson.myworld.ui.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.PersonalizeAllResult
import io.andrewpeterson.myworld.net.ShopTile
import io.andrewpeterson.myworld.net.storeCatalog
import io.andrewpeterson.myworld.net.storeCheckout
import io.andrewpeterson.myworld.net.storeFreeBoard
import io.andrewpeterson.myworld.net.storePersonalizeAll
import io.andrewpeterson.myworld.storage.ShopCatalogCache
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch

/**
 * The native Word Shop — port of `Parent/WordShopView.swift`: instant shop
 * home with the four section ribbons (People / Nouns-Adjectives-More /
 * Verbs / Core Words), disk-cached catalog behind them, closed-by-default
 * folders, cart → credits checkout, folder bundles (20% off), free common-
 * use boards, and the personalize-every-tile card.
 */
@Composable
fun WordShopView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var tiles by remember { mutableStateOf<List<ShopTile>>(emptyList()) }
    var balance by remember { mutableStateOf<Int?>(null) }
    var cart by remember { mutableStateOf<Set<String>>(emptySet()) }
    var search by remember { mutableStateOf("") }
    var column by remember { mutableStateOf("") }       // "" = shop home
    var busy by remember { mutableStateOf(false) }
    var freeBusy by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var openFolders by remember { mutableStateOf<Set<String>>(emptySet()) }
    var paQuote by remember { mutableStateOf<PersonalizeAllResult?>(null) }
    var paBusy by remember { mutableStateOf(false) }

    suspend fun refreshCatalog() {
        ShopCatalogCache.refresh(context, c.auth.childSlug, c.api)?.let { tiles = it }
    }

    LaunchedEffect(Unit) {
        // 1) Last visit's catalog renders the whole shop instantly.
        ShopCatalogCache.cached(context, c.auth.childSlug)?.let { if (tiles.isEmpty()) tiles = it }
        // 2) Fresh data streams in behind it.
        refreshCatalog()
        if (tiles.isEmpty()) error = "Couldn't load the word library — check the connection."
        balance = try { c.api.storeCatalog().balance } catch (_: Exception) { null }
        paQuote = try { c.api.storePersonalizeAll(c.auth.childSlug, quote = true) } catch (_: Exception) { null }
    }

    fun creditError(e: Exception, prefix: String): String =
        if (e is ApiClient.ApiError.BadStatus && (e.code == 402 || e.body.contains("not_enough_credits")))
            "Not enough credits — add a pack on the Credits & Store screen first."
        else "$prefix: ${e.message}"

    fun checkout(ids: List<String>, bundle: Boolean) {
        if (busy) return
        busy = true; error = null; note = null
        scope.launch {
            try {
                val r = c.api.storeCheckout(c.auth.childSlug, ids, bundle = bundle)
                if (!bundle) cart = emptySet()
                r.balance?.let { balance = it }
                note = r.note ?: "${r.queued} words queued — they render in your child's style over the next few minutes."
                refreshCatalog()
            } catch (e: Exception) { error = creditError(e, "Checkout failed") }
            busy = false
        }
    }

    val query = search.trim().lowercase()
    val shown = tiles.filter { t ->
        val colOk = when (column) {
            "" -> true
            // "other" = the Nouns-Adjectives-and-More ribbon.
            "other" -> t.column != "people" && t.column != "verbs" && t.column != "needs"
            else -> t.column == column
        }
        colOk && (query.isEmpty() || t.label.lowercase().contains(query))
    }
    // Folder groups keyed "column › category"; search opens everything.
    val groups = run {
        val order = mutableListOf<String>()
        val byKey = mutableMapOf<String, MutableList<ShopTile>>()
        for (t in shown) {
            val key = t.category?.let { "${t.column} › $it" } ?: t.column
            if (key !in byKey) { order.add(key); byKey[key] = mutableListOf() }
            byKey[key]!!.add(t)
        }
        order.map { it to (byKey[it] ?: emptyList()) }
    }
    val allOpen = query.isNotEmpty()

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
            // Header: back-or-close + balance.
            Row(
                Modifier.fillMaxWidth().background(Brand.pink).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (column.isEmpty()) "✕" else "‹ Shop home",
                    fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.clickable {
                        if (column.isEmpty()) onDismiss() else { column = ""; search = "" }
                    }.padding(6.dp))
                Spacer(Modifier.width(10.dp))
                Text("Word Shop", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.weight(1f))
                balance?.let { Text("⭐ $it", fontSize = 15.sp, fontWeight = FontWeight.Black, color = Color.White) }
            }

            Box(Modifier.weight(1f)) {
                if (column.isEmpty() && query.isEmpty()) {
                    // ── SHOP HOME: ribbons render instantly, catalog streams in ──
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                        Text("Every image you make is your family's to keep — stored forever, even when you change one.",
                            fontSize = 13.sp, color = Brand.muted)
                        error?.let { Spacer(Modifier.height(6.dp)); Text(it, fontSize = 13.sp, color = Color(0xFFDC2626)) }
                        note?.let { Spacer(Modifier.height(6.dp)); Text(it, fontSize = 13.sp, color = hexColor("#047857"), fontWeight = FontWeight.SemiBold) }
                        Spacer(Modifier.height(10.dp))
                        Text("SHOP BY SECTION", fontSize = 12.sp, fontWeight = FontWeight.Black, color = Brand.pinkDeep)
                        Spacer(Modifier.height(6.dp))
                        SectionRibbon("🧑‍🤝‍🧑", "Shop People") { column = "people" }
                        SectionRibbon("🧸", "Shop Nouns, Adjectives & More") { column = "other" }
                        SectionRibbon("🏃", "Shop Verbs") { column = "verbs" }
                        SectionRibbon("⭐", "Shop Core Words") { column = "needs" }
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(value = search, onValueChange = { search = it },
                            label = { Text("…or search every word") },
                            singleLine = true, modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(12.dp))

                        if (tiles.isEmpty()) {
                            LoadingSpinner("Loading your word library…")
                        } else {
                            // Personalize-every-tile card (server-quoted, 20% off).
                            val q = paQuote
                            if (q?.remaining != null && q.total != null && q.remaining > 0) {
                                Column(
                                    Modifier.fillMaxWidth()
                                        .background(Color.White, RoundedCornerShape(14.dp))
                                        .border(1.dp, hexColor("#f3c6dd"), RoundedCornerShape(14.dp))
                                        .padding(14.dp),
                                ) {
                                    Text("✨ Personalize every tile", fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                                    Text("${q.remaining} of ${q.total} tiles still wear the shared pictures. Finish the whole set in your child's style — 20% off.",
                                        fontSize = 13.sp, color = Brand.muted)
                                    Spacer(Modifier.height(8.dp))
                                    Button(
                                        onClick = {
                                            if (paBusy) return@Button
                                            paBusy = true; error = null; note = null
                                            scope.launch {
                                                try {
                                                    val r = c.api.storePersonalizeAll(c.auth.childSlug, quote = false)
                                                    r.balance?.let { balance = it }
                                                    note = r.note
                                                    paQuote = try { c.api.storePersonalizeAll(c.auth.childSlug, quote = true) } catch (_: Exception) { null }
                                                } catch (e: Exception) { error = creditError(e, "Couldn't start") }
                                                paBusy = false
                                            }
                                        },
                                        enabled = !paBusy,
                                        colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text(if (paBusy) "Queuing…" else "Personalize ${q.remaining} tiles · ⭐${q.cost ?: q.remaining}",
                                            fontWeight = FontWeight.Bold)
                                    }
                                }
                                Spacer(Modifier.height(14.dp))
                            }

                            // Free common-use boards: whole categories, default art.
                            Text("FREE — COMMON USE BOARDS", fontSize = 12.sp,
                                fontWeight = FontWeight.Black, color = hexColor("#047857"))
                            Text("Add whole categories with the shared pictures for free. Remove keeps anything you personalized.",
                                fontSize = 12.sp, color = Brand.muted)
                            Spacer(Modifier.height(6.dp))
                            val freeGroups = run {
                                val order = mutableListOf<String>()
                                val agg = mutableMapOf<String, IntArray>()  // [total, onBoard]
                                val meta = mutableMapOf<String, Pair<String, String>>()
                                for (t in tiles) {
                                    val cat = t.category?.takeIf { it.isNotEmpty() } ?: continue
                                    if (!t.freeBoard) continue   // credits-priced board: not free-addable
                                    val key = "${t.column}|$cat"
                                    if (key !in agg) { order.add(key); agg[key] = intArrayOf(0, 0); meta[key] = t.column to cat }
                                    agg[key]!![0]++
                                    if (t.onBoard) agg[key]!![1]++
                                }
                                order.map { k -> Triple(k, meta[k]!!, agg[k]!!) }
                            }
                            freeGroups.forEach { (key, colCat, counts) ->
                                val (col, cat) = colCat
                                val (total, on) = counts[0] to counts[1]
                                Row(
                                    Modifier.fillMaxWidth()
                                        .background(Color.White, RoundedCornerShape(12.dp))
                                        .border(1.dp, hexColor("#d1fae5"), RoundedCornerShape(12.dp))
                                        .padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(cat, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
                                        Text("$on of $total on the board", fontSize = 11.sp, color = Brand.muted)
                                    }
                                    val turnOn = on < total
                                    TextButton(
                                        onClick = {
                                            if (freeBusy != null) return@TextButton
                                            freeBusy = key; error = null; note = null
                                            scope.launch {
                                                try {
                                                    val r = c.api.storeFreeBoard(c.auth.childSlug, col, cat, turnOn)
                                                    note = r.note
                                                    refreshCatalog()
                                                } catch (e: Exception) { error = "Couldn't update: ${e.message}" }
                                                freeBusy = null
                                            }
                                        },
                                        enabled = freeBusy == null,
                                    ) {
                                        Text(if (freeBusy == key) "…" else if (turnOn) "Add free" else "Remove",
                                            fontSize = 12.sp, fontWeight = FontWeight.Bold,
                                            color = if (turnOn) hexColor("#047857") else Brand.pinkDeep)
                                    }
                                }
                                Spacer(Modifier.height(8.dp))
                            }
                        }
                    }
                } else {
                    // ── INSIDE A SECTION / SEARCH: closed folders + tile grids ──
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
                        item {
                            OutlinedTextField(value = search, onValueChange = { search = it },
                                label = { Text("Search words…") },
                                singleLine = true, modifier = Modifier.fillMaxWidth())
                            error?.let { Text(it, fontSize = 13.sp, color = Color(0xFFDC2626)) }
                            note?.let { Text(it, fontSize = 13.sp, color = hexColor("#047857"), fontWeight = FontWeight.SemiBold) }
                            Spacer(Modifier.height(10.dp))
                        }
                        groups.forEach { (key, groupTiles) ->
                            val isOpen = allOpen || key in openFolders
                            item(key = "hdr-$key") {
                                val inCart = groupTiles.count { it.id in cart }
                                Row(
                                    Modifier.fillMaxWidth()
                                        .background(Color.White, RoundedCornerShape(12.dp))
                                        .border(1.dp, hexColor("#f3c6dd"), RoundedCornerShape(12.dp))
                                        .clickable {
                                            openFolders = if (key in openFolders) openFolders - key else openFolders + key
                                        }
                                        .padding(horizontal = 12.dp, vertical = 11.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(if (isOpen) "▾" else "▸", fontSize = 12.sp, color = hexColor("#d6a8c6"))
                                    Spacer(Modifier.width(8.dp))
                                    Text(key.uppercase(), fontSize = 13.sp, fontWeight = FontWeight.Black,
                                        color = Brand.pinkDeep, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f))
                                    if (inCart > 0) {
                                        Text("$inCart in cart", fontSize = 10.sp, fontWeight = FontWeight.Black,
                                            color = Color.White,
                                            modifier = Modifier.background(Brand.pink, RoundedCornerShape(50))
                                                .padding(horizontal = 7.dp, vertical = 3.dp))
                                        Spacer(Modifier.width(6.dp))
                                    }
                                    Text("${groupTiles.size}", fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                        color = hexColor("#9d2463"),
                                        modifier = Modifier.background(hexColor("#fdf2f8"), RoundedCornerShape(50))
                                            .padding(horizontal = 8.dp, vertical = 3.dp))
                                }
                                Spacer(Modifier.height(8.dp))
                            }
                            if (isOpen) {
                                // Bundle: whole folder at once, 20% off (≥3 words).
                                val unpersonalized = groupTiles.filter { !it.personalized }
                                if (unpersonalized.size >= 3) {
                                    item(key = "bundle-$key") {
                                        val cost = maxOf(1, kotlin.math.ceil(unpersonalized.size * 0.8).toInt())
                                        TextButton(
                                            onClick = { checkout(unpersonalized.map { it.id }, bundle = true) },
                                            enabled = !busy,
                                            modifier = Modifier.fillMaxWidth()
                                                .background(hexColor("#fce4ef"), RoundedCornerShape(50)),
                                        ) {
                                            Text(if (busy) "…" else "✨ Personalize all ${unpersonalized.size} · ⭐$cost (20% off)",
                                                fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                                        }
                                        Spacer(Modifier.height(8.dp))
                                    }
                                }
                                item(key = "grid-$key") {
                                    ShopTileGrid(groupTiles, cart) { id ->
                                        cart = if (id in cart) cart - id else cart + id
                                    }
                                    Spacer(Modifier.height(12.dp))
                                }
                            }
                        }
                        if (tiles.isEmpty()) item { LoadingSpinner("Loading…") }
                    }
                }
            }

            // ── Cart bar ───────────────────────────────────────────────
            if (cart.isNotEmpty()) {
                Row(
                    Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${cart.size} word${if (cart.size == 1) "" else "s"} · ⭐${cart.size}",
                        fontSize = 14.sp, fontWeight = FontWeight.Black, color = Brand.pinkDeep,
                        modifier = Modifier.weight(1f))
                    TextButton(onClick = { cart = emptySet() }) { Text("Clear", fontSize = 13.sp) }
                    Button(
                        onClick = { checkout(cart.toList(), bundle = false) },
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                    ) { Text(if (busy) "…" else "Get these words", fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

@Composable
private fun SectionRibbon(emoji: String, title: String, onTap: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .background(Color.White, RoundedCornerShape(14.dp))
            .border(1.dp, hexColor("#f3c6dd"), RoundedCornerShape(14.dp))
            .clickable(onClick = onTap)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(emoji, fontSize = 26.sp)
        Spacer(Modifier.width(12.dp))
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep,
            modifier = Modifier.weight(1f))
        Text("›", fontSize = 18.sp, color = hexColor("#d6a8c6"))
    }
    Spacer(Modifier.height(8.dp))
}

/** Fixed-height grid of word thumbnails with cart selection + yours badge. */
@Composable
private fun ShopTileGrid(tiles: List<ShopTile>, cart: Set<String>, onToggle: (String) -> Unit) {
    // A LazyVerticalGrid inside LazyColumn needs a bounded height: rows of 3.
    val cols = 3
    val rows = tiles.chunked(cols)
    Column {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                row.forEach { t ->
                    val selected = t.id in cart
                    Column(
                        Modifier.weight(1f).clickable { onToggle(t.id) },
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(
                            Modifier.fillMaxWidth().height(86.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(hexColor("#fdf2f8"))
                                .border(if (selected) 3.dp else 1.dp,
                                    if (selected) Brand.pink else hexColor("#f3c6dd"),
                                    RoundedCornerShape(12.dp)),
                        ) {
                            if (!t.previewKey.isNullOrEmpty()) {
                                BlobImage(t.previewKey, Modifier.fillMaxSize(), maxDim = 256)
                            } else {
                                Text(t.label, fontSize = 13.sp, fontWeight = FontWeight.Black,
                                    color = hexColor("#9d2463"),
                                    modifier = Modifier.align(Alignment.Center).padding(4.dp))
                            }
                            if (selected) {
                                Text("✓", fontSize = 13.sp, fontWeight = FontWeight.Black, color = Color.White,
                                    modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)
                                        .background(Brand.pink, RoundedCornerShape(50))
                                        .padding(horizontal = 6.dp, vertical = 1.dp))
                            } else if (t.personalized) {
                                Text("yours", fontSize = 8.sp, fontWeight = FontWeight.Black,
                                    color = hexColor("#047857"),
                                    modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)
                                        .background(hexColor("#ecfdf5"), RoundedCornerShape(50))
                                        .padding(horizontal = 5.dp, vertical = 2.dp))
                            }
                        }
                        Text(t.label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                            color = Brand.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

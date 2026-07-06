package io.andrewpeterson.myworld.ui.parent

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.AlbumEntry
import io.andrewpeterson.myworld.net.AlbumTile
import io.andrewpeterson.myworld.net.albumByTile
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Memorabilia album — port of `Parent/AlbumView.swift`:
 * Album → folder (People / Words / Verbs / Celebrations) → tile → every
 * version newest-first, tappable for a big look. Old art is kept forever.
 */

private enum class AlbumFolder(val title: String, val emoji: String) {
    PEOPLE("People", "🧑‍🤝‍🧑"),
    WORDS("Words", "🏷"),
    VERBS("Verbs", "🏃"),
    CELEBRATIONS("Celebrations", "✨");

    fun matches(section: String?): Boolean {
        val s = (section ?: "").lowercase()
        return when (this) {
            PEOPLE -> s == "people"
            WORDS -> s == "nouns" || s == "needs" || s.isEmpty()   // unfiled lands here
            VERBS -> s == "verbs"
            CELEBRATIONS -> s == "events"
        }
    }
}

/** Small blob-key → bitmap image, shared by the parent screens. */
@Composable
fun BlobImage(blobKey: String?, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    val c = LocalAppContainer.current
    val bmp by produceState<Bitmap?>(initialValue = null, blobKey) {
        value = if (blobKey.isNullOrEmpty()) null
        else kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { c.media.bitmap(blobKey) }
    }
    val b = bmp
    if (b != null) {
        Image(b.asImageBitmap(), contentDescription = null, contentScale = contentScale, modifier = modifier)
    } else {
        Box(modifier.background(hexColor("#fce4ec")))
    }
}

@Composable
fun AlbumView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    var tiles by remember { mutableStateOf<List<AlbumTile>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var openFolder by remember { mutableStateOf<AlbumFolder?>(null) }
    var openTile by remember { mutableStateOf<AlbumTile?>(null) }
    var zoomed by remember { mutableStateOf<AlbumEntry?>(null) }

    LaunchedEffect(Unit) {
        try { tiles = c.api.albumByTile(c.auth.childSlug, limit = 600) }
        catch (e: Exception) { error = "Could not load the album: ${e.message}" }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
            Row(
                Modifier.fillMaxWidth().background(Brand.pink).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    when {
                        zoomed != null || openTile != null -> "‹ Back"
                        openFolder != null -> "‹ Back"
                        else -> "✕"
                    },
                    fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.clickable {
                        when {
                            zoomed != null -> zoomed = null
                            openTile != null -> openTile = null
                            openFolder != null -> openFolder = null
                            else -> onDismiss()
                        }
                    }.padding(6.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    openTile?.label ?: openFolder?.title ?: "Album",
                    fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White,
                )
            }

            val t = tiles
            when {
                error != null -> Text(error!!, fontSize = 13.sp, color = Color(0xFFDC2626),
                    modifier = Modifier.padding(16.dp))
                t == null -> LoadingSpinner("Loading…")
                t.isEmpty() -> Text(
                    "No pictures yet. As tiles get new art, the old versions are kept here forever.",
                    fontSize = 13.sp, color = Brand.muted, modifier = Modifier.padding(24.dp),
                )
                openTile != null -> TileVersionsGrid(openTile!!) { zoomed = it }
                openFolder != null -> FolderTileList(
                    t.filter { openFolder!!.matches(it.section) },
                ) { openTile = it }
                else -> FolderList(t) { openFolder = it }
            }
        }
    }

    zoomed?.let { e ->
        Dialog(onDismissRequest = { zoomed = null }) {
            Column(
                Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(24.dp)).padding(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BlobImage(e.blobKey, Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(20.dp)),
                    contentScale = ContentScale.Fit)
                Spacer(Modifier.height(10.dp))
                Text(openTile?.label ?: "", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                Text(albumDate(e.whenAt), fontSize = 13.sp, color = Brand.muted)
            }
        }
    }
}

@Composable
private fun FolderList(tiles: List<AlbumTile>, onOpen: (AlbumFolder) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        AlbumFolder.entries.forEach { folder ->
            val inFolder = tiles.filter { folder.matches(it.section) }
            if (inFolder.isEmpty()) return@forEach
            val pictures = inFolder.sumOf { 1 + it.history.size }
            Row(
                Modifier.fillMaxWidth()
                    .background(Color.White, RoundedCornerShape(18.dp))
                    .border(1.dp, hexColor("#f3c6da"), RoundedCornerShape(18.dp))
                    .clickable { onOpen(folder) }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Cover: the newest tile's art (the iOS fan collapses to one here).
                val cover = inFolder.firstOrNull()?.let { it.current?.blobKey ?: it.history.firstOrNull()?.blobKey }
                if (cover != null) {
                    BlobImage(cover, Modifier.size(60.dp).clip(RoundedCornerShape(10.dp)))
                } else {
                    Box(Modifier.size(60.dp).background(hexColor("#fce4ec"), RoundedCornerShape(10.dp)),
                        contentAlignment = Alignment.Center) { Text(folder.emoji, fontSize = 24.sp) }
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(folder.title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
                    Text("${inFolder.size} tile${if (inFolder.size == 1) "" else "s"} · " +
                        "$pictures picture${if (pictures == 1) "" else "s"}",
                        fontSize = 12.sp, color = Brand.muted)
                }
                Text("›", fontSize = 20.sp, color = Brand.muted)
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun FolderTileList(tiles: List<AlbumTile>, onOpen: (AlbumTile) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        tiles.forEach { tile ->
            Row(
                Modifier.fillMaxWidth()
                    .background(Color.White, RoundedCornerShape(14.dp))
                    .border(1.dp, hexColor("#f3c6da"), RoundedCornerShape(14.dp))
                    .clickable { onOpen(tile) }
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val key = tile.current?.blobKey ?: tile.history.firstOrNull()?.blobKey
                BlobImage(key, Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(tile.label ?: "Untitled", fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold, color = Brand.ink)
                    val total = 1 + tile.history.size
                    Text("$total picture${if (total == 1) "" else "s"}", fontSize = 12.sp, color = Brand.muted)
                }
                Text("›", fontSize = 18.sp, color = Brand.muted)
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

@Composable
private fun TileVersionsGrid(tile: AlbumTile, onZoom: (AlbumEntry) -> Unit) {
    val entries = buildList {
        tile.current?.let { add(it to true) }
        tile.history.forEach { add(it to false) }
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 110.dp),
        modifier = Modifier.fillMaxSize().padding(12.dp),
    ) {
        items(entries, key = { it.first.blobKey + (it.first.whenAt ?: "") }) { (e, isCurrent) ->
            Column(Modifier.padding(4.dp).clickable { onZoom(e) }) {
                Box {
                    BlobImage(e.blobKey, Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp)))
                    if (isCurrent) {
                        Text("Current", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color.White,
                            modifier = Modifier.align(Alignment.TopEnd).padding(6.dp)
                                .background(hexColor("#16a34a"), RoundedCornerShape(50))
                                .padding(horizontal = 6.dp, vertical = 2.dp))
                    }
                }
                Text(albumDate(e.whenAt), fontSize = 9.sp, color = Brand.muted)
            }
        }
    }
}

private fun albumDate(iso: String?): String = try {
    if (iso == null) "" else Instant.parse(iso).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("MMM d, yyyy"))
} catch (_: Exception) { "" }

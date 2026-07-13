package io.andrewpeterson.myworld.ui.board

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.Category
import io.andrewpeterson.myworld.model.display
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Horizontal chip strips — ports of `Views/CategoryStrips.swift`. Chips always
 * center-crop square (guillotine, no exceptions). Transparent backgrounds so
 * the section band color shows through.
 */
@Composable
fun CategoryTabStrip(
    categories: List<Category>,
    selectedId: Int?,
    hideLabels: Boolean,
    paged: Boolean = false,
    onChipBounds: ((Int, Rect) -> Unit)? = null,
    onSelect: (Int) -> Unit,
) {
    if (paged) {
        PagedChipRow(categories, chipSide = 64.dp, rowHeight = if (hideLabels) 80.dp else 96.dp) { cat ->
            CategoryChip(cat, selected = selectedId == cat.id, compact = false,
                hideLabel = hideLabels, onBounds = null) { onSelect(cat.id) }
        }
        return
    }
    Row(
        Modifier.horizontalScroll(rememberScrollState())
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        categories.forEach { cat ->
            CategoryChip(cat, selected = selectedId == cat.id, compact = false,
                hideLabel = hideLabels,
                onBounds = onChipBounds?.let { report -> { r -> report(cat.id, r) } }) { onSelect(cat.id) }
            androidx.compose.foundation.layout.Spacer(Modifier.width(8.dp))
        }
    }
}

/**
 * Paged chip row for button-navigation mode: only whole chips per page (the
 * chip that would have been cut off leads the next page), with ◀ ▶ paddles
 * sized for imprecise pointing. Port of the iOS PagedChipRow.
 */
@Composable
fun PagedChipRow(
    items: List<Category>,
    chipSide: Dp,
    rowHeight: Dp,
    chip: @Composable (Category) -> Unit,
) {
    var page by remember { mutableStateOf(0) }
    BoxWithConstraints(Modifier.fillMaxWidth().height(rowHeight)) {
        val per = maxOf(1, ((maxWidth - 100.dp).value / (chipSide.value + 8f)).toInt())
        val pageCount = maxOf(1, (items.size + per - 1) / per)
        val p = minOf(page, pageCount - 1)
        val slice = items.drop(p * per).take(per)
        Row(
            Modifier.fillMaxSize().padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StripPaddle("◀", enabled = p > 0, visible = pageCount > 1) { page = maxOf(0, p - 1) }
            Spacer(Modifier.width(6.dp))
            slice.forEach { item ->
                chip(item)
                Spacer(Modifier.width(8.dp))
            }
            Spacer(Modifier.weight(1f))
            StripPaddle("▶", enabled = p < pageCount - 1, visible = pageCount > 1) { page = minOf(pageCount - 1, p + 1) }
        }
    }
}

/** Inline chip-strip paddle (40×56, high contrast) for paged navigation. */
@Composable
private fun StripPaddle(glyph: String, enabled: Boolean, visible: Boolean, onTap: () -> Unit) {
    if (!visible) return
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier.size(width = 40.dp, height = 56.dp)
            .background(Color.White.copy(alpha = if (enabled) 1f else 0.4f), shape)
            .border(2.dp, Color(0xFFC9D5E8), shape)
            .then(if (enabled) Modifier.clickable(onClick = onTap) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(glyph, fontSize = 16.sp, fontWeight = FontWeight.Bold,
            color = Color(0xFF2B3A55).copy(alpha = if (enabled) 1f else 0.35f))
    }
}

@Composable
fun SubcategoryStrip(
    subcategories: List<Category>,
    selectedId: Int?,
    hideLabels: Boolean,
    paged: Boolean = false,
    onChipBounds: ((Int, Rect) -> Unit)? = null,
    onSelect: (Int) -> Unit,
) {
    if (paged) {
        PagedChipRow(subcategories, chipSide = 50.dp, rowHeight = 64.dp) { sub ->
            CategoryChip(sub, selected = selectedId == sub.id, compact = true,
                hideLabel = hideLabels, onBounds = null) { onSelect(sub.id) }
        }
        return
    }
    Row(
        Modifier.horizontalScroll(rememberScrollState())
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        subcategories.forEach { sub ->
            CategoryChip(sub, selected = selectedId == sub.id, compact = true,
                hideLabel = hideLabels,
                onBounds = onChipBounds?.let { report -> { r -> report(sub.id, r) } }) { onSelect(sub.id) }
            androidx.compose.foundation.layout.Spacer(Modifier.width(6.dp))
        }
    }
}

@Composable
fun CategoryChip(
    category: Category,
    selected: Boolean,
    compact: Boolean,
    hideLabel: Boolean,
    onBounds: ((Rect) -> Unit)? = null,
    onTap: () -> Unit,
) {
    val c = LocalAppContainer.current
    val side = if (compact) 50.dp else 64.dp

    val image by produceState<Bitmap?>(initialValue = null, category.imageKey) {
        val key = category.imageKey
        value = if (key.isNullOrEmpty()) null else withContext(Dispatchers.Default) {
            c.media.bitmap(key, maxDim = 320)
        }
    }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(side)
                .then(if (onBounds != null)
                    Modifier.onGloballyPositioned { onBounds(it.boundsInRoot()) }
                else Modifier)
                .clip(RoundedCornerShape(12.dp))
                .background(Color.White)
                .border(
                    width = if (selected) 3.dp else 1.dp,
                    color = if (selected) Brand.pink else Color.Black.copy(alpha = 0.08f),
                    shape = RoundedCornerShape(12.dp),
                )
                .clickable(onClick = onTap),
            contentAlignment = Alignment.Center,
        ) {
            val img = image
            if (img != null) {
                Image(img.asImageBitmap(), contentDescription = category.label,
                    contentScale = ContentScale.Crop,   // guillotine: no exceptions on chips
                    modifier = Modifier.fillMaxSize())
            } else {
                Text("📁", fontSize = 20.sp)
            }
        }
        if (!compact && !hideLabel) {
            Text(category.display, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                color = Brand.ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.width(side))
        }
    }
}

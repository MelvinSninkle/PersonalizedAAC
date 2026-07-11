package io.andrewpeterson.myworld.ui.board

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
    onChipBounds: ((Int, Rect) -> Unit)? = null,
    onSelect: (Int) -> Unit,
) {
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

@Composable
fun SubcategoryStrip(
    subcategories: List<Category>,
    selectedId: Int?,
    hideLabels: Boolean,
    onChipBounds: ((Int, Rect) -> Unit)? = null,
    onSelect: (Int) -> Unit,
) {
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
            c.media.bitmap(key, maxDim = 320)?.trimmingFlatBorders()
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

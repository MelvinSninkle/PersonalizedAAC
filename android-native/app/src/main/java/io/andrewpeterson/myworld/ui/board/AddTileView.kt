package io.andrewpeterson.myworld.ui.board

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.storage.downscaleJpeg
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The add-a-tile flow — port of `Views/AddTileView.swift`'s single-photo
 * magic path: pick/take a photo → name + hint + "use my photo as-is"
 * (free-tier locks to as-is with the membership note) → durable server job.
 * Bulk import + review arrive with BatchReviewView.
 */
@Composable
fun AddTileView(
    defaultSection: BoardSection,
    defaultCategoryId: Int?,
    onDone: () -> Unit,
) {
    val c = LocalAppContainer.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var jpeg by remember { mutableStateOf<ByteArray?>(null) }
    var name by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf("") }
    var useAsIs by remember { mutableStateOf(!c.board.stylingAllowed) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val stylingAllowed = c.board.stylingAllowed

    val pickImage = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            jpeg = withContext(Dispatchers.IO) {
                try {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?.let { downscaleJpeg(it) }
                } catch (_: Exception) { null }
            }
        }
    }

    fun submit() {
        val bytes = jpeg ?: return
        if (busy) return
        busy = true; error = null
        scope.launch {
            val id = c.addTileQueue.enqueue(
                childId = c.auth.childSlug,
                jpeg = bytes,
                label = name.trim(),
                detail = detail.trim(),
                section = defaultSection.raw,
                categoryId = defaultCategoryId,
                raw = useAsIs,
            )
            busy = false
            if (id != null) onDone()
            else error = "Couldn't upload the photo — check the connection and try again. " +
                "(If you're on the Free plan, check \"Use my photo as-is\".)"
        }
    }

    Dialog(onDismissRequest = onDone, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxWidth(0.94f)
                .background(Color.White, RoundedCornerShape(24.dp))
                .padding(22.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text("Make a tile", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Text("Goes to: ${defaultSection.displayLabel}", fontSize = 13.sp, color = Brand.muted)
            Spacer(Modifier.height(12.dp))

            val img = jpeg?.let {
                remember(it) {
                    android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size)
                }
            }
            if (img != null) {
                Image(img.asImageBitmap(), contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp))
                Spacer(Modifier.height(10.dp))
            }
            Button(
                onClick = {
                    pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
                colors = ButtonDefaults.buttonColors(containerColor = hexColor("#fce4ec"), contentColor = Brand.pinkDeep),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (jpeg == null) "📷 Choose a photo" else "Choose a different photo", fontWeight = FontWeight.Bold) }

            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = name, onValueChange = { name = it },
                label = { Text("Name (optional — we can name it)") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = detail, onValueChange = { detail = it },
                label = { Text("Anything we should know? (optional)") },
                placeholder = { Text("e.g. \"This is Grandma Sue\" or \"the red cup\"") },
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Use my photo as-is", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
                    Text("No restyle — the photo itself becomes the tile. Free.",
                        fontSize = 12.sp, color = Brand.muted)
                }
                Switch(checked = useAsIs, onCheckedChange = { if (stylingAllowed) useAsIs = it },
                    enabled = stylingAllowed,
                    colors = SwitchDefaults.colors(checkedTrackColor = Brand.pink))
            }
            if (!stylingAllowed) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "✨ Want this drawn in your child's art style? Styled tiles are part of My World memberships, from $4.99/month — join under Credits & Store. Everything you've already made is yours forever.",
                    fontSize = 12.sp, color = Brand.pinkDeep,
                    modifier = Modifier.background(hexColor("#fce4ec"), RoundedCornerShape(12.dp)).padding(12.dp),
                )
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 13.sp, color = Color(0xFFDC2626))
            }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { submit() },
                enabled = jpeg != null && !busy,
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                Text(
                    when {
                        busy -> "Uploading…"
                        useAsIs -> "Add photo"
                        else -> "Generate tile"
                    },
                    fontSize = 16.sp, fontWeight = FontWeight.Bold,
                )
            }
            TextButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
                Text("Cancel", color = Brand.muted)
            }
        }
    }
}

package io.andrewpeterson.myworld.ui.parent

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.Person
import io.andrewpeterson.myworld.net.createTileJob
import io.andrewpeterson.myworld.net.deletePerson
import io.andrewpeterson.myworld.net.listPersons
import io.andrewpeterson.myworld.net.upsertPerson
import io.andrewpeterson.myworld.storage.downscaleJpeg
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Family & people — port of `Parent/ParentHomeView.swift`'s PeopleManagerView.
 * The reference faces that anchor every tile about each person. Adding a
 * person runs the durable server pipeline (section=people): style-consistent
 * portrait, person registration, tile on the board.
 */

private val RELATIONSHIP_OPTIONS = listOf(
    "mother" to "Mother", "father" to "Father", "sister" to "Sister", "brother" to "Brother",
    "grandmother" to "Grandmother", "grandfather" to "Grandfather", "aunt" to "Aunt", "uncle" to "Uncle",
    "stepmother" to "Stepmother", "stepfather" to "Stepfather", "guardian" to "Guardian",
    "family_friend" to "Family friend", "caregiver" to "Caregiver", "other" to "Other",
)

fun relationshipLabel(value: String?): String = when (value) {
    "mother" -> "Mother"; "father" -> "Father"; "sister" -> "Sister"; "brother" -> "Brother"
    "grandmother" -> "Grandmother"; "grandfather" -> "Grandfather"; "aunt" -> "Aunt"; "uncle" -> "Uncle"
    "cousin" -> "Cousin"; "stepmother" -> "Stepmother"; "stepfather" -> "Stepfather"
    "guardian" -> "Guardian"; "family_friend" -> "Family friend"; "caregiver" -> "Caregiver"
    "pet" -> "Pet"; "self" -> "The child"
    else -> if (value.isNullOrEmpty()) "Other" else value.replaceFirstChar { it.uppercase() }
}

private data class PersonDraft(
    val personId: Int? = null,
    val name: String = "",
    val relationship: String = "mother",
    val isSelf: Boolean = false,
    val referenceKey: String? = null,
)

@Composable
fun PeopleManagerView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    var persons by remember { mutableStateOf<List<Person>?>(null) }
    var editing by remember { mutableStateOf<PersonDraft?>(null) }

    suspend fun load() {
        persons = try { c.api.listPersons(c.auth.childSlug) } catch (_: Exception) { emptyList() }
    }
    LaunchedEffect(Unit) { load() }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
            Row(
                Modifier.fillMaxWidth().background(Brand.pink).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("✕", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.clickable { onDismiss() }.padding(6.dp))
                Spacer(Modifier.width(10.dp))
                Text("Family & people", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
            }

            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                Text(
                    "These faces anchor every tile about each person: feelings, actions, body parts, social phrases. Add a clear head-and-shoulders photo of each one.",
                    fontSize = 13.sp, color = Brand.muted,
                )
                Spacer(Modifier.height(12.dp))

                val p = persons
                if (p == null) {
                    LoadingSpinner("Loading…")
                } else {
                    // Interrupted onboarding: no child registered yet.
                    if (p.none { it.isSelf }) {
                        Button(
                            onClick = { editing = PersonDraft(isSelf = true, relationship = "self") },
                            colors = ButtonDefaults.buttonColors(containerColor = Brand.pinkDeep),
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) { Text("🧒 Add your child", fontWeight = FontWeight.Bold) }
                        Spacer(Modifier.height(10.dp))
                    }
                    p.forEach { person ->
                        Row(
                            Modifier.fillMaxWidth()
                                .background(Color.White, RoundedCornerShape(14.dp))
                                .border(1.dp, hexColor("#f3c6da"), RoundedCornerShape(14.dp))
                                .clickable {
                                    editing = PersonDraft(
                                        personId = person.id, name = person.displayName,
                                        relationship = person.relationship ?: "other",
                                        isSelf = person.isSelf, referenceKey = person.reference_key,
                                    )
                                }
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (!person.reference_key.isNullOrEmpty()) {
                                BlobImage(person.reference_key, Modifier.size(56.dp).clip(CircleShape))
                            } else {
                                Box(Modifier.size(56.dp).background(hexColor("#fce4ec"), CircleShape),
                                    contentAlignment = Alignment.Center) { Text("🙂", fontSize = 24.sp) }
                            }
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text(person.displayName, fontSize = 16.sp,
                                    fontWeight = FontWeight.SemiBold, color = Brand.ink)
                                Text(if (person.isSelf) "The child" else relationshipLabel(person.relationship),
                                    fontSize = 12.sp, color = Brand.muted)
                            }
                            if (person.reference_key.isNullOrEmpty()) {
                                Text("No photo", fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                                    color = hexColor("#b91c6b"))
                            }
                            Text(" ›", fontSize = 18.sp, color = Brand.muted)
                        }
                        Spacer(Modifier.height(10.dp))
                    }
                    Button(
                        onClick = { editing = PersonDraft() },
                        colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text("＋ Add a person", fontWeight = FontWeight.Bold) }
                }
            }
        }
    }

    editing?.let { draft ->
        PersonEditorDialog(draft) {
            editing = null
            // The cached child name refreshes on the next displayPrefs.attach;
            // reload people + board now so the new tile appears immediately.
            scope.launch { load(); c.board.refresh(c.auth.childSlug) }
        }
    }
}

/**
 * Add or edit one person: name, relationship, and a photo that becomes their
 * style-consistent portrait + tile via the durable pipeline. No model is sent
 * on purpose — the server routes people through the keystone-portrait chain.
 */
@Composable
private fun PersonEditorDialog(draft: PersonDraft, onDone: () -> Unit) {
    val c = LocalAppContainer.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var name by remember { mutableStateOf(draft.name) }
    var relationship by remember { mutableStateOf(if (draft.isSelf) "self" else draft.relationship) }
    var jpeg by remember { mutableStateOf<ByteArray?>(null) }
    var relMenuOpen by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val isNew = draft.personId == null
    // The same keep-vs-restyle ask every image add gets. Default OFF =
    // portrait drawn in the board's art style; free tier locked to as-is.
    val stylingAllowed = c.board.stylingAllowed
    var useAsIs by remember { mutableStateOf(!stylingAllowed) }
    var confirmPortrait by remember { mutableStateOf(false) }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
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

    fun save() {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || saving) return
        saving = true; error = null
        scope.launch {
            try {
                // 1) Structured fields first so the person exists immediately.
                c.api.upsertPerson(draft.personId, trimmed,
                    if (draft.isSelf) "self" else relationship, c.auth.childSlug)
                // 2) New photo → durable pipeline (portrait + tile + reference).
                jpeg?.let { bytes ->
                    c.api.createTileJob(
                        childId = c.auth.childSlug, jpeg = bytes, label = trimmed,
                        detail = "", section = "people", categoryId = null, raw = useAsIs,
                        relationship = if (draft.isSelf) null else relationship,
                    )
                }
                onDone()
            } catch (e: Exception) {
                error = when {
                    e is ApiClient.ApiError.BadStatus &&
                        (e.code == 402 || e.body.contains("not_enough_credits")) ->
                        "You're out of image credits. Open Credits & Store to add more."
                    e is ApiClient.ApiError.BadStatus && e.body.contains("needs_subscription") ->
                        "Adding styled people is part of My World memberships, from $9.99/month. Join under Credits & Store."
                    else -> "Couldn't save: ${e.message}"
                }
            } finally { saving = false }
        }
    }

    Dialog(onDismissRequest = onDone, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxWidth(0.94f)
                .background(Color.White, RoundedCornerShape(24.dp))
                .padding(22.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(if (isNew) "Add a person" else "Edit person",
                fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(14.dp))

            // Photo circle: fresh capture > existing reference > placeholder.
            val bmp = jpeg?.let { remember(it) { android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size) } }
            if (bmp != null) {
                Image(bmp.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop,
                    modifier = Modifier.size(140.dp).clip(CircleShape))
            } else if (!draft.referenceKey.isNullOrEmpty()) {
                BlobImage(draft.referenceKey, Modifier.size(140.dp).clip(CircleShape))
            } else {
                Box(Modifier.size(140.dp).background(hexColor("#fce4ec"), CircleShape),
                    contentAlignment = Alignment.Center) { Text("🙂", fontSize = 48.sp) }
            }
            TextButton(onClick = {
                pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }) {
                Text(if (jpeg == null) "📷 Choose a photo" else "Choose a different photo",
                    color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
            }
            Text(
                if (isNew) "A clear head-and-shoulders photo works best. Only upload someone who's given you permission. It's used solely to draw their tile."
                else "Pick a new photo to replace their portrait, or leave it.",
                fontSize = 12.sp, color = Brand.muted,
            )

            if (jpeg != null) {
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Use my photo as-is", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
                        Text(if (useAsIs) "The photo itself becomes the tile. Free."
                             else "Drawn as a portrait in the board's art style, ⭐5.",
                            fontSize = 12.sp, color = Brand.muted)
                    }
                    Switch(checked = useAsIs, onCheckedChange = { if (stylingAllowed) useAsIs = it },
                        enabled = stylingAllowed,
                        colors = SwitchDefaults.colors(checkedTrackColor = Brand.pink))
                }
                if (!stylingAllowed) {
                    Text("Styled portraits are part of My World memberships. The exact photo (free) is used on the free plan.",
                        fontSize = 12.sp, color = Brand.pinkDeep)
                }
            }

            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = name, onValueChange = { name = it },
                label = { Text("Name: e.g. Grandma Jane, Dr. Lee") },
                singleLine = true, modifier = Modifier.fillMaxWidth())

            if (!draft.isSelf) {
                Spacer(Modifier.height(10.dp))
                Box(Modifier.fillMaxWidth()) {
                    TextButton(onClick = { relMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("Relationship: ${relationshipLabel(relationship)}  ▾", color = Brand.ink)
                    }
                    DropdownMenu(expanded = relMenuOpen, onDismissRequest = { relMenuOpen = false }) {
                        RELATIONSHIP_OPTIONS.forEach { (value, label) ->
                            DropdownMenuItem(text = { Text(label) },
                                onClick = { relationship = value; relMenuOpen = false })
                        }
                    }
                }
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 13.sp, color = Color(0xFFDC2626))
            }

            Spacer(Modifier.height(14.dp))
            Button(
                // Confirm-before-spend: a styled family portrait is the ⭐5
                // keystone render; the as-is path stays free.
                onClick = { if (jpeg != null && !useAsIs) confirmPortrait = true else save() },
                enabled = name.isNotBlank() && !(isNew && jpeg == null) && !saving,
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text(if (saving) "Saving…" else "Save", fontWeight = FontWeight.Bold) }
            if (confirmPortrait) {
                androidx.compose.material3.AlertDialog(
                    onDismissRequest = { confirmPortrait = false },
                    title = { Text("Use ⭐5?") },
                    text = { Text("A family portrait drawn in the board's style uses ⭐5 (our best likeness model). “Use my photo as-is” is free.") },
                    confirmButton = { TextButton(onClick = { confirmPortrait = false; save() }) { Text("OK") } },
                    dismissButton = { TextButton(onClick = { confirmPortrait = false }) { Text("Cancel") } },
                )
            }

            if (!isNew) {
                TextButton(onClick = {
                    scope.launch {
                        draft.personId?.let { c.api.deletePerson(it, c.auth.childSlug) }
                        onDone()
                    }
                }, modifier = Modifier.fillMaxWidth()) {
                    Text("Remove this person", color = Color(0xFFDC2626))
                }
            }
            TextButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
                Text("Cancel", color = Brand.muted)
            }
        }
    }
}

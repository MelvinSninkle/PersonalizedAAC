package io.andrewpeterson.myworld.ui.onboarding

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.OnboardingCoordinator.Step
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.OnboardingStyle
import io.andrewpeterson.myworld.net.OnboardingVoice
import io.andrewpeterson.myworld.net.onboardingChild
import io.andrewpeterson.myworld.net.onboardingComplete
import io.andrewpeterson.myworld.net.onboardingPhotoCommit
import io.andrewpeterson.myworld.net.onboardingPhotoDraft
import io.andrewpeterson.myworld.net.onboardingPhotoRetry
import io.andrewpeterson.myworld.net.onboardingSeedCore
import io.andrewpeterson.myworld.net.onboardingStyleImage
import io.andrewpeterson.myworld.net.onboardingStyles
import io.andrewpeterson.myworld.net.onboardingVoices
import io.andrewpeterson.myworld.net.registerAccount
import io.andrewpeterson.myworld.storage.downscaleJpeg
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The whole onboarding flow — port of `Parent/OnboardingFlow.swift`, minus
 * the Apple sign-in (email/password only on Android): Demo → Account →
 * Child → Child photo → Parent photo (repeatable) → Seed Core → Done.
 */
@Composable
fun OnboardingFlow() {
    val c = LocalAppContainer.current
    val step by c.onboarding.step.collectAsState()

    // A signed-in parent resuming onboarding picks up the server's cursor.
    LaunchedEffect(Unit) {
        if (c.auth.isSignedIn && c.onboarding.needsOnboarding.value) {
            c.onboarding.resumeIfPossible()
        }
    }

    Column(Modifier.fillMaxSize().background(hexColor("#fff7fb"))) {
        when (step) {
            Step.DEMO -> DemoStep()
            Step.ACCOUNT -> AccountStep()
            Step.CHILD -> ChildStep()
            Step.CHILD_PHOTO -> PhotoStep(isChild = true)
            Step.PARENT_PHOTO -> PhotoStep(isChild = false)
            Step.SEED_CORE -> SeedStep()
            Step.COMPLETE -> DoneStep()
        }
    }
}

private val Modifier.stepPadding: Modifier
    get() = this.fillMaxSize().padding(20.dp)

// ── Shared chrome ───────────────────────────────────────────────────────────

@Composable
private fun BrandBar() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("🌍", fontSize = 30.sp)
        Spacer(Modifier.width(10.dp))
        Column {
            Text("My World", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Brand.pink)
            Text("Tap to Talk", fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                color = Brand.pinkDeep.copy(alpha = 0.8f))
        }
    }
}

@Composable
private fun StepHeader(eyebrow: String, title: String, subtitle: String?) {
    Column {
        Text(eyebrow.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Brand.pink)
        Text(title, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
        subtitle?.let { Text(it, fontSize = 14.sp, color = Brand.muted) }
    }
}

@Composable
private fun PrimaryButton(title: String, busy: Boolean = false, enabled: Boolean = true, onTap: () -> Unit) {
    Button(
        onClick = onTap,
        enabled = enabled && !busy,
        colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
        modifier = Modifier.fillMaxWidth().height(52.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.Bold)
    }
}

// ── Step 1: Demo ────────────────────────────────────────────────────────────

@Composable
private fun DemoStep() {
    val c = LocalAppContainer.current
    Column(Modifier.stepPadding.verticalScroll(rememberScrollState())) {
        BrandBar()
        Spacer(Modifier.height(20.dp))
        StepHeader("Welcome", "A board that sounds like the child it belongs to.",
            "See what My World does for a real family — a board painted in your child's own style that speaks in a voice you pick.")
        Spacer(Modifier.height(20.dp))
        // Space reserved for the tappable demo board (matches iOS scaffold).
        Column(
            Modifier.fillMaxWidth().heightIn(min = 280.dp)
                .background(Color.White, RoundedCornerShape(22.dp))
                .border(1.dp, hexColor("#f3c6dd"), RoundedCornerShape(22.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("▶️", fontSize = 34.sp)
            Text("Live demo board", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.ink)
            Text("Tap real tiles and hear the magic — coming to this screen soon.",
                fontSize = 11.sp, color = Brand.muted)
        }
        Spacer(Modifier.height(20.dp))
        PrimaryButton("Make this for my child") { c.onboarding.go(Step.ACCOUNT) }
        Spacer(Modifier.height(8.dp))
        Text("Free to set up. Personalized board takes about 5 minutes.",
            fontSize = 12.sp, color = Brand.muted, modifier = Modifier.align(Alignment.CenterHorizontally))
        TextButton(onClick = { c.onboarding.go(Step.ACCOUNT) },
            modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text("Already have a board? Log in", color = Brand.pinkDeep, fontWeight = FontWeight.SemiBold)
        }
    }
}

// ── Step 2: Account (email/password) ────────────────────────────────────────

@Composable
private fun AccountStep() {
    val c = LocalAppContainer.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var loginMode by remember { mutableStateOf(true) }   // returning parents are the common case
    var email by remember { mutableStateOf(c.auth.lastEmail()) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var consented by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val formValid = email.isNotBlank() &&
        if (loginMode) password.isNotEmpty()
        else consented && password.length >= 8 && password == confirm

    fun finishAuth(created: Boolean) {
        c.onboarding.setNeedsOnboarding(created)
        if (created) c.onboarding.go(Step.CHILD)
        // Existing account: RootView re-renders on user != null and leaves the flow.
    }

    Column(Modifier.stepPadding.verticalScroll(rememberScrollState())) {
        BrandBar()
        Spacer(Modifier.height(20.dp))
        StepHeader("Account",
            if (loginMode) "Welcome back." else "Save your child's board.",
            if (loginMode) "Log in to the board you already set up."
            else "Your data stays private to your family.")
        Spacer(Modifier.height(14.dp))

        // Log in / create switch.
        Row(
            Modifier.fillMaxWidth().background(hexColor("#f7e6f0"), RoundedCornerShape(12.dp)).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            listOf(true to "Log in", false to "Create account").forEach { (mode, label) ->
                val active = loginMode == mode
                Box(
                    Modifier.weight(1f)
                        .background(if (active) Brand.pink else Color.Transparent, RoundedCornerShape(9.dp))
                        .clickable { loginMode = mode; error = null }
                        .padding(vertical = 9.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(label, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                        color = if (active) Color.White else Brand.ink)
                }
            }
        }
        Spacer(Modifier.height(14.dp))

        // COPPA/consent anchor — required before account creation.
        if (!loginMode) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "I'm the parent or legal guardian (or a caregiver with their permission), I'm 18+, and I agree to the Terms of Service and Privacy Policy. Photos I upload are used only to illustrate our board.",
                    fontSize = 12.sp, color = Brand.muted, modifier = Modifier.weight(1f),
                )
                Switch(checked = consented, onCheckedChange = { consented = it },
                    colors = SwitchDefaults.colors(checkedTrackColor = Brand.pink))
            }
            Row {
                TextButton(onClick = {
                    try {
                        context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,
                            Uri.parse("${ApiClient.ORIGIN}/terms")))
                    } catch (_: Exception) {}
                }) { Text("Terms of Service", fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
                TextButton(onClick = {
                    try {
                        context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,
                            Uri.parse("${ApiClient.ORIGIN}/privacy")))
                    } catch (_: Exception) {}
                }) { Text("Privacy Policy", fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
            }
            Spacer(Modifier.height(8.dp))
        }

        OutlinedTextField(value = email, onValueChange = { email = it },
            label = { Text("Email") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = password, onValueChange = { password = it },
            label = { Text(if (loginMode) "Password" else "Password (at least 8 characters)") },
            singleLine = true, visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth())
        if (!loginMode) {
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = confirm, onValueChange = { confirm = it },
                label = { Text("Confirm password") },
                singleLine = true, visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth())
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, fontSize = 13.sp, color = Color(0xFFDC2626))
        }

        Spacer(Modifier.height(16.dp))
        PrimaryButton(
            title = when {
                busy && loginMode -> "Signing in…"
                busy -> "Creating…"
                loginMode -> "Log in with email"
                else -> "Create account"
            },
            busy = busy, enabled = formValid,
        ) {
            busy = true; error = null
            scope.launch {
                if (loginMode) {
                    c.auth.noteEmail(email.trim())
                    c.auth.signIn(email.trim(), password)
                    if (c.auth.isSignedIn) finishAuth(created = false)
                    else error = c.auth.lastError.value ?: "Invalid email or password."
                } else {
                    try {
                        c.api.registerAccount(email.trim(), password)
                        c.auth.noteEmail(email.trim())
                        c.auth.refreshFromServer()
                        finishAuth(created = true)
                    } catch (e: Exception) {
                        error = "Could not create the account: ${e.message}"
                    }
                }
                busy = false
            }
        }
    }
}

// ── Step 3: Child (name + birthday + language + tier + style + voice) ──────

@Composable
private fun ChildStep() {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    var name by remember { mutableStateOf(c.onboarding.childName) }
    var birth by remember {
        mutableStateOf(c.onboarding.birthDate.ifEmpty {
            java.time.LocalDate.now().minusYears(2).toString()
        })
    }
    var language by remember { mutableStateOf(c.onboarding.language) }
    var tier by remember { mutableStateOf(c.onboarding.tier) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var langMenu by remember { mutableStateOf(false) }

    val languages = listOf(
        "en" to "English", "es" to "Español — coming soon", "fr" to "Français — coming soon",
        "pt" to "Português — coming soon", "de" to "Deutsch — coming soon",
    )

    Column(Modifier.stepPadding.verticalScroll(rememberScrollState())) {
        BrandBar()
        Spacer(Modifier.height(20.dp))
        StepHeader("Step 1 of 4", "Tell us about your child.",
            "Their birthday lets the board start with the right vocabulary — and grow with them.")
        Spacer(Modifier.height(14.dp))

        OutlinedTextField(value = name, onValueChange = { name = it },
            label = { Text("Name — e.g. Fletcher") }, singleLine = true,
            modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = birth, onValueChange = { birth = it },
            label = { Text("Birthday (YYYY-MM-DD)") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth())

        Spacer(Modifier.height(10.dp))
        Box {
            TextButton(onClick = { langMenu = true }) {
                Text("Language: ${languages.firstOrNull { it.first == language }?.second ?: language}  ▾",
                    color = Brand.ink)
            }
            DropdownMenu(expanded = langMenu, onDismissRequest = { langMenu = false }) {
                languages.forEach { (id, label) ->
                    DropdownMenuItem(text = { Text(label) }, onClick = { language = id; langMenu = false })
                }
            }
        }

        Text("ATTENTION TIER", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Brand.muted)
        Row(
            Modifier.fillMaxWidth().background(hexColor("#f7e6f0"), RoundedCornerShape(12.dp)).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            listOf("under3" to "Under 3", "3to5" to "3 – 5", "5plus" to "5 and up").forEach { (id, label) ->
                val active = tier == id
                Box(
                    Modifier.weight(1f)
                        .background(if (active) Brand.pink else Color.Transparent, RoundedCornerShape(9.dp))
                        .clickable { tier = id }
                        .padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                        color = if (active) Color.White else Brand.ink)
                }
            }
        }
        Text("Tier shapes the session length the board uses for auto-teach and games. You can change it later.",
            fontSize = 12.sp, color = Brand.muted)

        Spacer(Modifier.height(14.dp))
        StylePickerRow()
        Spacer(Modifier.height(14.dp))
        VoicePickerRow()

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, fontSize = 13.sp, color = Color(0xFFDC2626))
        }

        Spacer(Modifier.height(16.dp))
        PrimaryButton(if (busy) "Saving…" else "Continue", busy = busy,
            enabled = name.isNotBlank() && Regex("""\d{4}-\d{2}-\d{2}""").matches(birth.trim())) {
            busy = true; error = null
            scope.launch {
                try {
                    c.api.onboardingChild(
                        name = name.trim(), birthDate = birth.trim(), tier = tier,
                        language = language, voiceId = c.onboarding.voiceId,
                        styleGuideId = c.onboarding.styleGuideId,
                    )
                    c.onboarding.childName = name.trim()
                    c.onboarding.birthDate = birth.trim()
                    c.onboarding.language = language
                    c.onboarding.tier = tier
                    c.onboarding.go(Step.CHILD_PHOTO)
                } catch (e: Exception) { error = "Could not save: ${e.message}" }
                busy = false
            }
        }
    }
}

/** Horizontal swatch row of the style guides — the whole board shares one look. */
@Composable
private fun StylePickerRow() {
    val c = LocalAppContainer.current
    var styles by remember { mutableStateOf<List<OnboardingStyle>?>(null) }
    var selectedId by remember { mutableStateOf(c.onboarding.styleGuideId) }

    LaunchedEffect(Unit) {
        styles = try { c.api.onboardingStyles() } catch (_: Exception) { emptyList() }
        if (selectedId == null) styles?.firstOrNull()?.let {
            selectedId = it.id
            c.onboarding.styleGuideId = it.id
            c.onboarding.styleLabel = it.label
        }
    }

    Column {
        Text("BOARD ART STYLE", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Brand.muted)
        Text("The look for the whole board — the people portraits and the first words all share it.",
            fontSize = 12.sp, color = Brand.muted)
        Spacer(Modifier.height(6.dp))
        val s = styles
        when {
            s == null -> Text("Loading styles…", fontSize = 13.sp, color = Brand.muted)
            s.isEmpty() -> Text("Using the default style.", fontSize = 13.sp, color = Brand.muted)
            else -> Row(Modifier.horizontalScroll(rememberScrollState())) {
                s.forEach { style ->
                    val selected = selectedId == style.id
                    Column(
                        Modifier.width(92.dp).clickable {
                            selectedId = style.id
                            c.onboarding.styleGuideId = style.id
                            c.onboarding.styleLabel = style.label
                        },
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        val bmp by produceState<Bitmap?>(initialValue = null, style.id) {
                            value = withContext(Dispatchers.IO) {
                                try {
                                    val bytes = c.api.onboardingStyleImage(style.id)
                                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                                } catch (_: Exception) { null }
                            }
                        }
                        Box(
                            Modifier.size(84.dp).clip(RoundedCornerShape(14.dp))
                                .background(hexColor("#fff7fb"))
                                .border(if (selected) 3.dp else 1.dp,
                                    if (selected) Brand.pink else hexColor("#f1e3ec"),
                                    RoundedCornerShape(14.dp)),
                        ) {
                            bmp?.let {
                                Image(it.asImageBitmap(), contentDescription = style.label,
                                    contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                            }
                        }
                        Text(style.label, fontSize = 11.sp, maxLines = 1,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                            color = if (selected) Brand.pinkDeep else Brand.muted)
                    }
                    Spacer(Modifier.width(12.dp))
                }
            }
        }
    }
}

/** Horizontal chips of the ElevenLabs voices with ▶ preview. */
@Composable
private fun VoicePickerRow() {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    var voices by remember { mutableStateOf<List<OnboardingVoice>?>(null) }
    var selectedId by remember { mutableStateOf(c.onboarding.voiceId) }
    val player = remember { MediaPlayer() }

    LaunchedEffect(Unit) {
        voices = try { c.api.onboardingVoices() } catch (_: Exception) { emptyList() }
        if (selectedId == null) voices?.firstOrNull()?.let {
            selectedId = it.id
            c.onboarding.voiceId = it.id
            c.onboarding.voiceName = it.name
        }
    }
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose { try { player.release() } catch (_: Exception) {} }
    }

    Column {
        Text("BOARD VOICE", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Brand.muted)
        Text("How the board talks — tap ▶ to hear each voice.", fontSize = 12.sp, color = Brand.muted)
        Spacer(Modifier.height(6.dp))
        val v = voices
        when {
            v == null -> Text("Loading voices…", fontSize = 13.sp, color = Brand.muted)
            v.isEmpty() -> Text("Using the default voice.", fontSize = 13.sp, color = Brand.muted)
            else -> Row(Modifier.horizontalScroll(rememberScrollState())) {
                v.forEach { voice ->
                    val selected = selectedId == voice.id
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Column(
                            Modifier.width(104.dp)
                                .background(if (selected) hexColor("#ffe4f1") else Color.White, RoundedCornerShape(14.dp))
                                .border(if (selected) 3.dp else 1.dp,
                                    if (selected) Brand.pink else hexColor("#f1e3ec"),
                                    RoundedCornerShape(14.dp))
                                .clickable {
                                    selectedId = voice.id
                                    c.onboarding.voiceId = voice.id
                                    c.onboarding.voiceName = voice.name
                                }
                                .padding(vertical = 12.dp, horizontal = 6.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text("🔊", fontSize = 20.sp)
                            Text(voice.name, fontSize = 12.sp, maxLines = 1,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                                color = if (selected) Brand.pinkDeep else Brand.ink)
                            voice.description?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, fontSize = 9.sp, maxLines = 1, color = Brand.muted)
                            }
                        }
                        TextButton(onClick = {
                            val url = voice.previewUrl ?: return@TextButton
                            scope.launch {
                                // A failed preview never blocks selection.
                                try {
                                    player.reset()
                                    player.setDataSource(url)
                                    player.setOnPreparedListener { it.start() }
                                    player.prepareAsync()
                                } catch (_: Exception) {}
                            }
                        }) { Text("▶", fontSize = 18.sp, color = Brand.pink) }
                    }
                    Spacer(Modifier.width(12.dp))
                }
            }
        }
    }
}

// ── Steps 4 + 5: Photos with free retries ───────────────────────────────────

@Composable
private fun PhotoStep(isChild: Boolean) {
    val c = LocalAppContainer.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var jpeg by remember { mutableStateOf<ByteArray?>(null) }
    var draftKey by remember { mutableStateOf<String?>(null) }
    var draftImage by remember { mutableStateOf<Bitmap?>(null) }
    var attempt by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var subjectName by remember { mutableStateOf("") }
    var relationship by remember { mutableStateOf("mother") }
    var relMenu by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var addedGrownups by remember { mutableStateOf(0) }
    var showAddMore by remember { mutableStateOf(false) }

    suspend fun loadPreview(key: String) {
        draftKey = key
        draftImage = withContext(Dispatchers.IO) {
            try {
                c.media.bitmap(key)
            } catch (_: Exception) { null }
        }
    }

    fun draft(bytes: ByteArray) {
        jpeg = bytes
        busy = true; error = null
        scope.launch {
            try {
                val key = c.api.onboardingPhotoDraft(bytes, c.onboarding.styleGuideId)
                loadPreview(key)
            } catch (e: Exception) {
                error = "Couldn't render the portrait: ${e.message}"
                jpeg = null
            }
            busy = false
        }
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val bytes = withContext(Dispatchers.IO) {
                try {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?.let { downscaleJpeg(it) }
                } catch (_: Exception) { null }
            }
            bytes?.let { draft(it) }
        }
    }

    Column(Modifier.stepPadding.verticalScroll(rememberScrollState())) {
        BrandBar()
        Spacer(Modifier.height(20.dp))
        StepHeader(
            if (isChild) "Step 2 of 4" else "Step 3 of 4",
            if (isChild) "Add a photo of ${c.onboarding.childName.ifEmpty { "your child" }}."
            else "Add a photo of one grown-up.",
            if (isChild) "Their face becomes the art on every tile that's about them — feelings, actions, social phrases. Plain head-and-shoulders works best."
            else "Body parts and comfort phrases are taught with a face the child looks at all day. Pick the grown-up they see most.",
        )
        Spacer(Modifier.height(16.dp))

        when {
            !isChild && showAddMore -> {
                Column(
                    Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(18.dp))
                        .border(1.dp, hexColor("#f1e3ec"), RoundedCornerShape(18.dp)).padding(18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("✅", fontSize = 40.sp)
                    Text(if (addedGrownups == 1) "Grown-up added!" else "$addedGrownups grown-ups added!",
                        fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                    Text("Add anyone else the child sees a lot — the other parent, a sibling, a grandparent, a nanny. Each face anchors the tiles about them. You can always add more later from Family & people.",
                        fontSize = 13.sp, color = Brand.muted)
                    Spacer(Modifier.height(10.dp))
                    PrimaryButton("Add another grown-up") { showAddMore = false }
                    TextButton(onClick = { c.onboarding.go(Step.SEED_CORE) }) {
                        Text("Continue", color = Brand.pinkDeep, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            draftImage != null -> {
                // Preview + Looks great / Try again / Different photo.
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    Image(draftImage!!.asImageBitmap(), contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp).clip(RoundedCornerShape(20.dp)))
                    Spacer(Modifier.height(8.dp))
                    Text("How does this look?", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                    Text("Retries are free — try a few rolls and pick the one that feels right.",
                        fontSize = 12.sp, color = Brand.muted)
                    Spacer(Modifier.height(12.dp))
                    PrimaryButton(if (busy) "Saving…" else "Looks great", busy = busy) {
                        val key = draftKey ?: return@PrimaryButton
                        busy = true; error = null
                        scope.launch {
                            try {
                                if (isChild) {
                                    c.api.onboardingPhotoCommit(key, "child", c.onboarding.childName, "self")
                                    c.onboarding.go(Step.PARENT_PHOTO)
                                } else {
                                    c.api.onboardingPhotoCommit(key, "parent", subjectName.trim(), relationship)
                                    addedGrownups++
                                    jpeg = null; draftKey = null; draftImage = null; attempt = 0
                                    subjectName = ""; relationship = "mother"
                                    showAddMore = true   // the grown-up step is repeatable
                                }
                            } catch (e: Exception) { error = "Could not save: ${e.message}" }
                            busy = false
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row {
                        TextButton(onClick = {
                            val key = draftKey ?: return@TextButton
                            busy = true; error = null; attempt++
                            scope.launch {
                                try { loadPreview(c.api.onboardingPhotoRetry(key, attempt, c.onboarding.styleGuideId)) }
                                catch (e: Exception) { error = "Retry failed: ${e.message}" }
                                busy = false
                            }
                        }, enabled = !busy) {
                            Text(if (busy) "…" else "Try again", fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                        }
                        TextButton(onClick = {
                            jpeg = null; draftKey = null; draftImage = null; attempt = 0
                            pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        }, enabled = !busy) {
                            Text("Different photo", fontWeight = FontWeight.Bold, color = Brand.muted)
                        }
                    }
                }
            }
            jpeg != null -> {
                Row(
                    Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).padding(vertical = 22.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(color = Brand.pink, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(12.dp))
                    Text("Painting the portrait…", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand.muted)
                }
            }
            else -> {
                if (!isChild) {
                    OutlinedTextField(value = subjectName, onValueChange = { subjectName = it },
                        label = { Text("Name — e.g. Mama, Dada, Grandma Jane") },
                        singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    Box {
                        TextButton(onClick = { relMenu = true }) {
                            Text("Relationship: ${io.andrewpeterson.myworld.ui.parent.relationshipLabel(relationship)}  ▾",
                                color = Brand.ink)
                        }
                        DropdownMenu(expanded = relMenu, onDismissRequest = { relMenu = false }) {
                            listOf("mother" to "Mother", "father" to "Father", "stepmother" to "Step-parent",
                                "guardian" to "Guardian", "grandmother" to "Grandmother", "grandfather" to "Grandfather")
                                .forEach { (v, l) ->
                                    DropdownMenuItem(text = { Text(l) }, onClick = { relationship = v; relMenu = false })
                                }
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                }
                val captureEnabled = isChild || subjectName.isNotBlank()
                Column(
                    Modifier.fillMaxWidth()
                        .background(Color.White, RoundedCornerShape(18.dp))
                        .border(1.dp, hexColor("#f1e3ec"), RoundedCornerShape(18.dp))
                        .clickable(enabled = captureEnabled) {
                            pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        }
                        .padding(vertical = 28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("📷", fontSize = 34.sp)
                    Text("Take or choose a photo", fontSize = 16.sp, fontWeight = FontWeight.Bold,
                        color = if (captureEnabled) Brand.ink else Brand.muted)
                    Text("About 30 seconds to render.", fontSize = 12.sp, color = Brand.muted)
                }
            }
        }

        error?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, fontSize = 13.sp, color = Color(0xFFDC2626))
        }
    }
}

// ── Step 6: Seed Core ───────────────────────────────────────────────────────

@Composable
private fun SeedStep() {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var queued by remember { mutableStateOf<Int?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val coreWords = listOf("more", "help", "stop", "go", "all done", "yes", "no",
        "mine", "look", "again", "eat", "drink", "hurt")

    Column(Modifier.stepPadding.verticalScroll(rememberScrollState())) {
        BrandBar()
        Spacer(Modifier.height(20.dp))
        StepHeader("Step 4 of 4", "Let's make the first words.",
            "We'll generate ${c.onboarding.childName.ifEmpty { "your child" }}'s 13 most useful first words now. Household items — favorite cup, blanket, stuffed animal — you'll snap as you go.")
        if (c.onboarding.styleLabel.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text("🎨 In your ${c.onboarding.styleLabel} style", fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold, color = Brand.pinkDeep)
        }
        Spacer(Modifier.height(14.dp))

        // The 13 words as chips, 3 per row.
        coreWords.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { w ->
                    Box(
                        Modifier.weight(1f)
                            .background(Color.White, RoundedCornerShape(10.dp))
                            .border(1.dp, hexColor("#f1e3ec"), RoundedCornerShape(10.dp))
                            .padding(vertical = 9.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(w, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Brand.pinkDeep) }
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
            Spacer(Modifier.height(8.dp))
        }

        Spacer(Modifier.height(6.dp))
        Row(
            Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(12.dp),
        ) {
            Text("💳", fontSize = 16.sp)
            Spacer(Modifier.width(10.dp))
            Column {
                Text("These first 13 don't count against your monthly credits.",
                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Brand.ink)
                Text("Onboarding generation is on us. Your plan covers everything you add after.",
                    fontSize = 12.sp, color = Brand.muted)
            }
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, fontSize = 13.sp, color = Color(0xFFDC2626))
        }

        Spacer(Modifier.height(16.dp))
        val q = queued
        if (q != null) {
            Text("Queued $q tiles. About 90 seconds.", fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold, color = hexColor("#10b981"))
            Spacer(Modifier.height(8.dp))
            PrimaryButton("Open the board") { c.onboarding.go(Step.COMPLETE) }
        } else {
            PrimaryButton(if (busy) "Queuing…" else "Make these words", busy = busy) {
                busy = true; error = null
                scope.launch {
                    try { queued = c.api.onboardingSeedCore(c.onboarding.styleGuideId).queuedCount }
                    catch (e: Exception) { error = "Could not queue the starter tiles: ${e.message}" }
                    busy = false
                }
            }
        }
    }
}

// ── Done ────────────────────────────────────────────────────────────────────

@Composable
private fun DoneStep() {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()

    Column(
        Modifier.stepPadding,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("✅", fontSize = 58.sp)
        Text("All set.", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
        Text("${c.onboarding.childName.ifEmpty { "Your child" }}'s board is being painted now. Open it on this device, or hand the tablet to them.",
            fontSize = 14.sp, color = Brand.muted,
            modifier = Modifier.padding(horizontal = 24.dp))
        Spacer(Modifier.height(24.dp))
        PrimaryButton("Open the parent app") {
            scope.launch {
                c.api.onboardingComplete()
                c.auth.refreshFromServer()      // the account now has a child slug
                c.onboarding.setNeedsOnboarding(false)
                c.deviceMode.set(io.andrewpeterson.myworld.model.DeviceMode.Role.PARENT)
            }
        }
    }
}

package io.andrewpeterson.myworld.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.BuildConfig
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject

/**
 * Launch version gate — Android twin of `UpdateGate.swift`.
 *
 * Fetches `/api/manifest?app=versions` (public, no auth) once per process and
 * compares BuildConfig.VERSION_CODE against the server thresholds:
 *   below minBuild  → full-screen update wall (known-broken build);
 *   below softBuild → dismissible "update available" card, once per launch.
 * Thresholds default to 0 server-side (env unset → gate off) and every
 * failure path fails OPEN — an AAC device must never lose its voice to a
 * flaky network or a misconfigured gate.
 */
@Composable
fun UpdateGate(content: @Composable () -> Unit) {
    val api = LocalAppContainer.current.api
    var wallNote by remember { mutableStateOf<String?>(null) }
    var wallUrl by remember { mutableStateOf<String?>(null) }
    var walled by remember { mutableStateOf(false) }
    var nudged by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        try {
            val bytes = api.raw("GET", "/api/manifest?app=versions")
            val root = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
            val a = (root["android"] as? JsonObject) ?: return@LaunchedEffect
            fun int(k: String) = (a[k] as? JsonPrimitive)?.intOrNull ?: 0
            fun str(k: String) = (a[k] as? JsonPrimitive)?.contentOrNull
            val build = BuildConfig.VERSION_CODE
            if (build <= 0) return@LaunchedEffect
            wallNote = str("note")
            wallUrl = str("updateUrl")
            when {
                int("minBuild") > 0 && build < int("minBuild") -> walled = true
                int("softBuild") > 0 && build < int("softBuild") -> nudged = true
            }
        } catch (_: Exception) { /* fail open */ }
    }

    Box(Modifier.fillMaxSize()) {
        content()
        if (walled) UpdateWall(wallNote, wallUrl)
        else if (nudged) Box(Modifier.align(Alignment.BottomCenter).padding(16.dp)) {
            UpdateNudge(wallNote, wallUrl, onLater = { nudged = false })
        }
    }
}

@Composable
private fun UpdateWall(note: String?, url: String?) {
    val uri = LocalUriHandler.current
    Column(
        Modifier.fillMaxSize().background(Brand.bg).padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("⬇️", fontSize = 44.sp)
        Text(
            "Time to update My World",
            color = Brand.pinkDeep, fontSize = 24.sp, fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp),
        )
        Text(
            note ?: ("This version is too old to talk to our servers safely. " +
                "Update and everything — the board, the pictures, the voices — is right where you left it."),
            color = Brand.muted, fontSize = 14.sp, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 10.dp),
        )
        if (url != null) {
            Text(
                "Update now",
                color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .padding(top = 18.dp)
                    .background(Brand.pink, RoundedCornerShape(999.dp))
                    .clickable { uri.openUri(url) }
                    .padding(horizontal = 28.dp, vertical = 13.dp),
            )
        } else {
            Text(
                "Open the Play Store (or your test channel) and install the newest My World.",
                color = Brand.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp),
            )
        }
    }
}

@Composable
private fun UpdateNudge(note: String?, url: String?, onLater: () -> Unit) {
    val uri = LocalUriHandler.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color.White, RoundedCornerShape(16.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text("✨", fontSize = 18.sp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("A new My World is ready", color = Brand.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Text(
                note ?: "Update when convenient — new features and fixes are waiting.",
                color = Brand.muted, fontSize = 12.sp,
            )
            Row(Modifier.padding(top = 6.dp)) {
                if (url != null) {
                    Text(
                        "Update", color = Brand.pinkDeep, fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable { uri.openUri(url) },
                    )
                    Spacer(Modifier.width(16.dp))
                }
                Text(
                    "Later", color = Brand.muted, fontSize = 13.sp,
                    modifier = Modifier.clickable(onClick = onLater),
                )
            }
        }
    }
}

package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.model.DeviceMode
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.coroutines.launch

/**
 * Child-board hidden settings (triple-tap the header) — port of
 * `Views/SettingsView.swift`: account info, switch to parent app, clear
 * cache, sign out.
 */
@Composable
fun SettingsView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val user by c.auth.user.collectAsState()

    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.background(Color.White, RoundedCornerShape(22.dp)).padding(22.dp)) {
            Text("Settings", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(4.dp))
            Text(user?.email ?: "", fontSize = 13.sp, color = Brand.muted)
            Spacer(Modifier.height(14.dp))

            TextButton(onClick = {
                c.deviceMode.set(DeviceMode.Role.PARENT); onDismiss()
            }, modifier = Modifier.fillMaxWidth()) {
                Text("Switch this device to the parent app", color = Brand.ink)
            }
            TextButton(onClick = {
                c.media.clear(); c.speechCache.clear()
                scope.launch { c.board.refresh(c.auth.childSlug) }
            }, modifier = Modifier.fillMaxWidth()) {
                Text("Clear media cache & re-download", color = Brand.ink)
            }
            TextButton(onClick = {
                scope.launch { c.auth.signOut() }
                onDismiss()
            }, modifier = Modifier.fillMaxWidth()) {
                Text("Sign out", color = Color(0xFFDC2626))
            }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Done", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)
            }
        }
    }
}

package io.andrewpeterson.myworld.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.ui.theme.Brand
import kotlinx.coroutines.launch

/**
 * Parent-unlock password gate — port of `Views/UnlockSheet.swift`. Long-press
 * on the lock opens this; the parent re-enters THEIR password (verified via
 * /api/auth/login with the signed-in email) to unlock edit mode.
 */
@Composable
fun UnlockSheet(onDismiss: () -> Unit, onUnlock: () -> Unit) {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun attempt() {
        if (busy || password.isEmpty()) return
        busy = true; error = null
        scope.launch {
            try {
                val resp = c.api.login(c.auth.lastEmail(), password)
                if (resp.ok) { onUnlock(); onDismiss() }
                else error = "That password doesn't match."
            } catch (_: Exception) {
                error = "That password doesn't match."
            } finally { busy = false }
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.background(Color.White, RoundedCornerShape(22.dp)).padding(24.dp),
        ) {
            Text("Grown-ups only", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(6.dp))
            Text("Enter your password to unlock the board for editing.",
                fontSize = 13.sp, color = Brand.muted)
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = password, onValueChange = { password = it },
                label = { Text("Password") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Color(0xFFDC2626), fontSize = 13.sp)
            }
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel", color = Brand.muted) }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = { attempt() },
                    enabled = !busy && password.isNotEmpty(),
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                ) { Text(if (busy) "Checking…" else "Unlock") }
            }
        }
    }
}

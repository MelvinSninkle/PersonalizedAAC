package io.andrewpeterson.myworld.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.resetRequest
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor
import kotlinx.coroutines.launch

/** Port of kid-ios `Views/LoginView.swift` — email/password sign-in. */
@Composable
fun LoginView() {
    val c = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val lastError by c.auth.lastError.collectAsState()

    var email by remember { mutableStateOf(c.auth.lastEmail()) }
    var password by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(hexColor("#fff7fb"))
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🌍", fontSize = 72.sp)
        Spacer(Modifier.height(12.dp))
        Text("My World", fontSize = 44.sp, fontWeight = FontWeight.Bold, color = Brand.pink)
        Text("Tap to Talk", fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            color = Brand.pinkDeep.copy(alpha = 0.8f))
        Spacer(Modifier.height(8.dp))
        Text("Sign in to your child's board", fontSize = 18.sp, color = Brand.muted)
        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = email, onValueChange = { email = it.trim() },
            label = { Text("Email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Brand.pink, unfocusedBorderColor = Brand.line),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
        )
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Brand.pink, unfocusedBorderColor = Brand.line),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
        )

        lastError?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = Color(0xFFDC2626), fontSize = 14.sp, textAlign = TextAlign.Center)
        }

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                scope.launch {
                    submitting = true
                    c.auth.noteEmail(email)
                    c.auth.signIn(email, password)
                    submitting = false
                }
            },
            enabled = !submitting && email.isNotBlank() && password.isNotBlank(),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().height(52.dp),
        ) {
            Text(if (submitting) "Signing in…" else "Sign in",
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        }

        // Same reset flow as the web login: enter your email, get a link.
        Spacer(Modifier.height(10.dp))
        var resetMsg by remember { mutableStateOf<String?>(null) }
        var resetBusy by remember { mutableStateOf(false) }
        TextButton(onClick = {
            val addr = email.trim()
            if (!addr.contains("@")) { resetMsg = "Enter your account email above first, then tap again."; return@TextButton }
            scope.launch {
                resetBusy = true
                resetMsg = try {
                    c.api.resetRequest(addr)
                    "If that email has an account, a reset link is on its way. Check your inbox."
                } catch (_: Exception) { "Couldn't send the link. Check your connection and try again." }
                resetBusy = false
            }
        }, enabled = !resetBusy) {
            Text(if (resetBusy) "Sending…" else "Forgot password?",
                fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand.pinkDeep)
        }
        resetMsg?.let {
            Text(it, fontSize = 13.sp, color = Color(0xFF047857), textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 420.dp))
        }
    }
}

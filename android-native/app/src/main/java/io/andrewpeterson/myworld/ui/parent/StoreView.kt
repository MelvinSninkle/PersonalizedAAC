package io.andrewpeterson.myworld.ui.parent

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.andrewpeterson.myworld.LocalAppContainer
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.StoreCatalog
import io.andrewpeterson.myworld.net.storeCatalog
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * Credits & membership — M9 READ-ONLY port of `Parent/StoreView.swift`:
 * balance, current tier, this month's voice budget, and the tier ladder.
 * Native Google Play purchases arrive with M12 (BillingClientManager); until
 * then the buttons hand off to the web store, which works everywhere —
 * including Fire tablets, where it stays the permanent purchase path.
 */
@Composable
fun StoreView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val context = LocalContext.current
    var catalog by remember { mutableStateOf<StoreCatalog?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try { catalog = c.api.storeCatalog() }
        catch (e: Exception) { error = "Could not load the store: ${e.message}" }
    }

    fun openWebStore() {
        val url = "${ApiClient.ORIGIN}/store.html?child=${c.api.esc(c.auth.childSlug)}"
        try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {}
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxWidth(0.94f)
                .background(Color.White, RoundedCornerShape(24.dp))
                .padding(22.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text("Credits & Store", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
            Spacer(Modifier.height(12.dp))

            val cat = catalog
            when {
                error != null -> Text(error!!, fontSize = 13.sp, color = Color(0xFFDC2626))
                cat == null -> Text("Loading…", fontSize = 14.sp, color = Brand.muted)
                else -> {
                    // Balance + tier headline.
                    Column(
                        Modifier.fillMaxWidth()
                            .background(hexColor("#fdf2f8"), RoundedCornerShape(16.dp))
                            .padding(16.dp),
                    ) {
                        Row {
                            Column(Modifier.weight(1f)) {
                                Text("Image credits", fontSize = 12.sp, color = Brand.muted)
                                Text("${cat.balance ?: 0}", fontSize = 30.sp,
                                    fontWeight = FontWeight.Black, color = Brand.pinkDeep)
                            }
                            Column {
                                Text("Membership", fontSize = 12.sp, color = Brand.muted)
                                Text(cat.entitlement?.label ?: "Free", fontSize = 18.sp,
                                    fontWeight = FontWeight.Bold, color = Brand.ink)
                            }
                        }
                        cat.entitlement?.voice?.let { v ->
                            Spacer(Modifier.height(8.dp))
                            val capText = v.cap?.let { "${it / 1000}k" } ?: "∞"
                            Text("Voice this month: ${v.used / 1000}k of $capText characters",
                                fontSize = 12.sp, color = Brand.muted)
                        }
                    }
                    Spacer(Modifier.height(14.dp))

                    // Tier ladder (display; purchase = web until M12 billing).
                    Text("MEMBERSHIPS", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
                    Spacer(Modifier.height(6.dp))
                    cat.subscriptions.forEach { s ->
                        val active = cat.entitlement?.tier?.let { s.sku.startsWith(it) } == true
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(s.label.ifEmpty { s.sku }, fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (active) Brand.pinkDeep else Brand.ink)
                                Text("${s.creditsPerPeriod} image credits each month",
                                    fontSize = 12.sp, color = Brand.muted)
                            }
                            Text(
                                if (active) "Current" else "$" + "%.2f/mo".format(s.cents / 100.0),
                                fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                                color = if (active) hexColor("#10b981") else Brand.muted,
                            )
                        }
                    }
                    if (cat.subscriptions.isEmpty()) {
                        Text("Memberships from $4.99/month unlock speech-to-text, auto-teach, reporting, and styled tiles.",
                            fontSize = 12.sp, color = Brand.muted)
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { openWebStore() },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                Text("Manage membership & buy credits", fontWeight = FontWeight.Bold)
            }
            Text(
                "Opens the secure web store — purchases made there appear here right away. In-app purchasing on Google Play is coming in the next update.",
                fontSize = 11.sp, color = Brand.muted,
                modifier = Modifier.padding(top = 8.dp),
            )
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Close", color = Brand.muted)
            }
        }
    }
}

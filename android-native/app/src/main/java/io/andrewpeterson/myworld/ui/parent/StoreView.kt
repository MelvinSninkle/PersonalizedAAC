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
import androidx.compose.runtime.collectAsState
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
import io.andrewpeterson.myworld.net.storeRedeem
import kotlinx.coroutines.launch
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.hexColor

/**
 * Credits & membership — port of `Parent/StoreView.swift`: balance, tier,
 * voice budget, and NATIVE Google Play purchases for the three memberships
 * and credit packs (verify-before-acknowledge; server is source of truth).
 * On devices without Play services (Fire tablets) the buttons hand off to
 * the secure web store instead — that path works everywhere, permanently.
 */
@Composable
fun StoreView(onDismiss: () -> Unit) {
    val c = LocalAppContainer.current
    val context = LocalContext.current
    var catalog by remember { mutableStateOf<StoreCatalog?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showShop by remember { mutableStateOf(false) }
    var coupon by remember { mutableStateOf("") }
    var couponNote by remember { mutableStateOf<String?>(null) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    val billingAvailable by c.billing.available.collectAsState()
    val billingNote by c.billing.note.collectAsState()
    val purchaseTick by c.billing.purchaseTick.collectAsState()
    val activity = context as? android.app.Activity

    LaunchedEffect(Unit) { c.billing.start() }
    LaunchedEffect(purchaseTick) {
        try { catalog = c.api.storeCatalog() }
        catch (e: Exception) { if (catalog == null) error = "Could not load the store: ${e.message}" }
        // Warm the Word Shop's catalog cache while the parent is still here,
        // so "Shop words for the board" opens instantly (iOS parity).
        if (purchaseTick == 0) {
            io.andrewpeterson.myworld.storage.ShopCatalogCache.refresh(context, c.auth.childSlug, c.api)
        }
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

                    // Tier ladder — native Play purchase when available.
                    Text("MEMBERSHIPS", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
                    Spacer(Modifier.height(6.dp))
                    cat.subscriptions.forEach { s ->
                        val active = cat.entitlement?.tier?.let { s.sku.startsWith(it) } == true
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(s.label.ifEmpty { s.sku }, fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (active) Brand.pinkDeep else Brand.ink)
                                Text("${s.creditsPerPeriod} image credits each month",
                                    fontSize = 12.sp, color = Brand.muted)
                            }
                            when {
                                active -> Text("Current", fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold, color = hexColor("#10b981"))
                                billingAvailable && activity != null -> TextButton(onClick = {
                                    c.billing.launchPurchase(activity, s.sku)
                                }) {
                                    Text(c.billing.price(s.sku) ?: ("$" + "%.2f/mo".format(s.cents / 100.0)),
                                        fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                                }
                                else -> Text("$" + "%.2f/mo".format(s.cents / 100.0),
                                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Brand.muted)
                            }
                        }
                    }
                    if (cat.subscriptions.isEmpty()) {
                        Text("Memberships from $4.99/month unlock speech-to-text, auto-teach, reporting, and styled tiles.",
                            fontSize = 12.sp, color = Brand.muted)
                    }

                    // Credit packs — native buy buttons when Play is present.
                    if (billingAvailable && cat.packs.isNotEmpty()) {
                        Spacer(Modifier.height(12.dp))
                        Text("CREDIT PACKS", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Brand.muted)
                        Spacer(Modifier.height(4.dp))
                        cat.packs.forEach { p ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                            ) {
                                Text("⭐ ${p.credits} — ${p.label.ifEmpty { p.sku }}",
                                    fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                                    color = Brand.ink, modifier = Modifier.weight(1f))
                                TextButton(onClick = {
                                    if (activity != null) c.billing.launchPurchase(activity, p.sku)
                                }) {
                                    Text(c.billing.price(p.sku) ?: ("$" + "%.2f".format(p.cents / 100.0)),
                                        fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Brand.pinkDeep)
                                }
                            }
                        }
                    }

                    billingNote?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = hexColor("#047857"))
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { showShop = true },
                colors = ButtonDefaults.buttonColors(containerColor = hexColor("#ad1457")),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                Text("🛍 Shop words for the board", fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = { openWebStore() },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.pink),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                Text(if (billingAvailable) "Manage billing on the web" else "Buy on the secure web store",
                    fontWeight = FontWeight.Bold)
            }

            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                androidx.compose.material3.OutlinedTextField(
                    value = coupon, onValueChange = { coupon = it },
                    label = { Text("Have a code?") }, singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = {
                    val code = coupon.trim()
                    if (code.isEmpty()) return@TextButton
                    scope.launch {
                        couponNote = try {
                            val r = c.api.storeRedeem(code)
                            coupon = ""
                            try { catalog = c.api.storeCatalog() } catch (_: Exception) {}
                            "⭐ ${r.credited} credits added!"
                        } catch (e: Exception) { "Couldn't redeem: ${e.message}" }
                    }
                }) { Text("Redeem", fontWeight = FontWeight.Bold, color = Brand.pinkDeep) }
            }
            couponNote?.let { Text(it, fontSize = 12.sp, color = Brand.muted) }
            if (billingAvailable) {
                TextButton(onClick = { c.billing.restorePurchases() }, modifier = Modifier.fillMaxWidth()) {
                    Text("Restore purchases", fontSize = 13.sp, color = Brand.pinkDeep)
                }
            }
            Text(
                if (billingAvailable)
                    "Prices are billed through Google Play. Purchases made on the web appear here right away too — one wallet everywhere."
                else
                    "This device doesn't have Google Play (that's normal on Fire tablets), so purchases open the secure web store instead. Credits bought there land on the board right away.",
                fontSize = 11.sp, color = Brand.muted,
                modifier = Modifier.padding(top = 8.dp),
            )
            Row {
                TextButton(onClick = {
                    try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${ApiClient.ORIGIN}/terms"))) } catch (_: Exception) {}
                }) { Text("Terms of Service", fontSize = 11.sp, color = Brand.muted) }
                TextButton(onClick = {
                    try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${ApiClient.ORIGIN}/privacy"))) } catch (_: Exception) {}
                }) { Text("Privacy Policy", fontSize = 11.sp, color = Brand.muted) }
            }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Close", color = Brand.muted)
            }
        }
    }

    if (showShop) WordShopView { showShop = false }
}

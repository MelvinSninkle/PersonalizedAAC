package io.andrewpeterson.myworld

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File

/**
 * My World for Android / Fire OS — a thin native shell around the live web
 * board (the SAME app the iPad's Capacitor shell shows), plus a native
 * speech-recognition bridge that speaks the exact `Capacitor.Plugins.
 * SpeechRecognition` interface the board already calls. One codebase,
 * permanent feature parity with iOS.
 *
 * What the shell adds over a plain browser:
 *   · real microphone speech-to-text (Android SpeechRecognizer)
 *   · fullscreen immersive kid mode + keep-screen-on
 *   · camera / photo-library uploads for the add-a-tile flows
 *   · capability flags (window.MyWorldShell) so the board can explain what a
 *     given device supports (e.g. Fire tablets have no speech service)
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val BASE_URL = "https://aac.andrewpeterson.io/"
        // Hosts allowed to render INSIDE the shell. Stripe checkout/billing
        // must stay in-view so the web store works end-to-end.
        val IN_APP_HOSTS = setOf("aac.andrewpeterson.io", "checkout.stripe.com", "billing.stripe.com")
        const val PERM_RECORD_AUDIO = 71
        const val PERM_CAMERA = 72
        const val REQ_FILE_CHOOSER = 81
    }

    lateinit var webView: WebView
    private lateinit var speech: SpeechBridge
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var cameraOutputUri: Uri? = null

    private val isFire: Boolean
        get() = Build.MANUFACTURER.equals("Amazon", ignoreCase = true)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // AAC boards live on all day — never let the screen sleep mid-sentence.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)
        applyImmersive()

        speech = SpeechBridge(this)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false   // tile voices must autoplay
            loadWithOverviewMode = true
            useWideViewPort = true
            // The board reads this to tailor its device messaging.
            userAgentString = "$userAgentString MyWorldShell/1.0 (${if (isFire) "fire" else "android"})"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val scheme = url.scheme ?: return false
                if (scheme == "http" || scheme == "https") {
                    if (url.host in IN_APP_HOSTS) return false           // stay in the shell
                    // Anything else (docs, support links) opens in the browser.
                    return try { startActivity(Intent(Intent.ACTION_VIEW, url)); true } catch (_: Exception) { true }
                }
                // mailto:, tel:, market:, intent: …
                return try { startActivity(Intent(Intent.ACTION_VIEW, url)); true } catch (_: Exception) { true }
            }

            override fun onPageFinished(view: WebView, url: String) {
                speech.injectShim(view)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // Only replace the page for a failed MAIN-frame load (a missing
                // image or a flaky API call must never blank the whole board).
                if (request.isForMainFrame) showOfflinePage()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // Grant page-level AV capture when the OS-level permission exists.
                runOnUiThread {
                    val wants = request.resources.filter {
                        it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                    }
                    if (wants.isEmpty()) { request.deny(); return@runOnUiThread }
                    request.grant(wants.toTypedArray())
                }
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                openImageChooser()
                return true
            }
        }

        webView.loadUrl(BASE_URL)
    }

    /** Camera + photo library in one chooser (the add-a-tile flows use both). */
    private fun openImageChooser() {
        val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        val chooser = Intent.createChooser(pick, "Add a photo")

        val hasCameraHardware = packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        val cameraGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        // We declare CAMERA in the manifest, so Android REQUIRES the runtime
        // grant before ACTION_IMAGE_CAPTURE; until granted, only the library
        // shows (and we request so next time the camera appears too).
        if (hasCameraHardware && cameraGranted) {
            try {
                val dir = File(cacheDir, "camera").apply { mkdirs() }
                val photo = File.createTempFile("capture", ".jpg", dir)
                cameraOutputUri = FileProvider.getUriForFile(this, "io.andrewpeterson.myworld.fileprovider", photo)
                val cam = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                }
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cam))
            } catch (_: Exception) { cameraOutputUri = null }
        } else if (hasCameraHardware && !cameraGranted) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), PERM_CAMERA)
        }
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(chooser, REQ_FILE_CHOOSER)
        } catch (_: Exception) {
            filePathCallback?.onReceiveValue(null); filePathCallback = null
        }
    }

    @Deprecated("WebView file chooser still hands results through onActivityResult")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_FILE_CHOOSER) return
        val cb = filePathCallback ?: return
        filePathCallback = null
        if (resultCode != RESULT_OK) { cb.onReceiveValue(null); return }
        val picked = data?.data
        val result = when {
            picked != null -> arrayOf(picked)                       // library choice
            cameraOutputUri != null -> arrayOf(cameraOutputUri!!)   // camera capture
            else -> null
        }
        cameraOutputUri = null
        cb.onReceiveValue(result)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERM_RECORD_AUDIO) speech.onPermissionResult()
    }

    /** Sticky immersive: the board owns the whole screen, bars return on swipe. */
    private fun applyImmersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersive()
    }

    @Deprecated("Simple two-level back: web history, then background")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else moveTaskToBack(true)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()   // keep the login session across kills
        speech.stopListening()
    }

    private fun showOfflinePage() {
        val html = """
            <!doctype html><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <body style="margin:0;height:100vh;display:grid;place-items:center;background:#fff7fb;
                         font-family:system-ui,sans-serif;color:#ad1457;text-align:center;padding:24px">
            <div><h1 style="font-size:34px;margin:0 0 8px">${getString(R.string.offline_title)}</h1>
            <p style="color:#6b7280;font-size:15px;max-width:320px">${getString(R.string.offline_body)}</p>
            <button onclick="location.href='$BASE_URL'" style="margin-top:14px;background:#ff1493;color:#fff;
                    border:none;border-radius:999px;padding:12px 26px;font-size:16px;font-weight:700">
              ${getString(R.string.offline_retry)}</button></div></body>
        """.trimIndent()
        webView.loadDataWithBaseURL(BASE_URL, html, "text/html", "utf-8", null)
    }
}

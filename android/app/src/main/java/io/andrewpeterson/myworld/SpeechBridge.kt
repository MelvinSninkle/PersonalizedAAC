package io.andrewpeterson.myworld

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native speech recognition exposed to the web board through a JS shim that
 * mimics `@capacitor-community/speech-recognition` — the EXACT plugin surface
 * app.html already calls (`Capacitor.Plugins.SpeechRecognition.start/stop/
 * addListener('partialResults'|'listeningState')`). The board's listening mode
 * therefore works unchanged in this shell.
 *
 * Kindle Fire: Fire OS ships no speech-recognition service, so
 * `SpeechRecognizer.isRecognitionAvailable()` is false there — the shim then
 * installs only `window.MyWorldShell { speech:false }` and the board explains
 * the limitation instead of showing a dead microphone.
 */
class SpeechBridge(private val activity: MainActivity) {

    private var recognizer: SpeechRecognizer? = null
    private var wantedLanguage = "en-US"
    private var preferOffline = true

    // ── JS-callable surface ──────────────────────────────────────────────────

    @JavascriptInterface
    fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(activity)

    @JavascriptInterface
    fun platform(): String =
        if (Build.MANUFACTURER.equals("Amazon", ignoreCase = true)) "fire" else "android"

    @JavascriptInterface
    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    @JavascriptInterface
    fun requestPermission() {
        if (hasPermission()) return
        activity.runOnUiThread {
            ActivityCompat.requestPermissions(
                activity, arrayOf(Manifest.permission.RECORD_AUDIO), MainActivity.PERM_RECORD_AUDIO)
        }
    }

    @JavascriptInterface
    fun start(language: String, offline: Boolean) {
        wantedLanguage = language.ifBlank { "en-US" }
        preferOffline = offline
        activity.runOnUiThread { startListening() }
    }

    @JavascriptInterface
    fun stop() {
        activity.runOnUiThread { stopListening() }
    }

    // ── Native side ─────────────────────────────────────────────────────────

    fun onPermissionResult() {
        // The board's restart loop retries start() on 'stopped' — nudge it.
        emit("listeningState", JSONObject().put("status", "stopped"))
    }

    private fun startListening() {
        if (!available() || !hasPermission()) {
            emit("listeningState", JSONObject().put("status", "stopped"))
            return
        }
        stopListening()
        val r = SpeechRecognizer.createSpeechRecognizer(activity)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle) = pushMatches(partialResults)
            override fun onResults(results: Bundle) {
                pushMatches(results)
                emit("listeningState", JSONObject().put("status", "stopped"))
            }
            override fun onError(error: Int) {
                // Includes the routine no-speech timeout — the web restart loop
                // handles cadence, we just report honestly.
                emit("listeningState", JSONObject().put("status", "stopped"))
            }
            override fun onEndOfSpeech() {}
            override fun onReadyForSpeech(params: Bundle?) {
                emit("listeningState", JSONObject().put("status", "started"))
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, wantedLanguage)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            if (Build.VERSION.SDK_INT >= 23) {
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
            }
        }
        try { r.startListening(intent) } catch (_: Exception) {
            emit("listeningState", JSONObject().put("status", "stopped"))
        }
    }

    fun stopListening() {
        recognizer?.let {
            try { it.cancel() } catch (_: Exception) {}
            try { it.destroy() } catch (_: Exception) {}
        }
        recognizer = null
    }

    private fun pushMatches(bundle: Bundle) {
        val matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
        if (matches.isEmpty()) return
        emit("partialResults", JSONObject().put("matches", JSONArray(matches)))
    }

    private fun emit(event: String, data: JSONObject) {
        activity.runOnUiThread {
            activity.webView.evaluateJavascript(
                "window.__mwSpeech && window.__mwSpeech.emit(${JSONObject.quote(event)}, $data);", null)
        }
    }

    // ── The Capacitor-compatible JS shim ────────────────────────────────────

    /** Injected after every page load; idempotent. */
    fun injectShim(view: WebView) {
        val speechOk = available()
        val shim = """
        (function () {
          if (window.__mwShimInstalled) return;
          window.__mwShimInstalled = true;
          var listeners = {};
          window.__mwSpeech = { emit: function (ev, data) {
            (listeners[ev] || []).forEach(function (cb) { try { cb(data); } catch (_) {} });
          }};
          // Capability flags the board reads for its device messaging.
          window.MyWorldShell = {
            platform: '${platform()}',
            speech: ${if (speechOk) "true" else "false"},
            version: '1.0',
          };
          ${if (speechOk) """
          var SR = {
            available: function () { return Promise.resolve({ available: true }); },
            requestPermissions: function () {
              MyWorldSpeechNative.requestPermission();
              return Promise.resolve({ speechRecognition: MyWorldSpeechNative.hasPermission() ? 'granted' : 'prompt' });
            },
            addListener: function (ev, cb) {
              (listeners[ev] = listeners[ev] || []).push(cb);
              return Promise.resolve({ remove: function () {
                var i = (listeners[ev] || []).indexOf(cb); if (i >= 0) listeners[ev].splice(i, 1);
              }});
            },
            removeAllListeners: function () { listeners = {}; return Promise.resolve(); },
            start: function (opts) {
              opts = opts || {};
              if (!MyWorldSpeechNative.hasPermission()) {
                MyWorldSpeechNative.requestPermission();
                // Throttled 'stopped' keeps the board's restart loop calm until granted.
                setTimeout(function () { window.__mwSpeech.emit('listeningState', { status: 'stopped' }); }, 1200);
                return Promise.resolve();
              }
              MyWorldSpeechNative.start(opts.language || 'en-US', opts.requiresOnDeviceRecognition !== false);
              return Promise.resolve();
            },
            stop: function () { MyWorldSpeechNative.stop(); return Promise.resolve(); },
          };
          window.Capacitor = window.Capacitor || {};
          window.Capacitor.Plugins = window.Capacitor.Plugins || {};
          if (!window.Capacitor.Plugins.SpeechRecognition) window.Capacitor.Plugins.SpeechRecognition = SR;
          """ else "// No speech service on this device (typical on Fire OS) — the board explains."}
        })();
        """.trimIndent()
        view.evaluateJavascript(shim, null)
    }

    init {
        // The JS side calls MyWorldSpeechNative.* synchronously.
        activity.runOnUiThread {
            activity.webView.addJavascriptInterface(this, "MyWorldSpeechNative")
        }
    }
}

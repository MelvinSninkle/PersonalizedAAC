package io.andrewpeterson.myworld.audio

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** One recognized word with arrival time — the rolling caption's unit. */
data class TimedWord(val id: Int, val text: String, val at: Long)

/**
 * Listening Mode engine — port of `Audio/SpeechListener.swift` on Android's
 * SpeechRecognizer. Maintains a ROLLING CAPTION: words append as heard, the
 * in-progress last word is a provisional tail revised in place, older words
 * drop after fadeSeconds (10) or beyond maxWords (18). Sessions auto-restart
 * (Android stops after silence); gives up after 40 restarts. On Fire OS
 * there's no recognition service → `available` is false and the board shows
 * the capability message instead of a dead mic.
 */
class SpeechListener(private val context: Context) {

    private val _words = MutableStateFlow<List<TimedWord>>(emptyList())
    val words: StateFlow<List<TimedWord>> = _words
    private val _liveTail = MutableStateFlow("")
    val liveTail: StateFlow<String> = _liveTail
    private val _status = MutableStateFlow("")
    val status: StateFlow<String> = _status
    /** Bumps on every recognized phrase — the idle-timeout reschedule signal. */
    private val _lastHeardAt = MutableStateFlow(0L)
    val lastHeardAt: StateFlow<Long> = _lastHeardAt

    val available: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)
    val hasPermission: Boolean
        get() = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var restarts = 0
    private var nextId = 1
    /** Words the CURRENT utterance contributed (replaced on every partial). */
    private var currentUtteranceCount = 0
    private var pruneJob: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    companion object {
        const val FADE_SECONDS = 10
        const val MAX_WORDS = 18
        const val MAX_RESTARTS = 40
    }

    fun start() {
        if (listening) return
        if (!available || !hasPermission) {
            _status.value = if (!available)
                "Speech isn't supported on this device" else "Microphone permission needed"
            return
        }
        listening = true
        restarts = 0
        _status.value = "Listening… say a word"
        startSession()
        pruneJob?.cancel()
        pruneJob = scope.launch {
            while (true) { prune(); delay(1_000) }
        }
    }

    fun stop() {
        listening = false
        pruneJob?.cancel(); pruneJob = null
        recognizer?.let { r ->
            try { r.cancel() } catch (_: Exception) {}
            try { r.destroy() } catch (_: Exception) {}
        }
        recognizer = null
        _words.value = emptyList()
        _liveTail.value = ""
        currentUtteranceCount = 0
    }

    // ── Session plumbing ─────────────────────────────────────────────────────

    private fun startSession() {
        if (!listening) return
        recognizer?.let { try { it.destroy() } catch (_: Exception) {} }
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle) {
                val text = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull() ?: return
                applyUtterance(text, final = false)
            }
            override fun onResults(results: Bundle) {
                val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull() ?: ""
                if (text.isNotEmpty()) applyUtterance(text, final = true)
                restartSoon(300)
            }
            override fun onError(error: Int) {
                // Includes the routine no-speech timeout — just restart.
                restartSoon(if (error == SpeechRecognizer.ERROR_NO_MATCH ||
                    error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) 250 else 700)
            }
            override fun onReadyForSpeech(params: Bundle?) { _status.value = "" }
            override fun onBeginningOfSpeech() {}
            override fun onEndOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            // Prefer on-device (private + fast); the OS falls back if absent.
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
        try { r.startListening(intent) } catch (_: Exception) { restartSoon(1_000) }
    }

    private fun restartSoon(afterMs: Long) {
        if (!listening) return
        // A finished utterance's words are now COMMITTED — the next session
        // starts a fresh utterance.
        currentUtteranceCount = 0
        _liveTail.value = ""
        restarts += 1
        if (restarts > MAX_RESTARTS) { _status.value = "Listening paused"; stop(); return }
        scope.launch {
            delay(afterMs)
            startSession()
        }
    }

    // ── Rolling caption model ────────────────────────────────────────────────

    /**
     * Replace the current utterance's contribution with the newest transcript:
     * all words but the last are (provisionally) committed; the last is the
     * faint liveTail still being spoken. A FINAL result commits everything.
     */
    private fun applyUtterance(transcript: String, final: Boolean) {
        val parts = transcript.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (parts.isEmpty()) return
        _lastHeardAt.value = System.currentTimeMillis()
        val commit = if (final) parts else parts.dropLast(1)
        _liveTail.value = if (final) "" else parts.last()

        val now = System.currentTimeMillis()
        val stable = _words.value.dropLast(currentUtteranceCount)
        val fresh = commit.map { TimedWord(nextId++, it, now) }
        currentUtteranceCount = if (final) 0 else fresh.size
        _words.value = (stable + fresh).takeLast(MAX_WORDS)
    }

    /** Fade words older than FADE_SECONDS off the front. */
    private fun prune() {
        val cutoff = System.currentTimeMillis() - FADE_SECONDS * 1_000L
        val kept = _words.value.filter { it.at >= cutoff }
        if (kept.size != _words.value.size) _words.value = kept
    }
}

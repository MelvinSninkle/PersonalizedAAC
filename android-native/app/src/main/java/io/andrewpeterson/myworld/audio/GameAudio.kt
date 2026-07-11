package io.andrewpeterson.myworld.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import io.andrewpeterson.myworld.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Game-mode audio — port of `Audio/GameAudio.swift`: looping background
 * music, event-paced `speakAwait` (the suspend twin of the Swift async
 * speak), and reward cheers. All ElevenLabs speech flows through SpeechCache
 * so a phrase is fetched once ever.
 */
class GameAudio(
    context: Context,
    private val api: ApiClient,
    private val speechCache: SpeechCache,
) {
    private val appContext = context.applicationContext
    private var music: MediaPlayer? = null
    private var voice: MediaPlayer? = null
    private var ttsReady = false
    private val tts: TextToSpeech = TextToSpeech(appContext) { status ->
        ttsReady = status == TextToSpeech.SUCCESS
        if (ttsReady) tts.language = Locale.US
    }

    companion object {
        const val DEFAULT_MUSIC = "/audio/color-tap-learn.mp3"
        val CHEERS = listOf("Great job!", "You did it!", "Awesome!", "Hooray!", "Way to go!")
    }

    // ── Background music ────────────────────────────────────────────────────

    /** Start looping game music (server path like /audio/x.mp3). */
    suspend fun startMusic(path: String? = null) {
        stopMusic()
        val p = path?.takeIf { it.isNotEmpty() } ?: DEFAULT_MUSIC
        val bytes = try { api.raw("GET", p) } catch (_: Exception) { return }
        val f = File(appContext.cacheDir, "music-${p.hashCode()}.mp3")
        try { if (!f.exists() || f.length() == 0L) f.writeBytes(bytes) } catch (_: Exception) { return }
        try {
            music = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                setDataSource(f.path)
                isLooping = true
                setVolume(0.25f, 0.25f)
                prepare(); start()
            }
        } catch (_: Exception) {}
    }

    fun stopMusic() {
        try { music?.stop(); music?.release() } catch (_: Exception) {}
        music = null
    }

    // ── Speech ──────────────────────────────────────────────────────────────

    /** Fire-and-forget speak in the child's voice (recorded TTS, else local). */
    fun speak(text: String, childId: String = "") {
        kotlinx.coroutines.CoroutineScope(Dispatchers.Main.immediate).launchSpeak(text, childId)
    }
    private fun kotlinx.coroutines.CoroutineScope.launchSpeak(text: String, childId: String) =
        kotlinx.coroutines.launch { speakAwait(text, childId) }

    /**
     * EVENT-PACED speech: suspends until the audio finishes — the backbone of
     * TeachShow pacing and game prompts (port of the Swift `speakAwait`).
     */
    suspend fun speakAwait(text: String, childId: String = "", emotion: String = "default") {
        if (text.isBlank()) return
        val mp3 = speechCache.mp3(text, childId, emotion)
        if (mp3 != null && playFileAwait(mp3)) return
        speakLocalAwait(text)
    }

    suspend fun playFileAwait(f: File): Boolean =
        withContext(Dispatchers.Main.immediate) {
            suspendCancellableCoroutine { cont ->
                try {
                    voice?.release()
                    val p = MediaPlayer()
                    voice = p
                    p.setAudioAttributes(AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    p.setDataSource(f.path)
                    p.setOnCompletionListener { if (cont.isActive) cont.resume(true) }
                    p.setOnErrorListener { _, _, _ -> if (cont.isActive) cont.resume(false); true }
                    cont.invokeOnCancellation { try { p.stop(); p.release() } catch (_: Exception) {} }
                    p.prepare(); p.start()
                } catch (_: Exception) {
                    if (cont.isActive) cont.resume(false)
                }
            }
        }

    private suspend fun speakLocalAwait(text: String) {
        if (!ttsReady) return
        suspendCancellableCoroutine { cont ->
            val id = "ga-${System.nanoTime()}"
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) {
                    if (utteranceId == id && cont.isActive) cont.resume(Unit)
                }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    if (utteranceId == id && cont.isActive) cont.resume(Unit)
                }
            })
            cont.invokeOnCancellation { try { tts.stop() } catch (_: Exception) {} }
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        }
    }

    /** A random reward cheer, spoken in the child's voice. */
    suspend fun playCheer(childId: String = "", phrases: List<String> = CHEERS) {
        val phrase = phrases.randomOrNull() ?: return
        speakAwait(phrase, childId, emotion = "excited")
    }

    fun stopAll() {
        stopMusic()
        try { voice?.stop(); voice?.release() } catch (_: Exception) {}
        voice = null
        try { tts.stop() } catch (_: Exception) {}
    }
}

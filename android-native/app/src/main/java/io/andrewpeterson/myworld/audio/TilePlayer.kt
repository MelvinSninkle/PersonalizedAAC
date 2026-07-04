package io.andrewpeterson.myworld.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.storage.MediaCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Plays a tile's audio — the Android twin of `Audio/TilePlayer.swift`.
 * Three-level fallback: cached soundKey mp3 → local TextToSpeech → no-op.
 *
 * FREE-TAP CALLERS on the board MUST pass childId so the tap lands in the
 * events table (Top Words / Use / Word History / mastery all feed off it) —
 * and the payload MUST be the `{ childId, events: [ {...} ] }` shape.
 * GAME/SLIDESHOW callers deliberately omit childId (they log richer
 * game_attempts via /api/game-log; never double-count).
 */
class TilePlayer(
    context: Context,
    private val api: ApiClient,
    private val media: MediaCache,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var player: MediaPlayer? = null
    private var ttsReady = false
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ttsReady = status == TextToSpeech.SUCCESS
        if (ttsReady) tts.language = Locale.US
    }

    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun play(
        tile: Tile,
        childId: String? = null,
        categoryName: String? = null,
        subcategoryName: String? = null,
    ) {
        // Log the tap (fire-and-forget; UI never waits on analytics).
        if (!childId.isNullOrEmpty()) {
            val event = buildString {
                append("{\"role\":\"student\"")
                append(",\"itemId\":").append(tile.id)
                append(",\"section\":").append(SpeechCache.jsonQuote(tile.section.raw))
                append(",\"label\":").append(SpeechCache.jsonQuote(tile.label))
                categoryName?.let { append(",\"categoryName\":").append(SpeechCache.jsonQuote(it)) }
                subcategoryName?.let { append(",\"subcategoryName\":").append(SpeechCache.jsonQuote(it)) }
                append(",\"occurredAt\":").append(SpeechCache.jsonQuote(iso.format(Date())))
                append('}')
            }
            val body = "{\"childId\":${SpeechCache.jsonQuote(childId)},\"events\":[$event]}"
            scope.launch(Dispatchers.IO) { api.postSilently("/api/events", body) }
        }

        scope.launch {
            // 1) Recorded audio (the exact voice the parent picked).
            val key = tile.soundKey
            if (!key.isNullOrEmpty()) {
                val f = media.audioFile(key)
                if (f != null && playFile(f.path)) return@launch
            }
            // 2) Local TTS — no network needed.
            speak(tile.label)
        }
    }

    fun playFile(path: String): Boolean = try {
        player?.release()
        player = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            setDataSource(path)
            prepare()
            start()
        }
        true
    } catch (_: Exception) { false }

    fun speak(text: String) {
        if (!ttsReady || text.isBlank()) return
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "tile-${text.hashCode()}")
    }

    fun stop() {
        try { player?.stop() } catch (_: Exception) {}
        try { tts.stop() } catch (_: Exception) {}
    }
}

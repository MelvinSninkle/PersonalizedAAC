package io.andrewpeterson.myworld.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import io.andrewpeterson.myworld.access.TouchConfig
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
    /** Set by AppContainer after construction — used only for double-tap
     *  teach (clue speech rides the game voice channel, same as web). */
    var gameAudio: GameAudio? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var player: MediaPlayer? = null

    // Double-tap-teach bookkeeping (mirrors the web board's tapSpeak).
    private var lastTapTileId: Int? = null
    private var lastTapAt = 0L
    private val doubleTapWindowMs = 2500L
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
        // Touch controls apply only to logged board taps (childId present) —
        // game/slideshow playback is never gated. Mirrors web tapSpeak: the
        // double-tap-teach check runs BEFORE the interrupt gate, so a second
        // tap teaches even while the first word is still playing.
        if (!childId.isNullOrEmpty()) {
            val now = System.currentTimeMillis()
            val clues = if (tile.displayLabel == null)   // clues are English taxonomy prose
                (tile.descriptiveClues ?: emptyList()).filter { it.isNotBlank() }.take(3)
            else emptyList()
            if (TouchConfig.doubleTapTeach && tile.id == lastTapTileId &&
                (now - lastTapAt) < doubleTapWindowMs && clues.isNotEmpty()
            ) {
                lastTapTileId = null
                logTap(tile, childId, categoryName, subcategoryName)
                stop()
                val ga = gameAudio
                if (ga != null) {
                    scope.launch { for (c in clues) ga.speakAwait(c, childId) }
                } else {
                    clues.forEachIndexed { i, c ->
                        if (!ttsReady) return@forEachIndexed
                        val mode = if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
                        tts.speak(c, mode, null, "clue-$i-${c.hashCode()}")
                    }
                }
                return
            }
            lastTapTileId = tile.id
            lastTapAt = now
            if (isBusy() && !TouchConfig.interrupt) return   // not logged — the tap was ignored
        }

        // Log the tap (fire-and-forget; UI never waits on analytics).
        if (!childId.isNullOrEmpty()) {
            logTap(tile, childId, categoryName, subcategoryName)
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

    /** The server expects { childId, events: [ {...} ] } — a bare event
     *  object hits the 400 'events array required' branch silently. */
    private fun logTap(tile: Tile, childId: String, categoryName: String?, subcategoryName: String?) {
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

    /** Something audible in flight? (MediaPlayer throws after release —
     *  treat that as not playing.) */
    private fun isBusy(): Boolean {
        val filePlaying = try { player?.isPlaying == true } catch (_: Exception) { false }
        return filePlaying || (ttsReady && tts.isSpeaking)
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

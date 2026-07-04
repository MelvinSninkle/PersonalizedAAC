package io.andrewpeterson.myworld.audio

import android.content.Context
import io.andrewpeterson.myworld.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * On-disk ElevenLabs TTS cache — the Android twin of `Audio/SpeechCache.swift`.
 * Key = sha256("childId|emotion|text") (the SAME scheme the iOS app and server
 * use), so a phrase is fetched once per device ever; the server's own Blob
 * cache means ElevenLabs is hit once per phrase per voice EVER.
 */
class SpeechCache(context: Context, private val api: ApiClient) {

    private val dir = File(context.filesDir, "speech").apply { mkdirs() }

    private fun keyFor(childId: String, emotion: String, text: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$childId|$emotion|$text".toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    /** The cached mp3 for a phrase, synthesizing it once if missing. */
    suspend fun mp3(text: String, childId: String = "", emotion: String = "default"): File? =
        withContext(Dispatchers.IO) {
            if (text.isBlank()) return@withContext null
            val f = File(dir, "${keyFor(childId, emotion, text)}.mp3")
            if (f.exists() && f.length() > 0) return@withContext f
            try {
                val body = buildString {
                    append("{\"text\":").append(jsonQuote(text))
                    append(",\"emotion\":").append(jsonQuote(emotion))
                    if (childId.isNotEmpty()) append(",\"childId\":").append(jsonQuote(childId))
                    append('}')
                }
                val bytes = api.raw("POST", "/api/tts", body.encodeToByteArray())
                val tmp = File(dir, "${f.name}.tmp")
                tmp.writeBytes(bytes)
                tmp.renameTo(f)
                f
            } catch (_: Exception) { null }
        }

    suspend fun warm(phrases: List<String>, childId: String = "", emotion: String = "default") {
        for (p in phrases) mp3(p, childId, emotion)
    }

    fun clear() { dir.deleteRecursively(); dir.mkdirs() }

    companion object {
        fun jsonQuote(s: String): String = buildString {
            append('"')
            for (ch in s) when (ch) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch.code < 0x20) append("\\u%04x".format(ch.code)) else append(ch)
            }
            append('"')
        }
    }
}

package io.andrewpeterson.myworld.storage

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import io.andrewpeterson.myworld.net.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import java.io.File

/**
 * Filesystem cache for board media (images + tile mp3s), keyed by server blob
 * key — the Android twin of kid-ios `Storage/MediaCache.swift`:
 *   · file name = DJB2 hash of the key (same scheme), flat dir `files/media/`
 *   · in-flight de-dupe so concurrent requests fetch once
 *   · `warm()` bulk prefetch with bounded concurrency (6, matching iOS)
 * Images and sounds share the cache; images decode to Bitmap on demand.
 */
class MediaCache(context: Context, private val api: ApiClient) {

    private val dir = File(context.filesDir, "media").apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val inFlight = mutableMapOf<String, Deferred<File?>>()
    private val lock = Mutex()
    private val warmGate = Semaphore(6)

    private fun djb2(s: String): String {
        var h = 5381L
        for (ch in s) h = ((h shl 5) + h + ch.code) and 0xFFFFFFFFL
        return h.toString(16)
    }

    private fun fileFor(key: String) = File(dir, "${djb2(key)}.bin")

    /** The cached file for a blob key, fetching it once if missing. */
    suspend fun file(key: String): File? {
        if (key.isEmpty()) return null
        val f = fileFor(key)
        if (f.exists() && f.length() > 0) return f
        val task = lock.withLock {
            inFlight.getOrPut(key) {
                scope.async {
                    try {
                        val bytes = api.raw("GET", "/api/media?key=${api.esc(key)}")
                        val tmp = File(dir, "${f.name}.tmp")
                        tmp.writeBytes(bytes)
                        tmp.renameTo(f)
                        f
                    } catch (_: Exception) { null }
                }
            }
        }
        val out = task.await()
        lock.withLock { inFlight.remove(key) }
        return out
    }

    suspend fun bitmap(key: String): Bitmap? {
        val f = file(key) ?: return null
        return try { BitmapFactory.decodeFile(f.path) } catch (_: Exception) { null }
    }

    /** File URL for AVAudioPlayer-style playback (MediaPlayer/ExoPlayer). */
    suspend fun audioFile(key: String): File? = file(key)

    /** Bulk prefetch, bounded concurrency — the whole board ready up front. */
    suspend fun warm(keys: List<String>) {
        val jobs = keys.filter { it.isNotEmpty() }.map { key ->
            scope.async { warmGate.withPermit { file(key) } }
        }
        jobs.forEach { it.await() }
    }

    fun clear() {
        dir.deleteRecursively()
        dir.mkdirs()
    }
}

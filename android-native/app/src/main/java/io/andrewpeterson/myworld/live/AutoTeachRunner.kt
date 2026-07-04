package io.andrewpeterson.myworld.live

import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.autoTeachNext
import io.andrewpeterson.myworld.net.tickExposure
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.TimeZone
import kotlin.random.Random

/**
 * Board-side auto-teach poller — port of `Live/AutoTeachRunner.swift`. Polls
 * /api/auto-teach/next every ~5 minutes (the SERVER owns every gate); a "go"
 * is STAGED behind the countdown card, and firing ticks every batch slug with
 * the auto source (this arms the server's cooldown/budget/one-game-per-day).
 * Reports the device IANA timezone so gates run in FAMILY time.
 */
class AutoTeachRunner(private val api: ApiClient) {

    data class Staged(
        val mode: String,               // "exposure" | "game"
        val slugs: List<String>,
        val secondsPerImage: Double,
        val labelStyle: String,
        val sessionMaxMin: Double,
        val source: String,             // "auto_slideshow" | "auto_game"
    )

    private val _staged = MutableStateFlow<Staged?>(null)
    val staged: StateFlow<Staged?> = _staged

    var lastReason: String? = null
        private set

    private var pollJob: Job? = null
    private var childId = ""
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun start(childId: String) {
        if (this.childId == childId && pollJob != null) return
        this.childId = childId
        pollJob?.cancel()
        pollJob = scope.launch {
            // Stagger the first poll so two devices don't race the same minute.
            delay((15_000 + Random.nextLong(45_000)))
            while (true) {
                tick()
                delay(5 * 60 * 1000)
            }
        }
    }

    fun stop() {
        pollJob?.cancel(); pollJob = null
        _staged.value = null
    }

    /**
     * The countdown fired (or a grown-up skipped). On fire, tick every batch
     * slug with the auto source — that's what arms the server gates.
     */
    fun consumeStaged(fired: Boolean) {
        val s = _staged.value ?: return
        _staged.value = null
        if (!fired) { lastReason = "skipped_by_adult"; return }
        val id = childId
        scope.launch(Dispatchers.IO) {
            for (slug in s.slugs) api.tickExposure(id, slug, s.source)
        }
    }

    private suspend fun tick() {
        if (_staged.value != null) return
        if (trigger("exposure")) return
        trigger("game")
    }

    private suspend fun trigger(mode: String): Boolean {
        val tz = TimeZone.getDefault().id
        val resp = try { api.autoTeachNext(childId, mode, tz) } catch (_: Exception) { return false }
        lastReason = if (resp.ok) "ok:$mode" else (resp.reason ?: "denied")
        val tiles = resp.tiles
        val session = resp.session
        if (!resp.ok || tiles.isNullOrEmpty() || session == null) return false
        _staged.value = Staged(
            mode = mode,
            slugs = tiles.map { it.slug },
            secondsPerImage = session.microSec,
            labelStyle = session.labelStyle,
            sessionMaxMin = session.sessionMaxMin,
            source = session.source,
        )
        return true
    }
}

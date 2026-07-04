package io.andrewpeterson.myworld.live

import io.andrewpeterson.myworld.net.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The board-side live channel — port of `Live/LiveSession.swift`:
 *   1. Poll /api/live (~1s) for facilitator commands → `latest` (seq-deduped,
 *      BASELINED on boot so a stale `start` never relaunches a game).
 *   2. Publish presence + state (~3s heartbeat) so the facilitator phone
 *      shows "Connected" and live progress.
 */
class LiveSession(private val api: ApiClient) {

    private val _latest = MutableStateFlow<LiveCommand?>(null)
    val latest: StateFlow<LiveCommand?> = _latest

    private var handledSeq = 0
    private var baselined = false
    private var pollJob: Job? = null
    private var heartbeatJob: Job? = null
    private var childId = ""
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var publishStatus = "standby"
    private var publishPayload: LivePayload? = null

    fun start(childId: String) {
        this.childId = childId
        handledSeq = 0
        baselined = false
        pollJob?.cancel()
        heartbeatJob?.cancel()
        pollJob = scope.launch {
            while (true) { pollOnce(); delay(1_000) }
        }
        heartbeatJob = scope.launch {
            while (true) { beat(); delay(3_000) }
        }
    }

    fun stop() {
        pollJob?.cancel(); pollJob = null
        heartbeatJob?.cancel(); heartbeatJob = null
        val id = childId
        scope.launch(Dispatchers.IO) { publish(id, "idle", null) }
    }

    /** Board up, no game — "Tablet is listening, tap Start". */
    fun setStandby() {
        publishStatus = "standby"; publishPayload = null
        scope.launch { beat() }
    }

    /** A game is on screen; push target/progress to the phone. */
    fun setRunning(payload: LivePayload) {
        publishStatus = "running"; publishPayload = payload
        scope.launch { beat() }
    }

    fun setEnded(payload: LivePayload?) {
        publishStatus = "ended"; publishPayload = payload
        scope.launch { beat() }
    }

    /** Acknowledge so the same command isn't re-applied on next poll. */
    fun acknowledge() { _latest.value = null }

    private suspend fun pollOnce() {
        val status: LiveStatus = try {
            api.getJson("/api/live?childId=${api.esc(childId)}")
        } catch (_: Exception) { return }
        if (!baselined) {
            handledSeq = maxOf(handledSeq, status.cmdSeq)
            baselined = true
            return
        }
        val cmd = status.cmd ?: return
        if (cmd.seq <= handledSeq) return
        handledSeq = cmd.seq
        _latest.value = cmd
    }

    private suspend fun beat() = publish(childId, publishStatus, publishPayload)

    private suspend fun publish(childId: String, status: String, payload: LivePayload?) {
        if (childId.isEmpty()) return
        try {
            val body = buildJsonObject {
                put("kind", "state")
                put("status", status)
                if (payload != null) {
                    put("payload", ApiClient.json.encodeToJsonElement(LivePayload.serializer(), payload))
                }
            }
            api.raw("POST", "/api/live?childId=${api.esc(childId)}", body.toString().encodeToByteArray())
        } catch (_: Exception) { /* heartbeat is best-effort */ }
    }
}

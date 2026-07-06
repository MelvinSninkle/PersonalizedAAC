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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Parent-phone side of the live channel — port of `Parent/ParentLive.swift`:
 * polls /api/live every 1.5s → `tabletOnline` (status != idle && age < 8s)
 * and `isRunning` (auto-pops the facilitator console).
 */
class ParentLive(private val api: ApiClient) {

    private val _status = MutableStateFlow<LiveStatus?>(null)
    val status: StateFlow<LiveStatus?> = _status
    private val _tabletOnline = MutableStateFlow(false)
    val tabletOnline: StateFlow<Boolean> = _tabletOnline
    private val _isRunning = MutableStateFlow(false)
    val isRunning: StateFlow<Boolean> = _isRunning

    private var pollJob: Job? = null
    private var childId = ""
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun start(childId: String) {
        this.childId = childId
        pollJob?.cancel()
        pollJob = scope.launch {
            while (true) {
                poll()
                delay(1_500)
            }
        }
    }

    fun stop() { pollJob?.cancel(); pollJob = null }

    private suspend fun poll() {
        val s: LiveStatus = try {
            api.getJson("/api/live?childId=${api.esc(childId)}")
        } catch (_: Exception) { return }
        _status.value = s
        _tabletOnline.value = s.status != "idle" && (s.age ?: Int.MAX_VALUE) < 8
        _isRunning.value = s.status == "running"
    }

    /** Publish a facilitator command ({kind:'cmd', ...fields}). */
    suspend fun sendCommand(fields: Map<String, JsonElement>) {
        try {
            val body = buildJsonObject {
                put("kind", "cmd")
                for ((k, v) in fields) put(k, v)
            }
            api.raw("POST", "/api/live?childId=${api.esc(childId)}", body.toString().encodeToByteArray())
        } catch (_: Exception) { /* commands are retried by the human */ }
    }
}

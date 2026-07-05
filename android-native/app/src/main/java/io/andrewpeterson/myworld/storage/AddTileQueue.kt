package io.andrewpeterson.myworld.storage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.TileJobStatus
import io.andrewpeterson.myworld.net.createTileJob
import io.andrewpeterson.myworld.net.deleteTileJob
import io.andrewpeterson.myworld.net.listTileJobs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The add-tile authoring queue — port of `Storage/AddTileQueue.swift`.
 * Durability lives SERVER-SIDE (/api/tile-jobs): the photo is safe the
 * instant the upload returns; this class enqueues, polls status (~3s while
 * anything is in flight), surfaces tray cards + the batch-review notice, and
 * restores in-flight jobs from the server after an app restart.
 */
class AddTileQueue(
    private val api: ApiClient,
    private val board: BoardStore,
) {
    enum class Phase { WORKING, DONE, FAILED }

    data class TileJob(
        val id: Long,
        val label: String,
        val section: String,
        val categoryId: Int?,
        val phase: Phase,
        val thumbnail: Bitmap? = null,
        val error: String? = null,
        val needsReview: Boolean = false,
        val itemId: Long? = null,
    )

    data class ReviewNotice(val count: Int)

    private val _jobs = MutableStateFlow<List<TileJob>>(emptyList())
    val jobs: StateFlow<List<TileJob>> = _jobs
    private val _pendingReviewNotice = MutableStateFlow<ReviewNotice?>(null)
    val pendingReviewNotice: StateFlow<ReviewNotice?> = _pendingReviewNotice

    private val thumbnails = mutableMapOf<Long, Bitmap>()
    // Enqueue-time placement (the list endpoint doesn't echo section/folder) —
    // lets the spinner cell render in the column the photo was added to.
    private val placements = mutableMapOf<Long, Pair<String, Int?>>()
    private var pollJob: Job? = null
    private var childId = ""
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun clearReviewNotice() { _pendingReviewNotice.value = null }

    /** Drop a failed job's card (also clears it server-side, best effort). */
    fun dismiss(id: Long) {
        _jobs.value = _jobs.value.filterNot { it.id == id }
        thumbnails.remove(id)
        placements.remove(id)
        val cid = childId
        if (cid.isNotEmpty()) scope.launch {
            try { api.deleteTileJob(id, cid) } catch (_: Exception) {}
        }
    }

    /** Enqueue a capture. Returns the durable job id (or null on failure). */
    suspend fun enqueue(
        childId: String,
        jpeg: ByteArray,
        label: String,
        detail: String,
        section: String,
        categoryId: Int?,
        raw: Boolean,
        relationship: String? = null,
    ): Long? {
        this.childId = childId
        return try {
            val created = api.createTileJob(childId, jpeg, label, detail, section, categoryId, raw, relationship)
            placements[created.id] = section to categoryId
            withContext(Dispatchers.Default) {
                BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
            }?.let { thumbnails[created.id] = it }
            startPolling(childId)
            created.id
        } catch (e: Exception) {
            null
        }
    }

    /** Resume watching jobs the server still has after an app restart. */
    fun restore(childId: String) {
        this.childId = childId
        startPolling(childId)
    }

    private fun startPolling(childId: String) {
        if (pollJob?.isActive == true) return
        pollJob = scope.launch {
            var doneStreak = 0
            var lastDoneCount = -1
            while (doneStreak < 3) {
                val statuses: List<TileJobStatus> = try {
                    api.listTileJobs(childId)
                } catch (_: Exception) { emptyList() }
                val mapped = statuses.map { s ->
                    val place = placements[s.id]
                    TileJob(
                        id = s.id,
                        label = s.label ?: "",
                        section = place?.first ?: "",
                        categoryId = place?.second,
                        phase = when (s.status) {
                            "done" -> Phase.DONE
                            "failed" -> Phase.FAILED
                            else -> Phase.WORKING
                        },
                        thumbnail = thumbnails[s.id],
                        error = s.error,
                        needsReview = s.needsReview,
                        itemId = s.itemId,
                    )
                }
                _jobs.value = mapped

                val working = mapped.count { it.phase == Phase.WORKING }
                val doneReview = mapped.count { it.phase == Phase.DONE && it.needsReview }
                if (working == 0) {
                    doneStreak++
                    // A finished multi-photo batch → the review banner (once).
                    if (doneReview > 1 && doneReview != lastDoneCount) {
                        _pendingReviewNotice.value = ReviewNotice(doneReview)
                        lastDoneCount = doneReview
                    }
                } else {
                    doneStreak = 0
                }
                // Fresh tiles pop onto the board as each render lands.
                val doneCount = mapped.count { it.phase == Phase.DONE }
                if (doneCount != lastDoneCount && working > 0) {
                    board.refresh(childId)
                }
                delay(3_000)
            }
            board.refresh(childId)
        }
    }
}

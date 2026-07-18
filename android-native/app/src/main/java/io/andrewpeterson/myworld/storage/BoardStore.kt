package io.andrewpeterson.myworld.storage

import android.content.Context
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.model.Category
import io.andrewpeterson.myworld.model.Entitlement
import io.andrewpeterson.myworld.model.SyncResponse
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.net.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import java.io.File

/**
 * In-memory board state for the signed-in child — the Android twin of
 * `Storage/BoardStore.swift`. Hydrates from `files/board.json` on cold launch
 * (instant paint), merges fresh `/api/sync` on top, keeps stale data on
 * network failure so the kid's board never wipes over a hiccup.
 */
class BoardStore(context: Context, private val api: ApiClient, private val media: MediaCache) {

    private val cacheFile = File(context.filesDir, "board.json")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _categories = MutableStateFlow<List<Category>>(emptyList())
    val categories: StateFlow<List<Category>> = _categories
    private val _tiles = MutableStateFlow<List<Tile>>(emptyList())
    val tiles: StateFlow<List<Tile>> = _tiles
    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading
    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError
    private val _entitlement = MutableStateFlow<Entitlement?>(null)
    val entitlement: StateFlow<Entitlement?> = _entitlement
    /** Listening display filter (E8): bad-word list from the last sync;
     *  persisted with the board cache so offline keeps filtering. */
    private val _listenBlocklist = MutableStateFlow<Set<String>>(emptySet())
    val listenBlocklist: StateFlow<Set<String>> = _listenBlocklist

    /** Unknown = permissive; the server enforces regardless (iOS parity). */
    val sttAllowed: Boolean get() = _entitlement.value?.stt ?: true
    val stylingAllowed: Boolean get() = _entitlement.value?.styling ?: true

    init { hydrateFromDisk() }

    // ── Queries (BoardStore.swift parity) ───────────────────────────────────

    private val orderCmp = compareBy<Category>({ it.order }, { it.id })

    fun roots(section: BoardSection): List<Category> =
        _categories.value.filter { it.section == section && it.parentId == null }.sortedWith(orderCmp)

    fun children(of: Category): List<Category> =
        _categories.value.filter { it.parentId == of.id }.sortedWith(orderCmp)

    fun tilesIn(category: Category): List<Tile> =
        _tiles.value.filter { it.categoryId == category.id }
            .sortedWith(compareByDescending<Tile> { it.pinned }.thenBy { it.order }.thenBy { it.id })

    fun persistentStrip(): List<Tile> =
        _tiles.value.filter { it.pinned }.sortedWith(compareBy({ it.order }, { it.id }))

    /**
     * Resolve a facilitator scope string — the vocabulary the web console and
     * auto-teach emit: "all" | section | "slugs:a,b,c" | "cat:<id>" (that
     * category + all descendants). from/to (1-based inclusive) slice.
     */
    fun tilesForScope(scope: String?, from: Int? = null, to: Int? = null): List<Tile> {
        val s = scope ?: "all"
        val cats = _categories.value
        var result: List<Tile> = when {
            s == "all" -> _tiles.value
            BoardSection.entries.any { it.raw == s } ->
                _tiles.value.filter { it.section.raw == s }
            s.startsWith("slugs:") -> {
                val wanted = s.removePrefix("slugs:").split(',').map { it.trim() }.toSet()
                _tiles.value.filter { it.taxonomySlug != null && it.taxonomySlug in wanted }
            }
            s.startsWith("cat:") -> {
                val rootId = s.removePrefix("cat:").toIntOrNull()
                if (rootId == null) _tiles.value else {
                    // The folder's OWN tiles are the session — a small folder
                    // makes a short session, never a scope switch (web
                    // parity). Only a pure CONTAINER folder (no direct
                    // playable tiles) widens to its descendants.
                    val direct = _tiles.value.filter { it.categoryId == rootId }
                    if (direct.any { !it.imageKey.isNullOrEmpty() && it.label.isNotEmpty() }) direct
                    else {
                        val ids = mutableSetOf(rootId)
                        var frontier = listOf(rootId)
                        while (frontier.isNotEmpty()) {
                            val next = cats.filter { it.parentId in frontier }.map { it.id }
                            val fresh = next.filter { it !in ids }
                            ids.addAll(fresh)
                            frontier = fresh
                        }
                        _tiles.value.filter { it.categoryId in ids }
                    }
                }
            }
            else -> _tiles.value
        }
        result = result.sortedWith(compareBy({ it.order }, { it.id }))
        if ((from ?: 0) > 0 || (to ?: 0) > 0) {
            val lo = minOf((from ?: 1) - 1, result.size).coerceAtLeast(0)
            val hi = minOf(to ?: result.size, result.size)
            if (lo < hi) result = result.subList(lo, hi)
        }
        return result
    }

    // ── Sync ────────────────────────────────────────────────────────────────

    /** Fetch the latest board; silently keeps stale data on failure. */
    /** Apply a drag-reorder locally (i*1000 across ids) so the grid settles
     *  the instant the finger lifts; the server sync runs in the background
     *  and the next refresh confirms. Ids not present are ignored. */
    fun applyLocalTileOrder(ids: List<Int>) {
        val pos = ids.withIndex().associate { (i, id) -> id to i * 1000 }
        _tiles.value = _tiles.value.map { t -> pos[t.id]?.let { t.copy(order = it) } ?: t }
    }

    /** Same, for category/subcategory chip reorders. */
    fun applyLocalCategoryOrder(ids: List<Int>) {
        val pos = ids.withIndex().associate { (i, id) -> id to i * 1000 }
        _categories.value = _categories.value.map { c -> pos[c.id]?.let { c.copy(order = it) } ?: c }
    }

    suspend fun refresh(childId: String) {
        _loading.value = true
        try {
            val resp: SyncResponse = api.getJson("/api/sync?childId=${api.esc(childId)}")
            _categories.value = resp.categories
            _tiles.value = resp.items
            resp.entitlement?.let { _entitlement.value = it }
            resp.listenBlocklist?.takeIf { it.isNotEmpty() }?.let { _listenBlocklist.value = it.toSet() }
            _lastError.value = null
            persistToDisk(resp)
            precacheMedia()
        } catch (e: Exception) {
            _lastError.value = e.message
        } finally {
            _loading.value = false
        }
    }

    /**
     * Download every tile+category image (then every sound) up front in board
     * order — a kid can't be left without words while a folder lazily loads.
     */
    fun precacheMedia() {
        val sections = listOf(BoardSection.PEOPLE, BoardSection.NOUNS, BoardSection.VERBS, BoardSection.NEEDS)
        val imageKeys = mutableListOf<String>()
        for (section in sections) {
            imageKeys += _categories.value.filter { it.section == section }
                .sortedWith(orderCmp).mapNotNull { it.imageKey }
            imageKeys += _tiles.value.filter { it.section == section }
                .sortedWith(compareBy({ it.order }, { it.id })).mapNotNull { it.imageKey }
        }
        val soundKeys = _tiles.value.mapNotNull { it.soundKey }
        scope.launch(Dispatchers.IO) {
            media.warm(imageKeys)   // images first — the child needs to SEE words
            media.warm(soundKeys)
        }
    }

    // ── Persistence ─────────────────────────────────────────────────────────

    private fun hydrateFromDisk() {
        val resp = try {
            ApiClient.json.decodeFromString<SyncResponse>(cacheFile.readText())
        } catch (_: Exception) { return }
        _categories.value = resp.categories
        _tiles.value = resp.items
        _entitlement.value = resp.entitlement
        resp.listenBlocklist?.takeIf { it.isNotEmpty() }?.let { _listenBlocklist.value = it.toSet() }
        precacheMedia()
    }

    private suspend fun persistToDisk(resp: SyncResponse) = withContext(Dispatchers.IO) {
        try {
            val tmp = File(cacheFile.parentFile, "board.json.tmp")
            tmp.writeText(ApiClient.json.encodeToString(resp))
            tmp.renameTo(cacheFile)
        } catch (_: Exception) { /* cache write is best-effort */ }
    }
}

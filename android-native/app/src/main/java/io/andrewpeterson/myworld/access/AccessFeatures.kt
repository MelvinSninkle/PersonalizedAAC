package io.andrewpeterson.myworld.access

import io.andrewpeterson.myworld.audio.GameAudio
import io.andrewpeterson.myworld.model.BoardSection
import io.andrewpeterson.myworld.model.Category
import io.andrewpeterson.myworld.model.Tile
import io.andrewpeterson.myworld.model.display
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.childSettings
import io.andrewpeterson.myworld.storage.BoardStore
import io.andrewpeterson.myworld.storage.MediaCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Access experiments (admin dark-launch) — port of the web board's
 * accessibility features and `kid-ios/Models/AccessFeatures.swift`. The
 * settings are READ-ONLY here: only admins can write them (server-enforced
 * in api/child-settings.js); the keys live at the settings ROOT, so this
 * reads the raw child-settings blob rather than riding kidDisplay.
 */
/**
 * Touch controls (parent-set, NOT admin-gated — ordinary board settings).
 * A plain object so TilePlayer can read them without a view/store handle.
 *   interrupt      — a new tap cuts off audio that's still playing. OFF by
 *                    default: a child stimming on one button hears each
 *                    word complete instead of machine-gun restarts.
 *   doubleTapTeach — the SAME tile tapped again within the window speaks
 *                    its teaching facts (descriptive clues, up to three).
 */
object TouchConfig {
    @Volatile var interrupt = false
    @Volatile var doubleTapTeach = false
    // Safety controls (synced, for older/capable kids):
    //   easyClose  — game ✕ closes on a quick tap instead of the long-press.
    //   easyUnlock — the lock opens edit mode without the unlock sheet.
    @Volatile var easyClose = false
    @Volatile var easyUnlock = false
}

data class AccessData(
    val navMode: String = "scroll",            // "scroll" | "buttons"
    val sentenceBuilder: Boolean = false,
    val sentenceIdleMin: Int = 1,              // 1–10 minutes
    val sentenceLift: String = "longpress",    // "longpress" | "drag"
    val listenRepeatNav: Boolean = true,
) {
    val buttonsNav: Boolean get() = navMode == "buttons"
}

class AccessPrefs(private val api: ApiClient, private val scope: CoroutineScope) {
    private val _data = MutableStateFlow(AccessData())
    val data: StateFlow<AccessData> = _data
    private var childId: String? = null

    fun attach(childId: String) {
        if (this.childId == childId) return
        this.childId = childId
        refresh()
    }

    fun refresh() {
        val id = childId ?: return
        scope.launch {
            val s = api.childSettings(id)
            fun str(k: String) = (s[k] as? JsonPrimitive)?.contentOrNull
            fun bool(k: String) = (s[k] as? JsonPrimitive)?.booleanOrNull
            fun int(k: String) = (s[k] as? JsonPrimitive)?.intOrNull
            _data.value = AccessData(
                navMode = if (str("navMode") == "buttons") "buttons" else "scroll",
                sentenceBuilder = bool("sentenceBuilder") ?: false,
                sentenceIdleMin = (int("sentenceIdleMin") ?: 1).coerceIn(1, 10),
                sentenceLift = if (str("sentenceLift") == "drag") "drag" else "longpress",
                listenRepeatNav = bool("listenRepeatNav") ?: true,
            )
            // Touch + safety controls ride the same settings fetch (root keys too).
            TouchConfig.interrupt = bool("tapInterrupt") ?: false
            TouchConfig.doubleTapTeach = bool("doubleTapTeach") ?: false
            TouchConfig.easyClose = bool("easyClose") ?: false
            TouchConfig.easyUnlock = bool("easyUnlock") ?: false
        }
    }
}

/**
 * Hoisted board selection — SectionColumn's chip selection lives here (it
 * was per-column local state) so listening mode's repeat-navigate can drive
 * the board from the header. Also carries the transient tile highlight.
 */
class BoardNav(private val scope: CoroutineScope) {
    data class Highlight(val tileId: Int, val section: BoardSection)

    private val _cat = MutableStateFlow<Map<BoardSection, Int?>>(emptyMap())
    val cat: StateFlow<Map<BoardSection, Int?>> = _cat
    private val _sub = MutableStateFlow<Map<BoardSection, Int?>>(emptyMap())
    val sub: StateFlow<Map<BoardSection, Int?>> = _sub
    private val _highlight = MutableStateFlow<Highlight?>(null)
    val highlight: StateFlow<Highlight?> = _highlight
    private var clearJob: Job? = null

    fun setCategory(s: BoardSection, id: Int?) { _cat.value = _cat.value + (s to id) }
    fun setSubcategory(s: BoardSection, id: Int?) { _sub.value = _sub.value + (s to id) }

    /// A word said twice in a row: open the tile's category chain and flash it.
    fun navigate(tile: Tile, board: BoardStore) {
        val catId = tile.categoryId
        if (catId != null) {
            val cats = board.categories.value
            val chain = mutableListOf<Category>()
            var cur = cats.firstOrNull { it.id == catId }
            while (cur != null) {
                chain.add(cur)
                val pid = cur.parentId
                cur = if (pid == null) null else cats.firstOrNull { it.id == pid }
            }
            chain.lastOrNull()?.let { root ->
                setCategory(tile.section, root.id)
                setSubcategory(tile.section, if (chain.size >= 2) chain[chain.size - 2].id else null)
            }
        }
        _highlight.value = Highlight(tile.id, tile.section)
        clearJob?.cancel()
        clearJob = scope.launch { delay(6_000); _highlight.value = null }
    }
}

/**
 * Sentence constructor state: staged tiles + the in-flight lift. The header
 * shows the strip while staged is non-empty; the original tiles never leave
 * the board (staging copies). Idle timer clears per the parent's setting.
 */
class SentenceBar(
    private val scope: CoroutineScope,
    private val media: MediaCache,
    private val gameAudio: GameAudio,
) {
    data class Drag(val tile: Tile, val overHeader: Boolean)

    private val _staged = MutableStateFlow<List<Tile>>(emptyList())
    val staged: StateFlow<List<Tile>> = _staged
    private val _drag = MutableStateFlow<Drag?>(null)
    val drag: StateFlow<Drag?> = _drag
    private var idleJob: Job? = null

    fun dragUpdate(tile: Tile, overHeader: Boolean) { _drag.value = Drag(tile, overHeader) }
    fun dragEnd() { _drag.value = null }

    fun stage(tile: Tile, idleMinutes: Int) {
        _staged.value = _staged.value + tile
        resetIdle(idleMinutes)
    }

    // Hold-to-stage handoff: after a 1s hold stages a tile, the finger lift
    // may also land as the tile's onClick — that release must not speak/log
    // a second time. The staging path notes the tile; the tap path consumes.
    @Volatile private var justStagedId: Int = -1
    @Volatile private var justStagedAt: Long = 0
    fun noteJustStaged(id: Int) { justStagedId = id; justStagedAt = System.currentTimeMillis() }
    fun consumeJustStaged(id: Int): Boolean {
        val hit = justStagedId == id && System.currentTimeMillis() - justStagedAt < 1500
        if (hit) justStagedId = -1
        return hit
    }

    fun removeAt(index: Int, idleMinutes: Int) {
        _staged.value = _staged.value.toMutableList().also { if (index in it.indices) it.removeAt(index) }
        if (_staged.value.isEmpty()) clear() else resetIdle(idleMinutes)
    }

    fun clear() {
        idleJob?.cancel(); idleJob = null
        _staged.value = emptyList()
        _drag.value = null
    }

    fun resetIdle(idleMinutes: Int) {
        idleJob?.cancel()
        val mins = idleMinutes.coerceIn(1, 10)
        idleJob = scope.launch { delay(mins * 60_000L); clear() }
    }

    /** Play every staged word in order — recorded clip first, TTS fallback. */
    fun playAll(childId: String, idleMinutes: Int) {
        val list = _staged.value
        if (list.isEmpty()) return
        resetIdle(idleMinutes)
        scope.launch {
            for (t in list) {
                val f = t.soundKey?.takeIf { it.isNotEmpty() }?.let { media.audioFile(it) }
                if (f != null && gameAudio.playFileAwait(f)) continue
                gameAudio.speakAwait(t.display, childId)
            }
        }
    }
}

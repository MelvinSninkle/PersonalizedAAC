package io.andrewpeterson.myworld.model

import android.content.Context
import android.content.SharedPreferences
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.DisplayPrefsData
import io.andrewpeterson.myworld.net.fetchDisplayPrefs
import io.andrewpeterson.myworld.net.listPersons
import io.andrewpeterson.myworld.net.saveDisplayPrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Display preferences — colors, tile density, what's visible. Persisted to
 * SharedPreferences (instant cold-launch) AND the server under
 * `child_settings.kidDisplay` (merge-safe; every device for the child shares
 * the look). Port of `Models/DisplayPrefs.swift`, one StateFlow of the whole
 * snapshot instead of 14 separate observables.
 */
class DisplayPrefs(context: Context, private val api: ApiClient) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("myworld.display", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _data = MutableStateFlow(load())
    val data: StateFlow<DisplayPrefsData> = _data

    private var childId: String? = null
    private var serverLoaded = false
    private var isApplying = false
    private var saveJob: Job? = null

    // ── Per-section accessors (DisplayPrefs.swift parity) ───────────────────

    fun across(section: BoardSection): Int = when (section) {
        BoardSection.PEOPLE -> _data.value.acrossPeople
        BoardSection.NOUNS -> _data.value.acrossNouns
        BoardSection.VERBS -> _data.value.acrossVerbs
        BoardSection.NEEDS -> 1   // needs renders as a single horizontal row
    }

    fun color(section: BoardSection): String = when (section) {
        BoardSection.PEOPLE -> _data.value.colorPeople
        BoardSection.NOUNS -> _data.value.colorNouns
        BoardSection.VERBS -> _data.value.colorVerbs
        BoardSection.NEEDS -> _data.value.colorNeeds
    }

    fun show(section: BoardSection): Boolean = when (section) {
        BoardSection.PEOPLE -> _data.value.showPeople
        BoardSection.NOUNS -> _data.value.showNouns
        BoardSection.VERBS -> _data.value.showVerbs
        BoardSection.NEEDS -> _data.value.showNeeds
    }

    /** Mutate via copy — every change persists locally + debounce-saves. */
    fun update(transform: (DisplayPrefsData) -> DisplayPrefsData) {
        _data.value = transform(_data.value)
        persist(_data.value)
        if (!isApplying) scheduleServerSave()
    }

    fun resetToDefaults() = update { DisplayPrefsData() }

    /** Apply a server snapshot without echoing a save back out. */
    fun apply(d: DisplayPrefsData) {
        isApplying = true
        _data.value = d
        persist(d)
        isApplying = false
    }

    /** Pull the server copy once the signed-in child is known. */
    fun attach(childId: String) {
        if (this.childId == childId) return
        this.childId = childId
        scope.launch {
            ChildNames.refresh(childId, api, prefs)
            api.fetchDisplayPrefs(childId)?.let { apply(it) }
            serverLoaded = true
        }
    }

    fun reloadFromServer() {
        val id = childId ?: return
        scope.launch { api.fetchDisplayPrefs(id)?.let { apply(it) } }
    }

    /** Debounced merge-safe write — coalesces slider bursts (0.8s). */
    private fun scheduleServerSave() {
        if (!serverLoaded) return
        val id = childId ?: return
        val snapshot = _data.value
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(800)
            api.saveDisplayPrefs(id, snapshot)
        }
    }

    // ── Local persistence ───────────────────────────────────────────────────

    private fun load(): DisplayPrefsData =
        prefs.getString("data", null)?.let {
            try { ApiClient.json.decodeFromString<DisplayPrefsData>(it) } catch (_: Exception) { null }
        } ?: DisplayPrefsData()

    private fun persist(d: DisplayPrefsData) {
        prefs.edit().putString("data",
            ApiClient.json.encodeToString(DisplayPrefsData.serializer(), d)).apply()
    }
}

/**
 * Live registry of children's REAL names (persons roster is_self row) so
 * titles read "Simon's World" — never a numbered slug. Port of ChildNames.
 */
object ChildNames {
    private val _bySlug = MutableStateFlow<Map<String, String>>(emptyMap())
    val bySlug: StateFlow<Map<String, String>> = _bySlug
    private val inFlight = mutableSetOf<String>()

    fun name(slug: String?): String = slug?.let { _bySlug.value[it] } ?: ""

    suspend fun refresh(slug: String?, api: ApiClient, prefs: SharedPreferences) {
        if (slug.isNullOrEmpty()) return
        if (_bySlug.value[slug] == null) {
            prefs.getString("childRealName:$slug", null)?.takeIf { it.isNotEmpty() }?.let {
                _bySlug.value = _bySlug.value + (slug to it)
            }
        }
        synchronized(inFlight) { if (!inFlight.add(slug)) return }
        try {
            val persons = try { api.listPersons(slug) } catch (_: Exception) { return }
            val me = persons.firstOrNull { it.isSelf } ?: return
            val raw = me.givenName?.takeIf { it.isNotEmpty() } ?: me.displayName
            val first = raw.split(' ').firstOrNull() ?: raw
            if (first.isEmpty()) return
            _bySlug.value = _bySlug.value + (slug to first)
            prefs.edit().putString("childRealName:$slug", first).apply()
        } finally {
            synchronized(inFlight) { inFlight.remove(slug) }
        }
    }
}

/** "fletcherpeterson" → "Fletcher"; numbered-dupe suffixes dropped. */
fun prettyChildName(slug: String?): String {
    val real = ChildNames.name(slug)
    if (real.isNotEmpty()) return real
    if (slug.isNullOrEmpty()) return ""
    var name = slug
    if (name.lowercase().endsWith("peterson")) name = name.dropLast("peterson".length)
    name = name.replace(Regex("[-_][a-z0-9]{1,8}$"), "")
    name = name.replace(Regex("[0-9]+$"), "")
    if (name.isEmpty()) return slug
    return name.replaceFirstChar { it.uppercaseChar() }
}

fun worldTitle(slug: String?): String {
    val n = prettyChildName(slug)
    return if (n.isEmpty()) "My World" else "$n's World"
}

fun childPossessive(slug: String?, fallback: String = "your child's"): String {
    val n = prettyChildName(slug)
    return if (n.isEmpty()) fallback else "$n's"
}

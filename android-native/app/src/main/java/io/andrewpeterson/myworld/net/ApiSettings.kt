package io.andrewpeterson.myworld.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * child_settings + persons helpers — ports of the APIClient.swift child
 * settings surface. child_settings is ONE shared JSON blob per child; every
 * writer must do a MERGE-SAFE read-modify-write of its own subkey so the web,
 * iPad, and Android never clobber each other's keys.
 */

@Serializable
data class DisplayPrefsData(
    val hideLabels: Boolean = false,
    val showPeople: Boolean = true, val showNouns: Boolean = true,
    val showVerbs: Boolean = true, val showNeeds: Boolean = true,
    val acrossPeople: Int = 2, val acrossNouns: Int = 4, val acrossVerbs: Int = 2,
    val colorPeople: String = "#fde7ef", val colorNouns: String = "#fff4cc",
    val colorVerbs: String = "#dcefe2", val colorNeeds: String = "#fff7e6",
    val colorHeaderBg: String = "#ff1493", val colorHeaderText: String = "#ffffff",
)

@Serializable
data class Person(
    val id: Int = 0,
    val display_name: String = "",
    val given_name: String? = null,
    val relationship: String? = null,
    val side: String? = null,
    val is_self: Boolean = false,
    val reference_key: String? = null,
) {
    val isSelf: Boolean get() = is_self
    val displayName: String get() = display_name
    val givenName: String? get() = given_name
}

/** GET the raw settings blob ({} when missing). */
suspend fun ApiClient.childSettings(childId: String): JsonObject {
    return try {
        val bytes = raw("GET", "/api/child-settings?childId=${esc(childId)}")
        val root = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
        (root["settings"] as? JsonObject) ?: buildJsonObject { }
    } catch (_: Exception) { buildJsonObject { } }
}

/** Merge-safe write of ONE subkey: re-read, overlay, POST back whole. */
suspend fun ApiClient.saveChildSettingsKey(childId: String, key: String, value: kotlinx.serialization.json.JsonElement) {
    try {
        val current = childSettings(childId)
        val merged = buildJsonObject {
            for ((k, v) in current) if (k != key) put(k, v)
            put(key, value)
        }
        val body = buildJsonObject {
            put("childId", childId)
            put("settings", merged)
        }
        raw("POST", "/api/child-settings?childId=${esc(childId)}", body.toString().encodeToByteArray())
    } catch (_: Exception) { /* settings save is best-effort */ }
}

suspend fun ApiClient.fetchDisplayPrefs(childId: String): DisplayPrefsData? {
    val kid = childSettings(childId)["kidDisplay"] ?: return null
    return try { ApiClient.json.decodeFromJsonElement(DisplayPrefsData.serializer(), kid) }
    catch (_: Exception) { null }
}

suspend fun ApiClient.saveDisplayPrefs(childId: String, data: DisplayPrefsData) {
    val el = ApiClient.json.encodeToJsonElement(DisplayPrefsData.serializer(), data)
    saveChildSettingsKey(childId, "kidDisplay", el)
}

suspend fun ApiClient.listPersons(childId: String): List<Person> =
    getJson("/api/persons?childId=${esc(childId)}")

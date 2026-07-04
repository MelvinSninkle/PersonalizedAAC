package io.andrewpeterson.myworld.model

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Which face of the app this DEVICE is — the child's board or the parent app.
 * Mirror of kid-ios `Models/DeviceMode.swift` (UserDefaults "deviceRole").
 */
class DeviceMode(context: Context) {

    enum class Role(val raw: String) {
        UNSET("unset"), CHILD_BOARD("childBoard"), PARENT("parent");

        companion object {
            fun from(raw: String?): Role = entries.firstOrNull { it.raw == raw } ?: UNSET
        }
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences("myworld.device", Context.MODE_PRIVATE)

    private val _role = MutableStateFlow(Role.from(prefs.getString("deviceRole", null)))
    val role: StateFlow<Role> = _role

    fun set(role: Role) {
        _role.value = role
        prefs.edit().putString("deviceRole", role.raw).apply()
    }
}

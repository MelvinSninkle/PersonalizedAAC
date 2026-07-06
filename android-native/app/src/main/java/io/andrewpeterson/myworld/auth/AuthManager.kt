package io.andrewpeterson.myworld.auth

import android.content.Context
import android.content.SharedPreferences
import io.andrewpeterson.myworld.net.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/** Mirror of kid-ios `Auth/SessionStore.swift` — the lightweight user record. */
@Serializable
data class SignedInUser(
    val email: String? = null,
    val role: String? = null,
    val slug: String? = null,
)

/**
 * Tracks "am I signed in" + "which child board do I render" — the Android
 * twin of `Auth/AuthManager.swift`. The real credential is the mw_session
 * cookie in [io.andrewpeterson.myworld.net.PersistentCookieJar]; this class
 * only caches the user record for instant paint and exposes sign-in/out.
 */
class AuthManager(context: Context, private val api: ApiClient) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("myworld.session", Context.MODE_PRIVATE)

    private val _user = MutableStateFlow(load())
    val user: StateFlow<SignedInUser?> = _user

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    val isSignedIn: Boolean get() = _user.value != null
    val childSlug: String get() = _user.value?.slug ?: ""

    /** Try logging in; on success cache the user (cookie saved by the jar). */
    suspend fun signIn(email: String, password: String) {
        try {
            val resp = api.login(email, password)
            val u = SignedInUser(resp.user?.email, resp.user?.role, resp.user?.slug)
            save(u)
            _user.value = u
            _lastError.value = null
        } catch (e: Exception) {
            _lastError.value = (e as? ApiClient.ApiError)?.message ?: e.localizedMessage
        }
    }

    suspend fun signOut() {
        api.logout()
        save(null)
        _user.value = null
    }

    /**
     * Re-read /api/auth/me and cache — used by flows that set the cookie
     * out-of-band (account creation during onboarding).
     */
    suspend fun refreshFromServer() {
        try {
            val me = api.me()
            val u = me.user ?: return
            val s = SignedInUser(u.email, u.role, u.slug)
            save(s)
            _user.value = s
            _lastError.value = null
        } catch (_: Exception) { /* leave existing state alone */ }
    }

    /** Called by ApiClient's global 401 hook — the session died server-side. */
    fun handleUnauthorized() {
        // Keep the cached record (the login screen prefills the email), but
        // surface signed-out so the UI returns to login.
        _user.value = null
    }

    // ── Persistence ─────────────────────────────────────────────────────────

    private fun load(): SignedInUser? =
        prefs.getString("user", null)?.let {
            try { ApiClient.json.decodeFromString<SignedInUser>(it) } catch (_: Exception) { null }
        }

    private fun save(u: SignedInUser?) {
        prefs.edit().apply {
            if (u == null) remove("user")
            else putString("user", ApiClient.json.encodeToString(u))
        }.apply()
    }

    /** Last-used email for the unlock sheet + login prefill (iOS parity). */
    fun lastEmail(): String = _user.value?.email ?: prefs.getString("lastEmail", "") ?: ""
    fun noteEmail(email: String) { prefs.edit().putString("lastEmail", email).apply() }
}

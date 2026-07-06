package io.andrewpeterson.myworld.net

import android.content.Context
import android.content.SharedPreferences
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * Persists the `mw_session` cookie (and anything else the server sets) across
 * process death — the Android twin of iOS `HTTPCookieStorage.shared`, which is
 * the app's ONLY credential store (the session is a 30-day HMAC-signed cookie).
 *
 * SharedPreferences (app-private) rather than DataStore because OkHttp's
 * CookieJar interface is synchronous; the value is already a bearer credential
 * scoped to this app's sandbox, same trust model as the iOS cookie jar.
 */
class PersistentCookieJar(context: Context) : CookieJar {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("myworld.cookies", Context.MODE_PRIVATE)

    /** host → (name → serialized cookie) */
    private val cache = mutableMapOf<String, MutableMap<String, Cookie>>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val host = url.host
        val forHost = cache.getOrPut(host) { loadHost(host) }
        var dirty = false
        for (c in cookies) {
            forHost[c.name] = c
            dirty = true
        }
        if (dirty) persistHost(host, forHost)
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val host = url.host
        val forHost = cache.getOrPut(host) { loadHost(host) }
        val now = System.currentTimeMillis()
        val (live, dead) = forHost.values.partition { it.expiresAt > now }
        if (dead.isNotEmpty()) {
            dead.forEach { forHost.remove(it.name) }
            persistHost(host, forHost)
        }
        return live.filter { it.matches(url) }
    }

    @Synchronized
    fun clear() {
        cache.clear()
        prefs.edit().clear().apply()
    }

    // ── Persistence: one prefs entry per host, cookies joined by \n in the
    //    standard Set-Cookie format (Cookie.toString round-trips via parse). ──

    private fun loadHost(host: String): MutableMap<String, Cookie> {
        val out = mutableMapOf<String, Cookie>()
        val raw = prefs.getString("host:$host", null) ?: return out
        val url = HttpUrl.Builder().scheme("https").host(host).build()
        for (line in raw.split('\n')) {
            if (line.isBlank()) continue
            Cookie.parse(url, line)?.let { out[it.name] = it }
        }
        return out
    }

    private fun persistHost(host: String, cookies: Map<String, Cookie>) {
        val raw = cookies.values.joinToString("\n") { it.toString() }
        prefs.edit().putString("host:$host", raw).apply()
    }
}

package io.andrewpeterson.myworld

import android.app.Application
import android.content.Context
import androidx.compose.runtime.staticCompositionLocalOf
import io.andrewpeterson.myworld.audio.SpeechCache
import io.andrewpeterson.myworld.audio.TilePlayer
import io.andrewpeterson.myworld.auth.AuthManager
import io.andrewpeterson.myworld.game.PlayScope
import io.andrewpeterson.myworld.model.DeviceMode
import io.andrewpeterson.myworld.model.DisplayPrefs
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.PersistentCookieJar
import io.andrewpeterson.myworld.storage.BoardStore
import io.andrewpeterson.myworld.storage.MediaCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Manual DI — the Android twin of the 11 `@Observable` stores the iOS app
 * injects via `.environment(...)` in `MyWorldApp.swift`. One hand-built
 * container, app-scoped, exposed to Compose through [LocalAppContainer].
 * Stores are added milestone by milestone; every one is a plain class
 * exposing StateFlow, constructed here exactly once.
 */
class AppContainer(context: Context) {

    /** App-lifetime scope for store-owned coroutines (pollers bind to
     *  ProcessLifecycleOwner separately so they run foreground-only). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val cookieJar = PersistentCookieJar(context)
    val api = ApiClient(cookieJar, onUnauthorized = { auth.handleUnauthorized() })
    val auth = AuthManager(context, api)
    val deviceMode = DeviceMode(context)

    // M2 — board data + media/audio plumbing.
    val media = MediaCache(context, api)
    val board = BoardStore(context, api, media)
    val speechCache = SpeechCache(context, api)
    val tilePlayer = TilePlayer(context, api, media)

    // M3 — display preferences (server-synced) + play-scope memory.
    val displayPrefs = DisplayPrefs(context, api)

    init {
        PlayScope.init(context)
    }

    // M5+: gameController, gameAudio, scheduler, autoTeachRunner …
    // M6+: speechListener · M7+: liveSession, parentLive · M8+: addTileQueue
}

val LocalAppContainer = staticCompositionLocalOf<AppContainer> {
    error("AppContainer not provided")
}

class MyWorldApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

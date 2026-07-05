package io.andrewpeterson.myworld

import android.app.Application
import android.content.Context
import androidx.compose.runtime.staticCompositionLocalOf
import io.andrewpeterson.myworld.audio.GameAudio
import io.andrewpeterson.myworld.audio.SpeechCache
import io.andrewpeterson.myworld.audio.SpeechListener
import io.andrewpeterson.myworld.audio.TilePlayer
import io.andrewpeterson.myworld.auth.AuthManager
import io.andrewpeterson.myworld.game.GameController
import io.andrewpeterson.myworld.game.PlayScope
import io.andrewpeterson.myworld.live.AutoTeachRunner
import io.andrewpeterson.myworld.live.LiveSession
import io.andrewpeterson.myworld.live.ParentLive
import io.andrewpeterson.myworld.model.DeviceMode
import io.andrewpeterson.myworld.model.DisplayPrefs
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.PersistentCookieJar
import io.andrewpeterson.myworld.storage.AddTileQueue
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

    // M5 — game engine + live channel + auto-teach.
    val game = GameController()
    val gameAudio = GameAudio(context, api, speechCache)
    val live = LiveSession(api)
    val autoTeach = AutoTeachRunner(api)

    // M6 — listening mode.
    val speechListener = SpeechListener(context)

    // M7 — parent-side live channel.
    val parentLive = ParentLive(api)

    // M8 — tile authoring queue (durable server jobs).
    val addTileQueue = AddTileQueue(api, board)

    init {
        PlayScope.init(context)
    }
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

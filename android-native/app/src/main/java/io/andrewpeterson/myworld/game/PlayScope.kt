package io.andrewpeterson.myworld.game

import android.content.Context
import android.content.SharedPreferences

/**
 * Remembers the last category/subcategory chip the child REALLY pressed —
 * the scope the header "Play with me" quiz and "Teach me" slideshow use next.
 * Port of `GameController.PlayScope` (UserDefaults "playScope:<slug>").
 */
object PlayScope {
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.getSharedPreferences("myworld.playscope", Context.MODE_PRIVATE)
    }

    fun note(scope: String, slug: String) {
        if (slug.isEmpty()) return
        prefs?.edit()?.putString("playScope:$slug", scope)?.apply()
    }

    fun recall(slug: String): String? =
        prefs?.getString("playScope:$slug", null)
}

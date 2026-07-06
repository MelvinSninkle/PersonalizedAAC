package io.andrewpeterson.myworld.storage

import android.content.Context
import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.ShopTile
import io.andrewpeterson.myworld.net.storeBrowse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import java.io.File

/**
 * Disk-cached copy of the shop catalog — port of `ShopCatalog` in
 * WordShopView.swift. The catalog barely changes between visits and the
 * device already has the preview art, so the shop renders last visit's
 * catalog instantly while a fresh copy loads behind it and swaps in.
 */
object ShopCatalogCache {
    private fun file(context: Context, childId: String) =
        File(context.cacheDir, "shop-catalog-${childId.replace('/', '_')}.json")

    suspend fun cached(context: Context, childId: String): List<ShopTile>? =
        withContext(Dispatchers.IO) {
            try {
                val f = file(context, childId)
                if (!f.exists()) null
                else ApiClient.json.decodeFromString(ListSerializer(ShopTile.serializer()), f.readText())
            } catch (_: Exception) { null }
        }

    /** Fetch a fresh catalog into the cache; null on failure. */
    suspend fun refresh(context: Context, childId: String, api: ApiClient): List<ShopTile>? {
        val fresh = try { api.storeBrowse(childId) } catch (_: Exception) { return null }
        withContext(Dispatchers.IO) {
            try {
                file(context, childId).writeText(
                    ApiClient.json.encodeToString(ListSerializer(ShopTile.serializer()), fresh))
            } catch (_: Exception) {}
        }
        return fresh
    }
}

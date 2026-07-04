package io.andrewpeterson.myworld

import io.andrewpeterson.myworld.model.BoardMetrics
import io.andrewpeterson.myworld.model.SyncResponse
import io.andrewpeterson.myworld.model.categoryNameIsPoster
import io.andrewpeterson.myworld.net.ApiClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JSON contract tests against a captured /api/sync payload shape — the models
 * must decode exactly what rowToItem/rowToCategory emit (iOS Tile/Category
 * decoder parity), leniently (unknown keys, missing optionals).
 */
class BoardModelTest {

    private val sample = """
    {
      "categories": [
        {"id": 1, "section": "people", "label": "Family", "parentId": null,
         "imageKey": "onboarding/x/1.png", "keepAspect": false, "order": 0,
         "childId": "fletcherpeterson", "someFutureKey": 42},
        {"id": 2, "section": "nouns", "label": "TV shows", "parentId": 1, "order": 3}
      ],
      "items": [
        {"id": 10, "section": "needs", "label": "help", "categoryId": null,
         "imageKey": "taxonomy-defaults/help/a.png", "soundKey": "v/help.mp3",
         "keepAspect": false, "order": 2, "pinned": true,
         "taxonomySlug": "core.help", "descriptiveClues": ["You say it when stuck"],
         "needsReview": false},
        {"id": 11, "section": "verbs", "label": "run"}
      ],
      "ageFilter": {"applied": false},
      "entitlement": {"tier": "plus.monthly", "label": "My World Plus",
                      "stt": true, "autoTeach": true, "styling": true}
    }
    """.trimIndent()

    @Test
    fun syncPayloadDecodesLeniently() {
        val resp = ApiClient.json.decodeFromString<SyncResponse>(sample)
        assertEquals(2, resp.categories.size)
        assertEquals(2, resp.items.size)
        assertEquals("Family", resp.categories[0].label)
        assertEquals("people", resp.categories[0].section.raw)
        // Missing optionals default like the Swift decoder.
        val run = resp.items[1]
        assertEquals(0, run.order)
        assertFalse(run.pinned)
        assertEquals(null, run.imageKey)
        // Clues survive.
        assertEquals(1, resp.items[0].descriptiveClues?.size)
        assertTrue(resp.items[0].pinned)
        assertEquals("plus.monthly", resp.entitlement?.tier)
    }

    @Test
    fun posterRuleIsWordMatchOnTvOnly() {
        assertTrue(categoryNameIsPoster("TV"))
        assertTrue(categoryNameIsPoster("TV shows"))
        assertTrue(categoryNameIsPoster("My TVs"))
        assertFalse(categoryNameIsPoster("Show and Tell"))   // the substring bug
        assertFalse(categoryNameIsPoster("Shower"))
        assertFalse(categoryNameIsPoster("Television"))
    }

    @Test
    fun columnWidthMatchesIos() {
        // BoardMetrics.swift: across*tile + (across-1)*gap + 2*pad
        assertEquals(4f * 100 + 3 * 8f + 12f, BoardMetrics.columnWidth(4, 100f))
        assertEquals(1f * 100 + 12f, BoardMetrics.columnWidth(0, 100f))   // clamps to 1
    }
}

package io.andrewpeterson.myworld.game

import io.andrewpeterson.myworld.audio.TimedWord
import io.andrewpeterson.myworld.model.Tile

/** One matched piece of the rolling caption: a board tile, or plain text. */
data class ListenToken(
    val id: Int,          // id of its FIRST source word — stable as old words drop
    val word: String,
    val tile: Tile?,
    val at: Long,
    /** Display filter (E8): a blocklisted word, shown as the pill "Bad Word". */
    val masked: Boolean = false,
)

/**
 * Greedy-longest tokenizer — the SAME rule as api/message-to-board.js and the
 * iOS `ListenTokenizer`: try the longest phrase (≤6 words) as one tile,
 * shrink to single words; unmatched words stay text. Digits canonicalize to
 * words token-by-token ("12" → "twelve") so recognizer output meets labels.
 */
object ListenTokenizer {

    private val numberWords = mapOf(
        "0" to "zero", "1" to "one", "2" to "two", "3" to "three", "4" to "four",
        "5" to "five", "6" to "six", "7" to "seven", "8" to "eight", "9" to "nine",
        "10" to "ten", "11" to "eleven", "12" to "twelve", "13" to "thirteen",
        "14" to "fourteen", "15" to "fifteen", "16" to "sixteen", "17" to "seventeen",
        "18" to "eighteen", "19" to "nineteen", "20" to "twenty",
    )

    fun normalize(s: String): String {
        val cleaned = s.lowercase()
            .replace(Regex("[.,!?;:\"()\\[\\]{}]"), "")
            .trim()
        return cleaned.split(' ').filter { it.isNotEmpty() }
            .joinToString(" ") { numberWords[it] ?: it }
    }

    fun lexicon(tiles: List<Tile>): Map<String, Tile> {
        val map = mutableMapOf<String, Tile>()
        // Labels first — a real "loves" tile beats "love"'s variant — then the
        // server-expanded matchTerms (inflections + curated synonyms).
        for (t in tiles) {
            val key = normalize(t.label)
            if (key.isNotEmpty() && key !in map) map[key] = t
        }
        for (t in tiles) {
            for (v in t.matchTerms.orEmpty()) {
                val key = normalize(v)
                if (key.isNotEmpty() && key !in map) map[key] = t
            }
        }
        return map
    }

    fun tokenize(
        words: List<TimedWord>, lexicon: Map<String, Tile>,
        censor: Boolean = true, tilesOnly: Boolean = false,
        blocklist: Set<String> = emptySet(),
    ): List<ListenToken> {
        val out = mutableListOf<ListenToken>()
        var i = 0
        while (i < words.size) {
            var matched: Tile? = null
            var used = 1
            var w = minOf(6, words.size - i)
            while (w >= 1) {
                val phrase = normalize(words.subList(i, i + w).joinToString(" ") { it.text })
                val tile = lexicon[phrase]
                if (tile != null) { matched = tile; used = w; break }
                w -= 1
            }
            val src = words.subList(i, i + used)
            val id = src.first().id
            val at = src.maxOf { it.at }
            if (matched != null) {
                out.add(ListenToken(id = id, word = matched.label, tile = matched, at = at))
            } else if (!tilesOnly) {
                // Display filter (E8): a blocklisted word never renders as
                // itself; tilesOnly hides every non-tile word outright.
                val norm = normalize(words[i].text)
                if (censor && norm in blocklist) {
                    out.add(ListenToken(id = id, word = "Bad Word", tile = null, at = at, masked = true))
                } else {
                    out.add(ListenToken(id = id, word = norm, tile = null, at = at))
                }
            }
            i += used
        }
        return out
    }
}

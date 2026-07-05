package io.andrewpeterson.myworld.model

import android.content.Context
import android.os.Build
import android.speech.SpeechRecognizer

/**
 * One place that answers "what works on THIS device" — feeds the established
 * capability messaging on every gated surface (M13). Fire tablets are the
 * main divergence: no Google Play services (no native billing, no speech
 * recognition service on most models); everything else — the board, games,
 * live channel, tile authoring — is identical.
 */
object DeviceCapabilities {

    val isFireTablet: Boolean =
        Build.MANUFACTURER.equals("Amazon", ignoreCase = true)

    fun speechAvailable(context: Context): Boolean =
        SpeechRecognizer.isRecognitionAvailable(context)

    /** Short parent-facing summary for settings / support screens. */
    fun summary(context: Context, playBilling: Boolean): String {
        val lines = mutableListOf<String>()
        lines += "Device: ${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})"
        lines += if (speechAvailable(context))
            "✅ Speech-to-text listening works here"
        else
            "⚠️ No speech-recognition service on this device (normal on Fire tablets) — listening mode is unavailable; everything else works"
        lines += if (playBilling)
            "✅ Purchases through Google Play"
        else
            "ℹ️ No Google Play on this device — purchases use the secure web store instead"
        return lines.joinToString("\n")
    }
}

package io.andrewpeterson.myworld.model

import io.andrewpeterson.myworld.net.ApiClient
import io.andrewpeterson.myworld.net.onboardingState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Onboarding navigation + collected data — port of
 * `Parent/OnboardingCoordinator.swift`. Step names match the wire values in
 * api/_lib/onboarding.js; the server persists each step before we advance,
 * so a parent who quits picks up exactly where they left off.
 */
class OnboardingCoordinator(private val api: ApiClient) {

    enum class Step(val serverKey: String) {
        DEMO("account"),          // pre-account demo board (no server cursor)
        ACCOUNT("account"),
        CHILD("child"),
        CHILD_PHOTO("child_photo"),
        PARENT_PHOTO("parent_photo"),
        SEED_CORE("seed_core"),
        COMPLETE("complete");

        companion object {
            fun fromServer(key: String): Step = when (key) {
                "account" -> ACCOUNT
                "child" -> CHILD
                "child_photo" -> CHILD_PHOTO
                "parent_photo" -> PARENT_PHOTO
                "seed_core" -> SEED_CORE
                "complete" -> COMPLETE
                else -> DEMO
            }
        }
    }

    private val _step = MutableStateFlow(Step.DEMO)
    val step: StateFlow<Step> = _step

    /**
     * True ONLY while a brand-new parent is mid-onboarding — keeps RootView on
     * the flow even after the account exists (signing in flips user != null,
     * which would otherwise abandon the flow). An EXISTING parent who logs in
     * leaves this false and lands on their board / parent home immediately.
     */
    private val _needsOnboarding = MutableStateFlow(false)
    val needsOnboarding: StateFlow<Boolean> = _needsOnboarding

    // Collected as the parent walks the flow (server owns durability).
    var childName: String = ""
    var birthDate: String = ""       // "yyyy-MM-dd"
    var language: String = "en"
    var tier: String = "under3"
    var styleGuideId: Int? = null
    var styleLabel: String = ""
    var voiceId: String? = null
    var voiceName: String = ""

    fun go(step: Step) { _step.value = step }

    fun setNeedsOnboarding(on: Boolean) { _needsOnboarding.value = on }

    /** Pick up where a previous device/session left off. */
    suspend fun resumeIfPossible() {
        try {
            val s = api.onboardingState()
            _step.value = Step.fromServer(s.step)
            s.data["childName"]?.let { childName = it }
            s.data["language"]?.let { language = it }
            s.data["tier"]?.let { tier = it }
            s.data["birthDate"]?.let { birthDate = it }
        } catch (_: Exception) { /* first run — keep defaults */ }
    }
}

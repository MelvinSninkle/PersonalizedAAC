package io.andrewpeterson.myworld.game

import io.andrewpeterson.myworld.live.LiveCommand
import io.andrewpeterson.myworld.live.RoutineStep
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Translates incoming LiveCommands into a runnable game session — port of
 * `Live/GameController.swift`. The UI observes `current` (which mode is on
 * screen) and `inGameCommand` (mark/next/skip directives for the running view).
 */
class GameController {

    sealed interface Mode {
        data object Matching : Mode
        /** Hear a description, pick the picture. Matching lifecycle. */
        data object AuditoryComprehension : Mode
        /** Image alone, no prompt; facilitator marks verbal/gesture/object. */
        data object ExpressiveNaming : Mode
        data class Slideshow(val firstPerson: Boolean) : Mode
        /** "Teach me" — word + all teaching clues, one pass. */
        data object Teach : Mode
        /** Hear a clue, tap the picture; each miss reveals the NEXT clue. */
        data object ClueQuiz : Mode
        data object Celebration : Mode
    }

    data class Session(
        val id: String = UUID.randomUUID().toString(),
        val mode: Mode,
        val scope: String? = null,
        val choices: Int? = null,
        val from: Int? = null,
        val to: Int? = null,
        val sample: Int? = null,
        val limitMin: Double? = null,
        val secondsPerImage: Double? = null,
        val music: String? = null,
    )

    private val _current = MutableStateFlow<Session?>(null)
    val current: StateFlow<Session?> = _current

    private val _inGameCommand = MutableStateFlow<LiveCommand?>(null)
    val inGameCommand: StateFlow<LiveCommand?> = _inGameCommand

    private var routineSteps: List<RoutineStep> = emptyList()
    private var routineIndex = 0
    val isRoutineActive: Boolean get() = routineSteps.isNotEmpty() && routineIndex < routineSteps.size

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private fun resolveMode(raw: String?): Mode = when (raw) {
        "learn_slideshow", "slideshow" -> Mode.Slideshow(firstPerson = false)
        "exposure_slideshow" -> Mode.Slideshow(firstPerson = true)
        "teach_slideshow" -> Mode.Teach
        "clue_quiz" -> Mode.ClueQuiz
        "celebration" -> Mode.Celebration
        "auditory_comprehension" -> Mode.AuditoryComprehension
        "expressive_naming" -> Mode.ExpressiveNaming
        else -> Mode.Matching
    }

    fun apply(cmd: LiveCommand) {
        when (cmd.action) {
            "start" -> {
                if (_current.value != null || isRoutineActive) return
                val steps = cmd.steps
                if (!steps.isNullOrEmpty()) { runRoutine(steps); return }
                var mode = resolveMode(cmd.mode)
                if (mode is Mode.Slideshow && cmd.labelStyle == "first_person") {
                    mode = Mode.Slideshow(firstPerson = true)
                }
                _current.value = Session(
                    mode = mode, scope = cmd.scope, choices = cmd.choices,
                    from = cmd.from?.toInt(), to = cmd.to?.toInt(),
                    sample = cmd.sample?.toInt(), limitMin = cmd.limitMin,
                    secondsPerImage = cmd.secondsPerImage, music = cmd.music,
                )
            }
            "end" -> {
                _current.value = null
                _inGameCommand.value = null
                abortRoutine()
            }
            else -> _inGameCommand.value = cmd
        }
    }

    /** Auto-teach's countdown fires a fully-built session — same guard. */
    fun startStaged(session: Session) {
        if (_current.value != null || isRoutineActive) return
        _current.value = session
    }

    fun startLocal(mode: Mode, scope: String? = null, choices: Int? = null, sample: Int? = null) {
        _current.value = Session(mode = mode, scope = scope, choices = choices, sample = sample)
    }

    fun runRoutine(steps: List<RoutineStep>) {
        if (_current.value != null) return
        routineSteps = steps.take(12)
        routineIndex = 0
        startCurrentRoutineStep()
    }

    /**
     * Called when a session ends — advances the routine if any. Returns true
     * when the routine continues (caller must NOT publish standby yet).
     */
    fun sessionDidEnd(): Boolean {
        _current.value = null
        if (!isRoutineActive) return false
        routineIndex++
        if (routineIndex >= routineSteps.size) { abortRoutine(); return false }
        // Small gap so the cover dismiss finishes before the next mode pushes.
        scope.launch {
            delay(600)
            startCurrentRoutineStep()
        }
        return true
    }

    fun abortRoutine() { routineSteps = emptyList(); routineIndex = 0 }
    fun consumeInGameCommand() { _inGameCommand.value = null }
    fun stop() { _current.value = null; _inGameCommand.value = null; abortRoutine() }

    private fun startCurrentRoutineStep() {
        if (routineIndex >= routineSteps.size) { abortRoutine(); return }
        val step = routineSteps[routineIndex]
        val mode = resolveMode(step.mode)
        // Slideshow steps NEED a time limit to auto-advance; web defaults 3 min.
        var limit = step.limitMin
        if (mode is Mode.Slideshow && (limit ?: 0.0) <= 0.0) limit = 3.0
        _current.value = Session(
            mode = mode, scope = step.scope, choices = step.choices,
            from = step.from?.toInt(), to = step.to?.toInt(),
            sample = step.sample?.toInt(), limitMin = limit,
            secondsPerImage = step.secondsPerImage, music = step.music,
        )
    }
}

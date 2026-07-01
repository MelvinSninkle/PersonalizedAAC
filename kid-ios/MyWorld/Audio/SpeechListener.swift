import Foundation
import Speech
import AVFoundation
import Observation

/// One recognized word with the moment it was heard, for the rolling caption.
struct TimedWord: Identifiable, Equatable {
    let id: Int
    let text: String
    let at: Date
}

/// Listening Mode's speech engine. Wraps Apple's `SFSpeechRecognizer` +
/// `AVAudioEngine` and maintains a CONTINUOUS ROLLING CAPTION in `words`: new
/// words append as they're heard; words older than `fadeSeconds` (or beyond
/// `maxWords` when the bar fills) drop off the front — so listening streams like
/// live captions and never resets on a pause or overflows.
///
/// Uses on-device (offline) recognition when the language pack is present, and
/// falls back to online if the on-device model errors. Any failure surfaces in
/// `status` instead of failing silently.
@MainActor
@Observable
final class SpeechListener {
    /// Rolling window of recent words (oldest → newest) for the strip.
    var words: [TimedWord] = []
    /// The in-progress last word of the current utterance (not yet committed).
    var liveTail: String = ""
    /// Latest full transcript of the current utterance (drives the idle timeout).
    var transcript: String = ""
    var isListening: Bool = false
    /// Human-readable state / error, shown in the strip when there are no words.
    var status: String = ""

    private let fadeSeconds: TimeInterval = 10   // a word lingers ~10s after it's spoken
    private let maxWords = 18                     // "bar is full" cap (oldest drop off)

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var cleanupTask: Task<Void, Never>?
    private var useOnDevice = true
    private var restarts = 0
    private var nextWordId = 0
    private var utteranceBase = 0                  // committed words in the current utterance

    func start() {
        guard !isListening else { return }
        transcript = ""; words = []; liveTail = ""; status = "Starting…"
        useOnDevice = (recognizer?.supportsOnDeviceRecognition == true)
        restarts = 0; utteranceBase = 0
        SFSpeechRecognizer.requestAuthorization { [weak self] auth in
            AVAudioApplication.requestRecordPermission { mic in
                Task { @MainActor in
                    guard let self else { return }
                    guard auth == .authorized else { self.status = "Speech permission denied — enable it in Settings › My World."; return }
                    guard mic else { self.status = "Microphone permission denied — enable it in Settings › My World."; return }
                    guard self.recognizer?.isAvailable == true else { self.status = "Speech recognizer unavailable (needs network, or a downloaded language)."; return }
                    self.isListening = true
                    self.startCleanup()
                    self.beginSession()
                }
            }
        }
    }

    func stop() {
        isListening = false
        cleanupTask?.cancel(); cleanupTask = nil
        teardown()
        words = []; liveTail = ""; transcript = ""; status = ""
        // Restore the app's normal playback session so tile audio keeps working.
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, options: [.duckOthers])
        try? s.setActive(true)
    }

    private func beginSession() {
        guard isListening else { return }
        teardown()
        utteranceBase = 0; liveTail = ""     // a fresh utterance; keep the rolling history

        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playAndRecord, mode: .default,
                              options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
            try s.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            status = "Audio session error: \(error.localizedDescription)"; isListening = false; return
        }

        // Fresh engine each session so the input node picks up the CURRENT record
        // route (a stale engine → 0-sample-rate "format unavailable").
        let engine = AVAudioEngine()
        audioEngine = engine
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            status = "Microphone format unavailable (sr=\(Int(format.sampleRate))). Try toggling Listen off/on."
            isListening = false; return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = useOnDevice
        request = req

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        do { try engine.start() }
        catch { status = "Mic start error: \(error.localizedDescription)"; isListening = false; return }

        status = words.isEmpty ? (useOnDevice ? "Listening (on-device)…" : "Listening…") : ""
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                    self.ingest(result.bestTranscription.formattedString, final: result.isFinal)
                    self.status = ""
                    self.restarts = 0
                }
                if let error {
                    if self.useOnDevice {                 // fall back to online once
                        self.useOnDevice = false
                        self.status = "On-device not ready — using online…"
                        if self.isListening { self.beginSession() }
                        return
                    }
                    self.status = "Recognition error: \(error.localizedDescription)"
                }
                if (result?.isFinal ?? false) || error != nil {
                    self.restarts += 1
                    if self.isListening && self.restarts < 40 {
                        self.beginSession()
                    } else if self.restarts >= 40 {
                        self.status = "Stopped — no speech detected."
                        self.isListening = false; self.teardown()
                    }
                }
            }
        }
    }

    /// Fold the growing partial transcript into the rolling word buffer. We hold
    /// the last word back until it's stable (recognition keeps revising it), then
    /// commit it — so words don't flicker or double up.
    private func ingest(_ utter: String, final: Bool) {
        let all = utter.split(separator: " ").map(String.init)
        let commitCount = final ? all.count : max(0, all.count - 1)
        if commitCount > utteranceBase {
            let now = Date()
            for w in all[utteranceBase..<commitCount] {
                words.append(TimedWord(id: nextWordId, text: w, at: now)); nextWordId += 1
            }
            utteranceBase = commitCount
        }
        liveTail = final ? "" : (all.last ?? "")
        if final { utteranceBase = 0 }     // next utterance starts fresh
        trim()
    }

    /// Drop words older than the fade window, and cap to the bar width.
    private func trim() {
        let cutoff = Date().addingTimeInterval(-fadeSeconds)
        words.removeAll { $0.at < cutoff }
        if words.count > maxWords { words.removeFirst(words.count - maxWords) }
    }

    /// Tick once a second so words expire on time even when nobody's talking.
    private func startCleanup() {
        cleanupTask?.cancel()
        cleanupTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self, self.isListening else { return }
                self.trim()
            }
        }
    }

    private func teardown() {
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); request = nil
        task?.cancel(); task = nil
    }
}

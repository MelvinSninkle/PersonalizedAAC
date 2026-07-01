import Foundation
import Speech
import AVFoundation
import Observation

/// Listening Mode's speech engine. Wraps Apple's `SFSpeechRecognizer` +
/// `AVAudioEngine` and streams the live partial transcript to `transcript`.
///
/// Tries ON-DEVICE (offline) recognition first when the language pack is present,
/// and falls back to online recognition if the on-device model errors. iOS ends a
/// recognition session after a pause / ~1 minute, so we transparently restart
/// while `isListening`. Any failure is surfaced in `status` (shown in the strip)
/// instead of failing silently.
@MainActor
@Observable
final class SpeechListener {
    /// Latest partial transcript of the current utterance.
    var transcript: String = ""
    var isListening: Bool = false
    /// Human-readable state / error, shown in the strip when no words yet.
    var status: String = ""

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var useOnDevice = true
    private var restarts = 0

    func start() {
        guard !isListening else { return }
        transcript = ""
        status = "Starting…"
        useOnDevice = (recognizer?.supportsOnDeviceRecognition == true)
        restarts = 0
        SFSpeechRecognizer.requestAuthorization { [weak self] auth in
            AVAudioApplication.requestRecordPermission { mic in
                Task { @MainActor in
                    guard let self else { return }
                    guard auth == .authorized else { self.status = "Speech permission denied — enable it in Settings › My World."; return }
                    guard mic else { self.status = "Microphone permission denied — enable it in Settings › My World."; return }
                    guard self.recognizer?.isAvailable == true else { self.status = "Speech recognizer unavailable (needs network, or a downloaded language)."; return }
                    self.isListening = true
                    self.beginSession()
                }
            }
        }
    }

    func stop() {
        isListening = false
        teardown()
        transcript = ""
        status = ""
        // Restore the app's normal playback session so tile audio keeps working.
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, options: [.duckOthers])
        try? s.setActive(true)
    }

    private func beginSession() {
        guard isListening else { return }
        teardown()   // clean slate before each (re)start

        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playAndRecord, mode: .default,
                              options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
            try s.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            status = "Audio session error: \(error.localizedDescription)"; isListening = false; return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = useOnDevice   // offline when available
        request = req

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { status = "Microphone format unavailable."; isListening = false; return }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        audioEngine.prepare()
        do { try audioEngine.start() }
        catch { status = "Mic start error: \(error.localizedDescription)"; isListening = false; return }

        status = useOnDevice ? "Listening (on-device)…" : "Listening…"
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                    self.status = ""          // got words — clear the diagnostic line
                    self.restarts = 0
                }
                if let error {
                    // On-device can fail if the model isn't downloaded — fall back
                    // to online recognition once, then keep going.
                    if self.useOnDevice {
                        self.useOnDevice = false
                        self.status = "On-device not ready — using online…"
                        if self.isListening { self.beginSession() }
                        return
                    }
                    self.status = "Recognition error: \(error.localizedDescription)"
                }
                if (result?.isFinal ?? false) || error != nil {
                    // Utterance ended (silence / time cap). Restart while still on,
                    // but guard against a tight error loop that never yields words.
                    self.restarts += 1
                    if self.isListening && self.restarts < 40 {
                        self.beginSession()
                    } else if self.restarts >= 40 {
                        self.status = "Stopped — no speech detected."
                        self.isListening = false
                        self.teardown()
                    }
                }
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

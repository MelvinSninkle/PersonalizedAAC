import Foundation
import Speech
import AVFoundation
import Observation

/// Listening Mode's speech engine. Wraps Apple's `SFSpeechRecognizer` and streams
/// the live partial transcript to `transcript`. Uses ON-DEVICE (offline)
/// recognition when the language pack is present (`requiresOnDeviceRecognition`),
/// falling back to server recognition otherwise. iOS ends a recognition session
/// after a pause / ~1 minute, so we transparently restart while `isListening`.
///
/// This is the native equivalent of the web board's Capacitor speech bridge —
/// but native gets Apple's framework directly, so there's no plugin/patch.
@MainActor
@Observable
final class SpeechListener {
    /// Latest partial transcript of the current utterance.
    var transcript: String = ""
    var isListening: Bool = false
    var errorText: String?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    /// Ask for speech + mic permission (once), then start. Safe to call again.
    func start() {
        guard !isListening else { return }
        errorText = nil
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            AVAudioApplication.requestRecordPermission { granted in
                Task { @MainActor in
                    guard let self else { return }
                    guard status == .authorized else { self.errorText = "Speech permission needed."; return }
                    guard granted else { self.errorText = "Microphone permission needed."; return }
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
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func beginSession() {
        guard isListening else { return }
        teardown()   // clean slate before each (re)start

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement,
                                    options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            errorText = "Could not start audio."; isListening = false; return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer?.supportsOnDeviceRecognition == true {
            req.requiresOnDeviceRecognition = true   // offline / on-device
        }
        request = req

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        audioEngine.prepare()
        do { try audioEngine.start() }
        catch { errorText = "Could not start the microphone."; isListening = false; return }

        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                }
                if error != nil || (result?.isFinal ?? false) {
                    // Session ended (silence / time cap) — restart if still on.
                    if self.isListening { self.beginSession() }
                }
            }
        }
    }

    private func teardown() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        request = nil
        task?.cancel()
        task = nil
    }
}

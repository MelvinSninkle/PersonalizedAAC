import Foundation
import CryptoKit

/// On-disk cache for ElevenLabs TTS audio — every phrase the iPad asks for
/// (slideshow captions, scheduled prompt narration, message-to-board fallback
/// text, reward cheers) gets persisted on first generation and replayed
/// instantly thereafter.
///
/// Why a separate cache from MediaCache (which keys by Blob key):
/// • TTS calls are content-derived (text + emotion); there's no stable Blob
///   key the iPad can know up front.
/// • The server side now caches by sha256(model|voice|emotion|text); we mirror
///   that hash here so the iPad's disk lookup is consistent with the server's.
///
/// The first playback of "This is a dog" pays the ElevenLabs API round-trip
/// once (~600-1500ms). Every subsequent playback is a file read — no network,
/// works offline, no quota burn.
actor SpeechCache {
    static let shared = SpeechCache()

    private let dir: URL
    private var inFlight: [String: Task<Data, Error>] = [:]

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dir = docs.appendingPathComponent("speech", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /// Returns the MP3 bytes for a phrase + emotion, fetching from /api/tts on
    /// miss. Concurrent calls for the same phrase share the in-flight fetch
    /// (so a slideshow that asks twice in fast succession doesn't double up).
    func data(text: String, emotion: String, api: APIClient) async -> Data? {
        let key = Self.key(text: text, emotion: emotion)
        let file = dir.appendingPathComponent(key + ".mp3")
        if let d = try? Data(contentsOf: file, options: .mappedIfSafe) { return d }
        if let task = inFlight[key] { return try? await task.value }
        let task = Task<Data, Error> {
            guard let bytes = await api.tts(text: text, emotion: emotion) else {
                throw NSError(domain: "SpeechCache", code: -1)
            }
            try? bytes.write(to: file, options: .atomic)
            return bytes
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        return try? await task.value
    }

    /// Pre-warm the cache for a known set of phrases — useful before a
    /// slideshow starts so the first slide doesn't wait on the network.
    func warm(phrases: [(text: String, emotion: String)], api: APIClient, concurrency: Int = 4) async {
        var it = phrases.makeIterator()
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<concurrency {
                if let phrase = it.next() {
                    group.addTask { [weak self] in
                        _ = await self?.data(text: phrase.text, emotion: phrase.emotion, api: api)
                    }
                }
            }
            while await group.next() != nil {
                if let phrase = it.next() {
                    group.addTask { [weak self] in
                        _ = await self?.data(text: phrase.text, emotion: phrase.emotion, api: api)
                    }
                }
            }
        }
    }

    func clear() {
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /// Same hash recipe the server uses (sans model+voice, which the device
    /// can't know reliably — collisions across voice changes are caught by
    /// the server cache anyway).
    private static func key(text: String, emotion: String) -> String {
        let raw = "\(emotion)|\(text)"
        let h = SHA256.hash(data: Data(raw.utf8))
        return h.compactMap { String(format: "%02x", $0) }.joined().prefix(40).lowercased()
    }
}

import Foundation
import UIKit

/// On-disk cache for tile images + audio clips. Keys are the same blob keys
/// the server returns (`imageKey`, `soundKey`).
///
/// Why filesystem instead of Core Data: blobs can be hundreds of KB and we
/// want zero-copy mmap when SwiftUI's `Image(uiImage:)` loads them. A flat
/// `Documents/media/<sha256(key)>.bin` is the simplest thing that works.
actor MediaCache {
    static let shared = MediaCache()

    private let dir: URL
    private let api = APIClient()
    private var inFlight: [String: Task<Data, Error>] = [:]

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dir = docs.appendingPathComponent("media", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /// Returns the cached bytes for a blob key, fetching from /api/media on
    /// miss. Concurrent calls for the same key share the in-flight fetch.
    func data(for key: String) async throws -> Data {
        let file = path(for: key)
        if let d = try? Data(contentsOf: file, options: .mappedIfSafe) {
            return d
        }
        if let task = inFlight[key] {
            return try await task.value
        }
        let task = Task<Data, Error> {
            let (bytes, _) = try await api.media(key: key)
            try bytes.write(to: file, options: .atomic)
            return bytes
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        return try await task.value
    }

    /// Convenience: load + decode a UIImage. Returns nil if the bytes don't
    /// decode (corrupt cache entry → caller can re-fetch by deleting + retrying).
    func image(for key: String) async -> UIImage? {
        do {
            let data = try await data(for: key)
            return UIImage(data: data)
        } catch {
            return nil
        }
    }

    /// File URL that AVAudioPlayer can play directly.
    func audioFileURL(for key: String) async throws -> URL {
        let file = path(for: key)
        if !FileManager.default.fileExists(atPath: file.path) {
            _ = try await data(for: key)
        }
        return file
    }

    /// Remove every cached blob. Used by Settings → "Clear cache".
    func clear() {
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private func path(for key: String) -> URL {
        // Hash the key so weird characters / long names don't break the FS.
        let safe = key.data(using: .utf8).map { sha256Hex($0) } ?? key
        return dir.appendingPathComponent(safe).appendingPathExtension("bin")
    }

    private func sha256Hex(_ data: Data) -> String {
        // Avoid pulling in CryptoKit just for a stable filename — DJB2 is
        // plenty for collision-resistance at our scale (few thousand keys).
        var hash: UInt64 = 5381
        for byte in data {
            hash = ((hash << 5) &+ hash) &+ UInt64(byte)
        }
        return String(hash, radix: 16)
    }
}

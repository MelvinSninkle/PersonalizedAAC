import Foundation
import ImageIO
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
            // Images download the server's 1024px webp variant: identical on
            // screen (nothing displays larger than 1024) at ~10% of the PNG
            // bytes, so first sync / board warm-up is much faster. Audio and
            // already-cached files are untouched (cache is keyed by blob key).
            let isImage = ["png", "jpg", "jpeg", "webp"].contains((key as NSString).pathExtension.lowercased())
            let (bytes, _) = try await api.media(key: key, w: isImage ? 1024 : nil)
            try bytes.write(to: file, options: .atomic)
            return bytes
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        return try await task.value
    }

    /// Eagerly download a batch of blob keys into the cache so the board is
    /// fully populated before the child taps anything — no "blank until you
    /// open the category" gaps. Bounded concurrency keeps it orderly and from
    /// saturating the connection. Already-cached keys are skipped cheaply.
    func warm(_ keys: [String], concurrency: Int = 6) async {
        var seen = Set<String>()
        let ordered = keys.filter { !$0.isEmpty && seen.insert($0).inserted }
        var it = ordered.makeIterator()
        await withTaskGroup(of: Void.self) { group in
            func addNext() {
                guard let key = it.next() else { return }
                group.addTask { _ = try? await self.data(for: key) }
            }
            for _ in 0..<max(1, concurrency) { addNext() }
            while await group.next() != nil { addNext() }
        }
    }

    /// Convenience: load + decode a UIImage. Returns nil if the bytes don't
    /// decode (corrupt cache entry → caller can re-fetch by deleting + retrying).
    ///
    /// `maxPixel` bounds the DECODED size, not the file: a grid of tiles that
    /// decodes every source at full resolution (~4 MB of RAM per 1024² image)
    /// is what jetsams the app when a search opens hundreds of thumbnails.
    /// ImageIO's thumbnailing decodes straight to the target size, so memory
    /// scales with what's on screen. Pass nil for full resolution (slideshow).
    func image(for key: String, maxPixel: Int? = nil) async -> UIImage? {
        do {
            let data = try await data(for: key)
            if let maxPixel, let small = MediaCache.downsampled(data, maxPixel: maxPixel) {
                return small
            }
            return UIImage(data: data)
        } catch {
            return nil
        }
    }

    private nonisolated static func downsampled(_ data: Data, maxPixel: Int) -> UIImage? {
        let srcOpts = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let src = CGImageSourceCreateWithData(data as CFData, srcOpts) else { return nil }
        let opts = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ] as CFDictionary
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts) else { return nil }
        return UIImage(cgImage: cg)
    }

    /// Seed the cache for `key` with the bytes already cached under
    /// `sourceKey` — same pixels under a new blob key (a revert re-homes the
    /// image to a fresh child-owned key). The board swaps instantly instead
    /// of waiting on a cold download + server-side variant build.
    func seed(key: String, fromCached sourceKey: String) {
        let src = path(for: sourceKey)
        let dst = path(for: key)
        guard FileManager.default.fileExists(atPath: src.path),
              !FileManager.default.fileExists(atPath: dst.path) else { return }
        try? FileManager.default.copyItem(at: src, to: dst)
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

import Foundation
import SwiftUI
import UIKit
import Observation

/// Art styles offered when generating a tile. `prompt` is what we send to
/// /api/generate-image as the `style` param; `label` is the parent-facing name.
/// Mirrors the web dashboard's style dropdown.
enum ArtStyle: String, CaseIterable, Identifiable {
    case threeD, pictureBook, watercolor, soft, felted
    var id: String { rawValue }
    var label: String {
        switch self {
        case .threeD:      return "3D Animated"
        case .pictureBook: return "Picture Book"
        case .watercolor:  return "Watercolor"
        case .soft:        return "Soft Storybook"
        case .felted:      return "Felted"
        }
    }
    var prompt: String {
        switch self {
        case .threeD:      return "Pixar-style 3D animated render"
        case .pictureBook: return "flat picture-book illustration"
        case .watercolor:  return "soft watercolor illustration"
        case .soft:        return "gentle soft storybook illustration"
        case .felted:      return "needle-felted wool craft"
        }
    }
}

/// One background "make a tile from this photo" job. Observable so its progress
/// ring + status text update live in the tray while the AI chain runs.
///
/// The parent never waits on this: the moment a photo is captured a job is
/// created and the camera is free again. Jobs render concurrently and auto-add
/// to the board when finished. A job only stops to ask for help in two cases —
/// the AI couldn't name the photo, or a step errored — both surfaced as a
/// tappable card.
@MainActor
@Observable
final class TileJob: Identifiable {
    let id = UUID()
    /// The captured photo, shown as the card's backdrop while it processes.
    let thumbnail: UIImage
    let photoJPEG: Data
    /// Destination chosen for the batch. Mutable so a per-tile edit can move it.
    var section: BoardSection
    var categoryId: Int?
    let style: ArtStyle
    let emotion: String
    let childId: String

    enum Phase: Equatable {
        case working          // AI chain in flight (progress ring)
        case done             // saved + on the board (checkmark)
        case needsAttention   // can't auto-finish — see `errorText` vs empty label
    }
    var phase: Phase = .working
    /// 0…1 for the ring. Estimated during the long image step (no real % from
    /// the API) — eases toward a ceiling, then snaps to done.
    var progress: Double = 0
    var statusText = "Saved — making the tile…"

    var label = ""
    var pronunciation = ""
    var errorText: String?

    // Carried so an edit/retry can reuse work instead of re-shooting.
    var imagePNG: Data?
    var soundMP3: Data?
    /// Set once the tile row exists on the server (nil = not saved yet).
    var savedTileId: Int?

    init(thumbnail: UIImage, photoJPEG: Data, section: BoardSection,
         categoryId: Int?, style: ArtStyle, emotion: String, childId: String) {
        self.thumbnail = thumbnail
        self.photoJPEG = photoJPEG
        self.section = section
        self.categoryId = categoryId
        self.style = style
        self.emotion = emotion
        self.childId = childId
    }
}

/// App-level queue that runs `TileJob`s. Lives in the environment (created in
/// `MyWorldApp`) rather than inside the Add-Tile sheet, so a parent can fire off
/// several photos, close the sheet, and the tiles still finish rendering and
/// land on the board on their own.
@MainActor
@Observable
final class AddTileQueue {
    /// Newest first, so the tray reads top-to-bottom like a feed.
    var jobs: [TileJob] = []

    private let api = APIClient()

    /// True while anything is still rendering — used to badge the board header
    /// so the parent knows tiles are still on the way after closing the sheet.
    var hasActiveJobs: Bool { jobs.contains { $0.phase == .working } }

    // MARK: -- Enqueue / manage

    @discardableResult
    func enqueue(photoJPEG: Data,
                 section: BoardSection,
                 categoryId: Int?,
                 style: ArtStyle,
                 emotion: String,
                 prefilledLabel: String,
                 childId: String,
                 board: BoardStore) -> TileJob {
        let thumb = UIImage(data: photoJPEG) ?? UIImage()
        let job = TileJob(thumbnail: thumb, photoJPEG: photoJPEG, section: section,
                          categoryId: categoryId, style: style, emotion: emotion, childId: childId)
        job.label = prefilledLabel
        jobs.insert(job, at: 0)
        Task { await process(job, board: board) }
        return job
    }

    func remove(_ job: TileJob) { jobs.removeAll { $0.id == job.id } }

    /// Drop finished cards (they're already on the board). Called when the sheet
    /// reopens so the tray starts clean but still shows anything mid-flight.
    func pruneFinished() { jobs.removeAll { $0.phase == .done } }

    func retry(_ job: TileJob, board: BoardStore) {
        job.phase = .working
        job.progress = 0
        job.errorText = nil
        job.statusText = "Trying again…"
        Task { await process(job, board: board) }
    }

    // MARK: -- The chain

    private func process(_ job: TileJob, board: BoardStore) async {
        do {
            // 1) Vision: auto-name + phonetic spelling. Best-effort — if the org
            //    isn't verified for vision it returns empties and we lean on the
            //    label the parent may have pre-typed for the batch.
            job.statusText = "🔍 Naming it…"
            let desc: APIClient.DescribeResult? = await animating(job, to: 0.12, over: 3) {
                try? await self.api.describeImage(photoJPEG: job.photoJPEG)
            }
            if let desc {
                if job.label.isEmpty,          !desc.label.isEmpty         { job.label = desc.label }
                if job.pronunciation.isEmpty,  !desc.pronunciation.isEmpty { job.pronunciation = desc.pronunciation }
            }

            // 2) Stylized art (~20–40s). The slow step — the ring eases toward
            //    0.85 over ~28s and holds there if the API runs long.
            job.statusText = "🎨 Painting the picture…"
            let png = try await animating(job, to: 0.85, over: 28, {
                try await self.api.generateImage(photoJPEG: job.photoJPEG,
                                                 label: job.label,
                                                 style: job.style.prompt,
                                                 childId: job.childId)
            })
            job.imagePNG = png
            job.progress = 0.85

            // If vision struck out AND no batch label was set, we have art but
            // nothing to call it. Park the job for a one-tap name rather than
            // saving a nameless tile to the child's board.
            if job.label.trimmingCharacters(in: .whitespaces).isEmpty {
                job.phase = .needsAttention
                job.statusText = "Tap to name it"
                return
            }

            // 3) Voice (phrase wins, else the label).
            job.statusText = "🔊 Making the voice…"
            let speak = job.pronunciation.isEmpty ? job.label : job.pronunciation
            let mp3 = try await animating(job, to: 0.93, over: 3, {
                try await self.api.synthesizeSpeech(text: speak, emotion: job.emotion)
            })
            job.soundMP3 = mp3

            // 4) Upload both blobs + create the row. Auto-adds to the board.
            job.statusText = "💾 Adding to the board…"
            async let imageKeyT = api.uploadBlob(png, kind: "item-image", ext: "png", contentType: "image/png")
            async let soundKeyT = api.uploadBlob(mp3, kind: "item-sound", ext: "mp3", contentType: "audio/mpeg")
            let imageKey = try await imageKeyT
            let soundKey = try await soundKeyT

            let tile = try await api.createItem(section: job.section.rawValue,
                                                categoryId: job.categoryId,
                                                label: job.label,
                                                imageKey: imageKey,
                                                soundKey: soundKey,
                                                keepAspect: false,
                                                description: nil,
                                                childId: job.childId)
            job.savedTileId = tile.id
            job.progress = 1.0
            job.phase = .done
            job.statusText = "✅ On the board"
            await board.refresh(childId: job.childId)
        } catch {
            job.phase = .needsAttention
            job.errorText = friendly(error)
            job.statusText = "Didn't finish"
        }
    }

    /// Run `work`, easing `job.progress` from its current value toward `ceiling`
    /// over ~`seconds` meanwhile. The animator is cancelled as soon as the real
    /// work returns, so a fast response snaps ahead and a slow one parks just
    /// shy of the ceiling — honest "still going" feedback without a fake 100%.
    private func animating<T>(_ job: TileJob,
                              to ceiling: Double,
                              over seconds: Double,
                              _ work: () async throws -> T) async rethrows -> T {
        let start = job.progress
        let anim = Task { @MainActor in
            let steps = 50
            for i in 1...steps {
                try? await Task.sleep(nanoseconds: UInt64((seconds / Double(steps)) * 1_000_000_000))
                if Task.isCancelled { return }
                job.progress = start + (ceiling - start) * (Double(i) / Double(steps))
            }
        }
        defer { anim.cancel() }
        return try await work()
    }

    private func friendly(_ error: Error) -> String {
        if let api = error as? APIError {
            switch api {
            case .badStatus(_, let body):
                if body.range(of: "must be verified", options: .caseInsensitive) != nil {
                    return "OpenAI organization isn't verified for image generation. Open platform.openai.com → Settings → Organization → Verify, then retry."
                }
                return body.isEmpty ? "Server error." : String(body.prefix(160))
            case .notAuthenticated: return "Signed out — log in and retry."
            case .transport(let e): return "Network problem: \(e.localizedDescription)"
            case .invalidResponse:  return "Unexpected server response."
            case .decoding:         return "Couldn't read the server's response."
            }
        }
        return error.localizedDescription
    }
}

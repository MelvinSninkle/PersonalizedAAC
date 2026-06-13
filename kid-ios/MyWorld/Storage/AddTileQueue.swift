import Foundation
import SwiftUI
import UIKit
import Observation

/// Which image model to generate with — selectable from the add-tile UI so a
/// parent can experiment. `apiValue` is sent to /api/generate-image as the
/// `model` param (server allow-lists these; gemini-* routes to Nano Banana).
enum ImageModel: String, CaseIterable, Identifiable {
    // Default first — Nano Banana is cheapest AND strongest at keeping a
    // person's likeness from a reference photo.
    case nanoBanana, nanoBananaPro, gpt15, gpt2, gpt1
    var id: String { rawValue }
    var apiValue: String {
        switch self {
        case .nanoBanana:    return "gemini-2.5-flash-image"
        case .nanoBananaPro: return "gemini-3-pro-image-preview"
        case .gpt15:         return "gpt-image-1.5"
        case .gpt2:          return "gpt-image-2"
        case .gpt1:          return "gpt-image-1"
        }
    }
    var label: String {
        switch self {
        case .nanoBanana:    return "Nano Banana · ~4¢ (default)"
        case .nanoBananaPro: return "Nano Banana Pro · ~13¢"
        case .gpt15:         return "GPT Image 1.5 · ~13¢"
        case .gpt2:          return "GPT Image 2 · ~21¢"
        case .gpt1:          return "GPT Image 1 · cheapest"
        }
    }
}

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
    /// OpenAI image model id (e.g. "gpt-image-1.5") chosen for this tile.
    let model: String
    let emotion: String
    let childId: String
    /// Non-nil when this job is part of a multi-photo bulk import. Used to fire
    /// the "review N tiles" notice once the whole batch has settled.
    let batchId: UUID?
    /// Bulk-imported tiles auto-add to the board but ask the parent to review;
    /// single snaps are final on save. Drives the `needsReview` flag on create.
    let needsReview: Bool

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
         categoryId: Int?, style: ArtStyle, model: String, emotion: String, childId: String,
         batchId: UUID? = nil, needsReview: Bool = false) {
        self.thumbnail = thumbnail
        self.photoJPEG = photoJPEG
        self.section = section
        self.categoryId = categoryId
        self.style = style
        self.model = model
        self.emotion = emotion
        self.childId = childId
        self.batchId = batchId
        self.needsReview = needsReview
    }
}

/// Fired when a bulk import finishes so the board can pop a "review these"
/// banner. Identifiable so it can drive a SwiftUI alert/sheet/banner.
struct ReviewNotice: Identifiable, Equatable {
    let id = UUID()
    let count: Int        // how many tiles in the batch landed successfully
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

    // Concurrency gate. A bulk import of 20 photos must NOT fire 20 image
    // generations at once — that invites rate limits and runs up cost. We keep
    // at most `maxConcurrent` jobs rendering and queue the rest; the tray still
    // feels parallel (3 rings spinning) without hammering the API.
    private let maxConcurrent = 3
    private var inFlight = 0
    private var waiting: [(TileJob, BoardStore)] = []

    /// True while anything is still rendering — used to badge the board header
    /// so the parent knows tiles are still on the way after closing the sheet.
    var hasActiveJobs: Bool { jobs.contains { $0.phase == .working } }

    /// Set when a bulk import settles; the board watches this to pop the review
    /// banner. Cleared when the parent opens or dismisses the review.
    var pendingReviewNotice: ReviewNotice?

    // MARK: -- Enqueue / manage

    @discardableResult
    func enqueue(photoJPEG: Data,
                 section: BoardSection,
                 categoryId: Int?,
                 style: ArtStyle,
                 model: String,
                 emotion: String,
                 prefilledLabel: String,
                 childId: String,
                 board: BoardStore,
                 batchId: UUID? = nil,
                 needsReview: Bool = false) -> TileJob {
        let thumb = UIImage(data: photoJPEG) ?? UIImage()
        let job = TileJob(thumbnail: thumb, photoJPEG: photoJPEG, section: section,
                          categoryId: categoryId, style: style, model: model, emotion: emotion,
                          childId: childId, batchId: batchId, needsReview: needsReview)
        job.label = prefilledLabel
        jobs.insert(job, at: 0)
        schedule(job, board: board)
        return job
    }

    /// Start the job now if there's a free slot, else hold it until one frees.
    private func schedule(_ job: TileJob, board: BoardStore) {
        guard inFlight < maxConcurrent else {
            waiting.append((job, board))
            job.statusText = "Waiting its turn…"
            return
        }
        inFlight += 1
        Task { await runAndRelease(job, board: board) }
    }

    private func runAndRelease(_ job: TileJob, board: BoardStore) async {
        await process(job, board: board)
        inFlight -= 1
        if !waiting.isEmpty {
            let (next, nextBoard) = waiting.removeFirst()
            inFlight += 1
            Task { await runAndRelease(next, board: nextBoard) }
        }
    }

    /// Enqueue a whole photo-library multi-selection as one reviewable batch.
    /// Every photo renders in the background (auto-adding to the board with the
    /// review flag set); when the last one settles, `pendingReviewNotice` fires
    /// so the parent gets the "review N tiles" prompt.
    func enqueueBatch(photos: [Data],
                      section: BoardSection,
                      categoryId: Int?,
                      style: ArtStyle,
                      model: String,
                      emotion: String,
                      childId: String,
                      board: BoardStore) {
        let batchId = UUID()
        for photo in photos {
            _ = enqueue(photoJPEG: photo,
                        section: section,
                        categoryId: categoryId,
                        style: style,
                        model: model,
                        emotion: emotion,
                        prefilledLabel: "",
                        childId: childId,
                        board: board,
                        batchId: batchId,
                        needsReview: true)
        }
    }

    func remove(_ job: TileJob) {
        jobs.removeAll { $0.id == job.id }
        waiting.removeAll { $0.0.id == job.id }   // drop it if still queued
    }

    /// Drop finished cards (they're already on the board). Called when the sheet
    /// reopens so the tray starts clean but still shows anything mid-flight.
    func pruneFinished() { jobs.removeAll { $0.phase == .done } }

    func retry(_ job: TileJob, board: BoardStore) {
        job.phase = .working
        job.progress = 0
        job.errorText = nil
        job.statusText = "Trying again…"
        schedule(job, board: board)
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

            // 2) Stylized art (~20-120s depending on model + quality). The slow
            //    step — the ring eases toward 0.85 over ~90s (covers most
            //    gpt-image-1.5 / -2 high-quality runs) and parks there if the
            //    API runs longer; the request itself has 300s+ of headroom.
            job.statusText = "🎨 Painting the picture…"
            let png = try await animating(job, to: 0.85, over: 90, {
                try await self.api.generateImage(photoJPEG: job.photoJPEG,
                                                 label: job.label,
                                                 style: job.style.prompt,
                                                 model: job.model,
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
                                                needsReview: job.needsReview,
                                                childId: job.childId)
            job.savedTileId = tile.id
            job.progress = 1.0
            job.phase = .done
            job.statusText = job.needsReview ? "✅ On the board — needs review" : "✅ On the board"
            await board.refresh(childId: job.childId)
        } catch {
            job.phase = .needsAttention
            job.errorText = friendly(error)
            job.statusText = "Didn't finish"
        }
        // Whether it landed or stumbled, check if this was the last straggler
        // in a bulk import — if so, prompt the parent to review the batch.
        checkBatchCompletion(job.batchId)
    }

    /// Fire the review notice once every job in a bulk batch has stopped
    /// working (done or needs-attention). Counts only the ones that made it
    /// onto the board.
    private func checkBatchCompletion(_ batchId: UUID?) {
        guard let batchId else { return }
        let inBatch = jobs.filter { $0.batchId == batchId }
        guard !inBatch.isEmpty, inBatch.allSatisfy({ $0.phase != .working }) else { return }
        let landed = inBatch.filter { $0.phase == .done }.count
        guard landed > 0 else { return }
        pendingReviewNotice = ReviewNotice(count: landed)
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

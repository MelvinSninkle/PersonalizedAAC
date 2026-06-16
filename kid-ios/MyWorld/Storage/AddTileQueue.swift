import Foundation
import SwiftUI
import UIKit
import Observation

/// Which image model to generate with — selectable from the add-tile UI so a
/// parent can experiment. `apiValue` is sent to /api/tile-jobs as the `model`
/// param (server allow-lists these; gemini-* routes to Nano Banana).
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
/// /api/tile-jobs as the `style` param; `label` is the parent-facing name.
/// Mirrors the web dashboard's style dropdown. NOTE: visual consistency comes
/// from the child's saved STYLE-GUIDE image (resolved server-side), not this
/// text — this just nudges the descriptor.
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

/// One "make a tile from this photo" job, as shown in the tray. The work itself
/// runs SERVER-SIDE now (api/tile-jobs): the photo is uploaded once (and is safe
/// the instant that returns), then the server renders + voices + places the tile
/// and a cron guarantees completion. This object just mirrors the server job's
/// status for the tray, polled by `AddTileQueue`.
@MainActor
@Observable
final class TileJob: Identifiable {
    let id = UUID()
    /// The captured photo, shown as the card's backdrop while it processes.
    let thumbnail: UIImage
    let photoJPEG: Data
    var section: BoardSection
    var categoryId: Int?
    let style: ArtStyle
    let model: String
    let bg: String
    let emotion: String
    let childId: String
    /// Non-nil when part of a multi-photo bulk import (drives the review notice).
    let batchId: UUID?
    /// Bulk imports auto-add but ask for review; single snaps are final.
    var needsReview: Bool

    /// The server job id once the upload has returned. Until then the job is
    /// uploading; after, the tray polls the server by this id.
    var serverId: Int?

    enum Phase: Equatable {
        case working          // uploading or rendering server-side
        case done             // tile is on the board
        case needsAttention   // upload/terminal failure — see errorText, or unnamed
    }
    var phase: Phase = .working
    var progress: Double = 0
    var statusText = "Saved — making the tile…"

    var label = ""
    /// Parent's optional "here's more info" detail passed to generation.
    var detail = ""
    var errorText: String?
    /// True when the server kept the raw photo because art generation failed.
    var artFailed = false

    // Kept so TileEditSheet/retry can reuse work. (imagePNG/soundMP3 are unused
    // in the server model but retained so the tray editor still compiles.)
    var imagePNG: Data?
    var soundMP3: Data?
    /// Set to the created item id once the server job is done.
    var savedTileId: Int?

    init(thumbnail: UIImage, photoJPEG: Data, section: BoardSection,
         categoryId: Int?, style: ArtStyle, model: String, bg: String, emotion: String,
         childId: String, batchId: UUID? = nil, needsReview: Bool = false) {
        self.thumbnail = thumbnail
        self.photoJPEG = photoJPEG
        self.section = section
        self.categoryId = categoryId
        self.style = style
        self.model = model
        self.bg = bg
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

/// App-level queue that drives the SERVER-SIDE tile pipeline. The parent fires
/// off photos; each is uploaded to /api/tile-jobs (durably — the photo can't be
/// lost) and the server does the slow work. The queue polls the server for
/// status so the tray updates live, and the tiles land on the board on their own
/// even if the sheet is closed or the app restarts.
@MainActor
@Observable
final class AddTileQueue {
    /// Newest first, so the tray reads top-to-bottom like a feed.
    var jobs: [TileJob] = []

    private let api = APIClient()

    /// Set when a bulk import settles; the board watches this to pop the review
    /// banner. Cleared when the parent opens or dismisses the review.
    var pendingReviewNotice: ReviewNotice?

    // Poll loop + the context it needs to refresh the board on completion.
    private var pollTask: Task<Void, Never>?
    private var board: BoardStore?
    private var childId: String = ""
    /// Batches we've already announced, so the review notice fires once.
    private var announcedBatches: Set<UUID> = []

    var hasActiveJobs: Bool { jobs.contains { $0.phase == .working } }

    // MARK: -- Enqueue

    @discardableResult
    func enqueue(photoJPEG: Data,
                 section: BoardSection,
                 categoryId: Int?,
                 style: ArtStyle,
                 model: String,
                 bg: String = "pink",
                 emotion: String,
                 prefilledLabel: String,
                 prefilledDetail: String = "",
                 childId: String,
                 board: BoardStore,
                 batchId: UUID? = nil,
                 needsReview: Bool = false) -> TileJob {
        self.board = board
        self.childId = childId
        let thumb = UIImage(data: photoJPEG) ?? UIImage()
        let job = TileJob(thumbnail: thumb, photoJPEG: photoJPEG, section: section,
                          categoryId: categoryId, style: style, model: model, bg: bg,
                          emotion: emotion, childId: childId, batchId: batchId,
                          needsReview: needsReview)
        job.label = prefilledLabel
        job.detail = prefilledDetail
        job.statusText = "Uploading photo…"
        job.progress = 0.05
        jobs.insert(job, at: 0)
        Task { await upload(job) }
        ensurePolling()
        return job
    }

    func enqueueBatch(photos: [Data],
                      section: BoardSection,
                      categoryId: Int?,
                      style: ArtStyle,
                      model: String,
                      bg: String = "pink",
                      emotion: String,
                      childId: String,
                      board: BoardStore) {
        let batchId = UUID()
        for photo in photos {
            _ = enqueue(photoJPEG: photo, section: section, categoryId: categoryId,
                        style: style, model: model, bg: bg, emotion: emotion,
                        prefilledLabel: "", childId: childId, board: board,
                        batchId: batchId, needsReview: true)
        }
    }

    /// Upload the photo to the durable server queue. The moment this returns the
    /// photo is safe server-side; the server renders the tile from there.
    private func upload(_ job: TileJob) async {
        do {
            let serverId = try await api.createTileJob(
                photoJPEG: job.photoJPEG,
                label: job.label,
                detail: job.detail,
                section: job.section.rawValue,
                categoryId: job.categoryId,
                style: job.style.prompt,
                styleGuideId: nil,                 // server resolves the child's house style
                model: job.model,
                bg: job.bg,
                keepAspect: false,
                needsReview: job.needsReview,
                emotion: job.emotion,
                childId: job.childId)
            job.serverId = serverId
            job.statusText = "Saved — making the tile…"
            job.progress = max(job.progress, 0.15)
        } catch {
            job.phase = .needsAttention
            job.errorText = friendly(error)
            job.statusText = "Upload failed — tap Retry"
        }
    }

    // MARK: -- Polling

    private func ensurePolling() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in await self?.pollLoop() }
    }

    private func pollLoop() async {
        while !Task.isCancelled {
            // Stop when nothing is in flight (an upload-failed card is terminal
            // until the parent retries, which restarts polling).
            if !jobs.contains(where: { $0.phase == .working && $0.serverId != nil }) {
                // Still waiting on an in-flight upload? keep looping; else stop.
                if !jobs.contains(where: { $0.phase == .working }) { pollTask = nil; return }
            }
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await syncFromServer()
        }
        pollTask = nil
    }

    /// Pull server status and map it onto the tray jobs. Refreshes the board when
    /// a tile newly lands and fires the batch-review notice when a batch settles.
    func syncFromServer() async {
        guard !childId.isEmpty else { return }
        guard let server = try? await api.listTileJobs(childId: childId) else { return }
        let byId = Dictionary(uniqueKeysWithValues: server.map { ($0.id, $0) })

        var landed = false
        for job in jobs {
            guard let sid = job.serverId, let s = byId[sid] else { continue }
            switch s.status {
            case "done":
                if job.phase != .done { landed = true }
                job.phase = .done
                job.progress = 1.0
                if let l = s.label, !l.isEmpty { job.label = l }
                job.needsReview = s.needsReview
                job.artFailed = s.artFailed
                job.savedTileId = s.itemId
                job.errorText = nil
                job.statusText = s.needsReview ? "✅ On the board — needs review"
                    : (s.artFailed ? "✅ Saved your photo — art didn't render" : "✅ On the board")
            case "failed":
                if s.attempts >= 3 {
                    job.phase = .needsAttention
                    job.errorText = s.error ?? "Didn't finish"
                    job.statusText = "Didn't finish — tap Retry"
                } else {
                    job.statusText = "Trying again…"
                    job.progress = max(job.progress, 0.4)
                }
            case "processing":
                job.statusText = "🎨 Making the tile…"
                job.progress = max(job.progress, 0.6)
            default: // queued
                job.statusText = "Waiting its turn…"
                job.progress = max(job.progress, 0.2)
            }
        }

        if landed { await board?.refresh(childId: childId) }
        checkBatchCompletions()
    }

    /// Rebuild the tray from the server on sheet open / app launch, so in-flight
    /// jobs survive an app restart (they're durable server-side now). Restored
    /// jobs get a blank thumbnail — the real tile shows on the board when done.
    func restore(childId: String, board: BoardStore) async {
        self.board = board
        self.childId = childId
        guard let server = try? await api.listTileJobs(childId: childId) else { return }
        for s in server where s.status != "done" {
            guard !jobs.contains(where: { $0.serverId == s.id }) else { continue }
            let job = TileJob(thumbnail: UIImage(), photoJPEG: Data(), section: .nouns,
                              categoryId: nil, style: .soft, model: "", bg: "pink",
                              emotion: "default", childId: childId)
            job.serverId = s.id
            job.label = s.label ?? ""
            job.statusText = "Making the tile…"
            job.progress = 0.5
            jobs.append(job)
        }
        ensurePolling()
        await syncFromServer()
    }

    // MARK: -- Manage

    func remove(_ job: TileJob) {
        jobs.removeAll { $0.id == job.id }
        if let sid = job.serverId {
            Task { await api.deleteTileJob(id: sid, childId: childId) }
        }
    }

    /// Drop finished cards (they're already on the board).
    func pruneFinished() { jobs.removeAll { $0.phase == .done } }

    /// Retry a failed job by re-uploading its photo (a fresh server job). The old
    /// server job, if any, is dropped.
    func retry(_ job: TileJob, board: BoardStore) {
        self.board = board
        if !childId.isEmpty, let sid = job.serverId {
            Task { await api.deleteTileJob(id: sid, childId: childId) }
        }
        job.serverId = nil
        job.phase = .working
        job.progress = 0.05
        job.errorText = nil
        job.statusText = "Uploading photo…"
        Task { await upload(job) }
        ensurePolling()
    }

    private func checkBatchCompletions() {
        let batchIds = Set(jobs.compactMap { $0.batchId })
        for batchId in batchIds where !announcedBatches.contains(batchId) {
            let inBatch = jobs.filter { $0.batchId == batchId }
            guard !inBatch.isEmpty, inBatch.allSatisfy({ $0.phase != .working }) else { continue }
            let landed = inBatch.filter { $0.phase == .done }.count
            guard landed > 0 else { continue }
            announcedBatches.insert(batchId)
            pendingReviewNotice = ReviewNotice(count: landed)
        }
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

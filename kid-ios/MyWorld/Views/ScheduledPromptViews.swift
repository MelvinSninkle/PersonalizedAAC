import SwiftUI

/// The three faces of a scheduled prompt: a passive toast (reminder), an
/// interactive question modal, and a game nudge. BoardView picks the right
/// one based on the schedule's `type`. All three speak the prompt text using
/// the same /api/tts voice the game-completion cheers use.

// MARK: -- Reminder toast (auto-dismisses)

/// Top-floating pink card with the prompt + optional image. Disappears after
/// ~7s; tap to dismiss early. Mirrors web schedToast.
struct ReminderToast: View {
    let schedule: Schedule
    let onDismiss: () -> Void

    @Environment(AuthManager.self) private var auth
    @State private var image: UIImage?
    @State private var dismissTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 10) {
            if let img = image {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 130, height: 130)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .background(Color.white)
            }
            Text(schedule.defaultPromptText)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 22).padding(.vertical, 16)
        .background(Color(hex: "#ad1457"))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
        .padding(.top, 18)
        .frame(maxWidth: 520)
        .onTapGesture { close() }
        .task {
            await loadImage()
            GameAudio.shared.speak(schedule.defaultPromptText, childId: auth.childSlug)
            dismissTask?.cancel()
            dismissTask = Task {
                try? await Task.sleep(nanoseconds: 7_000_000_000)
                guard !Task.isCancelled else { return }
                await MainActor.run { close() }
            }
        }
        .onDisappear { dismissTask?.cancel() }
    }

    private func loadImage() async {
        guard let key = schedule.imageKey, !key.isEmpty else { return }
        if let img = await MediaCache.shared.image(for: key, maxPixel: 640) {
            await MainActor.run { self.image = img }
        }
    }

    private func close() { dismissTask?.cancel(); onDismiss() }
}

// MARK: -- Question sheet (interactive, logs the answer)

/// Modal with the prompt + a row of tappable response tiles. On tap we POST
/// to /api/interactions so the parent dashboard sees what was answered.
/// Auto-dismisses after the schedule's `durationSec` (default 60).
struct ScheduledQuestionSheet: View {
    let schedule: Schedule
    let onDismiss: () -> Void

    @Environment(AuthManager.self) private var auth
    @State private var promptImage: UIImage?
    @State private var answered = false
    @State private var dismissTask: Task<Void, Never>?

    /// Default to Yes/No if the parent didn't supply responses.
    private var responses: [Schedule.Response] {
        let list = schedule.responses ?? []
        let cleaned = list.filter { !$0.label.isEmpty || ($0.imageKey?.isEmpty == false) }
        return cleaned.isEmpty ? [.init(label: "Yes"), .init(label: "No")] : cleaned
    }

    var body: some View {
        ZStack {
            Color(hex: "#ad1457").opacity(0.4).ignoresSafeArea()
                .onTapGesture { close(answered: nil) }   // tap-outside cancels

            VStack(spacing: 22) {
                if let img = promptImage {
                    Image(uiImage: img)
                        .resizable().scaledToFill()
                        .frame(width: 150, height: 150)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                }
                Text(schedule.defaultPromptText)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .multilineTextAlignment(.center)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 14)], spacing: 14) {
                    ForEach(responses.indices, id: \.self) { i in
                        ResponseChip(response: responses[i]) {
                            close(answered: responses[i])
                        }
                    }
                }
            }
            .padding(28)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.25), radius: 30)
            .padding(.horizontal, 24)
            .frame(maxWidth: 520)
        }
        .task {
            await loadPromptImage()
            GameAudio.shared.speak(schedule.defaultPromptText, childId: auth.childSlug)
            let secs = max(5, schedule.durationSec ?? 60)
            dismissTask?.cancel()
            dismissTask = Task {
                try? await Task.sleep(nanoseconds: UInt64(secs * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await MainActor.run { close(answered: nil) }
            }
        }
        .onDisappear { dismissTask?.cancel() }
    }

    private func loadPromptImage() async {
        guard let key = schedule.imageKey, !key.isEmpty else { return }
        if let img = await MediaCache.shared.image(for: key, maxPixel: 640) {
            await MainActor.run { self.promptImage = img }
        }
    }

    private func close(answered resp: Schedule.Response?) {
        guard !answered else { return }
        answered = true
        if let resp {
            // Speak the chosen label back as confirmation + log to the server.
            if !resp.label.isEmpty {
                GameAudio.shared.speak(resp.label, childId: auth.childSlug)
            }
            let childId = auth.childSlug
            let prompt = schedule.defaultPromptText
            let label = resp.label
            let sid = schedule.id
            Task.detached {
                await APIClient().logInteraction(
                    childId: childId, kind: "question",
                    prompt: prompt, response: label, scheduleId: sid)
            }
        }
        onDismiss()
    }
}

private struct ResponseChip: View {
    let response: Schedule.Response
    let onTap: () -> Void

    @State private var image: UIImage?

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                if let img = image {
                    Image(uiImage: img)
                        .resizable().scaledToFill()
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                Text(response.label)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)
            }
            .padding(14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(hex: "#fce4ec"), lineWidth: 3))
        }
        .buttonStyle(.plain)
        .task(id: response.imageKey) {
            guard let key = response.imageKey, !key.isEmpty else { return }
            if let img = await MediaCache.shared.image(for: key, maxPixel: 640) {
                await MainActor.run { self.image = img }
            }
        }
    }
}

// MARK: -- Game nudge ("Let's do a game!" → Play / Not now)

/// Modal that offers to launch a scheduled game. "Play" kicks off a matching
/// game with the schedule's scope; "Not now" dismisses without playing.
struct GameNudgeCard: View {
    let schedule: Schedule
    let onPlay: () -> Void
    let onDismiss: () -> Void

    @Environment(AuthManager.self) private var auth
    @State private var image: UIImage?
    @State private var dismissTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Color(hex: "#ad1457").opacity(0.35).ignoresSafeArea()

            VStack(spacing: 18) {
                if let img = image {
                    Image(uiImage: img)
                        .resizable().scaledToFill()
                        .frame(width: 150, height: 150)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                }
                Text(schedule.defaultPromptText)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                    .multilineTextAlignment(.center)

                HStack(spacing: 12) {
                    Button { onDismiss() } label: {
                        Text("Not now")
                            .font(.system(size: 16, weight: .semibold))
                            .padding(.horizontal, 20).padding(.vertical, 14)
                            .foregroundStyle(.secondary)
                            .background(Color(hex: "#eeeeee"))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    Button { onPlay() } label: {
                        Text("▶ Play")
                            .font(.system(size: 20, weight: .bold))
                            .padding(.horizontal, 30).padding(.vertical, 14)
                            .foregroundStyle(.white)
                            .background(Color(hex: "#ff1493"))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(28)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.25), radius: 30)
            .padding(.horizontal, 24)
            .frame(maxWidth: 460)
        }
        .task {
            await loadImage()
            GameAudio.shared.speak(schedule.defaultPromptText, childId: auth.childSlug)
            // Auto-dismiss after 60s so a missed nudge doesn't sit forever.
            dismissTask?.cancel()
            dismissTask = Task {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard !Task.isCancelled else { return }
                await MainActor.run { onDismiss() }
            }
        }
        .onDisappear { dismissTask?.cancel() }
    }

    private func loadImage() async {
        guard let key = schedule.imageKey, !key.isEmpty else { return }
        if let img = await MediaCache.shared.image(for: key, maxPixel: 640) {
            await MainActor.run { self.image = img }
        }
    }
}

// MARK: -- Auto-teach countdown card

/// "Learning time!" — auto-teach staged an activity. Counts down ~10s, speaks
/// the announcement once, then fires; a grown-up (or the child) can ✕ to skip
/// this round — the runner just tries again at its next poll. The countdown
/// exists so the iPad never appears to act on its own out of nowhere.
struct AutoTeachCountdownCard: View {
    let mode: String                 // "exposure" | "game"
    let onStart: () -> Void
    let onSkip: () -> Void

    @Environment(AuthManager.self) private var auth
    @State private var secondsLeft = 10
    @State private var countTask: Task<Void, Never>?

    private var headline: String {
        mode == "game" ? "Game time! 🎮" : "Learning time! 📚"
    }

    var body: some View {
        HStack(spacing: 14) {
            Text(mode == "game" ? "🎮" : "📚").font(.system(size: 34))
            VStack(alignment: .leading, spacing: 2) {
                Text(headline)
                    .font(.system(size: 19, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text("Starting in \(secondsLeft)…")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.85))
                    .monospacedDigit()
            }
            Spacer()
            Button {
                countTask?.cancel()
                onSkip()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(10)
                    .background(Color.white.opacity(0.22), in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .background(Color(hex: "#ad1457"))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
        .padding(.top, 18)
        .frame(maxWidth: 480)
        .task {
            GameAudio.shared.speak(mode == "game" ? "Game time!" : "Learning time!",
                                   childId: auth.childSlug)
            countTask?.cancel()
            countTask = Task {
                while secondsLeft > 0 {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    guard !Task.isCancelled else { return }
                    await MainActor.run { secondsLeft -= 1 }
                }
                guard !Task.isCancelled else { return }
                await MainActor.run { onStart() }
            }
        }
        .onDisappear { countTask?.cancel() }
    }
}

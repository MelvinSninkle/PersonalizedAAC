import SwiftUI

/// Parent review of the gap-fill ledger (reached from Display settings →
/// Listening → "New words heard"; the settings sheet is already behind the
/// parent gate). Shows the words this DEVICE has heard often that neither
/// the board nor our library knows, and lets the parent act:
///
///   Request — sends that ONE word to My World to build (the tap is the
///             share). If the library actually knows the word after all, the
///             server mints a normal dashboard suggestion instead.
///   Never   — the word stops being counted and never surfaces again.
///
/// The empty state is deliberately a GOOD message (GF-13): no candidates
/// means the board already covers what this child hears most.
struct NewWordsReviewView: View {
    @State private var vocab = ListenVocab.shared
    @State private var busy: Set<String> = []

    var body: some View {
        List {
            if vocab.candidates.isEmpty && vocab.requested.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Nothing waiting 💛")
                            .font(.headline)
                        Text("The board already covers the words being heard most often. New words appear here after they've been heard at least 5 times across 3 different days.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }
            }
            if !vocab.candidates.isEmpty {
                Section {
                    ForEach(vocab.candidates) { c in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.word).font(.headline)
                                Text("heard \(c.hits)× over \(c.days) days")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button {
                                busy.insert(c.word)
                                Task {
                                    _ = await vocab.request(c.word)
                                    busy.remove(c.word)
                                }
                            } label: {
                                if busy.contains(c.word) { ProgressView() }
                                else { Text("Request").fontWeight(.bold) }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(busy.contains(c.word))
                            Button("Never", role: .destructive) {
                                vocab.dismissForever(c.word)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                } header: {
                    Text("Words we hear a lot")
                } footer: {
                    Text("Requesting a word sends just that word to My World so we can build its picture, lessons, and quizzes. It arrives in your parent dashboard to review before it ever lands on the board.")
                }
            }
            if !vocab.requested.isEmpty {
                Section("Requested") {
                    ForEach(vocab.requested.sorted(by: { $0.key < $1.key }), id: \.key) { word, status in
                        HStack {
                            Text(word)
                            Spacer()
                            Text(statusLabel(status))
                                .font(.caption).fontWeight(.semibold)
                                .foregroundStyle(status == "delivered" ? .green : .secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("New words heard")
    }

    private func statusLabel(_ s: String) -> String {
        switch s {
        case "requested": return "Requested ✓"
        case "accepted":  return "Being built 🎨"
        case "delivered": return "In your dashboard 💛"
        case "suggested": return "In your dashboard 💛"
        case "rejected":  return "Not available"
        default:          return s
        }
    }
}

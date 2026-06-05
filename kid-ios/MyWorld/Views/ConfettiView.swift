import SwiftUI

/// Confetti reward animation. SwiftUI Canvas + TimelineView drives the
/// per-frame physics on the main thread — for a few hundred particles over
/// ~2 seconds that's well under the budget on iPad and avoids a full
/// CAEmitterLayer UIViewRepresentable round-trip.
///
/// Usage: overlay this view on top of the game surface and toggle `running`
/// to true on a correct answer / celebration trigger.
struct ConfettiView: View {
    let running: Bool

    @State private var particles: [Particle] = []
    @State private var startedAt: Date?

    private let colors: [Color] = [
        Color(hex: "#ff1493"), Color(hex: "#ffcf3f"), Color(hex: "#3fa9ff"),
        Color(hex: "#46d27a"), Color(hex: "#a37bff"), Color(hex: "#ff7a3f"),
    ]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { context in
            Canvas { ctx, size in
                let elapsed = startedAt.map { context.date.timeIntervalSince($0) } ?? 0
                for p in particles {
                    let t = elapsed - p.startDelay
                    guard t >= 0, t < p.lifespan else { continue }
                    let x = p.startX * size.width + p.driftX * CGFloat(t) * 60
                    let y = -40 + p.gravity * CGFloat(t * t) * 60 + p.startY * size.height
                    var local = ctx
                    local.translateBy(x: x, y: y)
                    local.rotate(by: .radians(Double(p.rotation + CGFloat(t) * p.spin)))
                    let rect = CGRect(x: -p.size / 2, y: -p.size * 0.3,
                                      width: p.size, height: p.size * 0.6)
                    local.fill(Path(rect), with: .color(p.color))
                }
            }
        }
        .allowsHitTesting(false)
        .onChange(of: running) { _, isOn in
            if isOn { launch() } else { particles.removeAll(); startedAt = nil }
        }
    }

    private func launch() {
        startedAt = Date()
        particles = (0..<140).map { _ in
            Particle(
                startX:    .random(in: 0.0...1.0),
                startY:    .random(in: -0.05...0.0),
                driftX:    .random(in: -1.5...1.5),
                gravity:   .random(in: 0.6...1.2),
                rotation:  .random(in: 0...(2 * .pi)),
                spin:      .random(in: -8.0...8.0),
                size: CGFloat.random(in: 8...14),
                color: colors.randomElement() ?? .pink,
                startDelay: .random(in: 0...0.4),
                lifespan:   .random(in: 1.8...2.6)
            )
        }
    }

    private struct Particle {
        let startX: CGFloat
        let startY: CGFloat
        let driftX: CGFloat
        let gravity: CGFloat
        let rotation: CGFloat
        let spin: CGFloat
        let size: CGFloat
        let color: Color
        let startDelay: TimeInterval
        let lifespan: TimeInterval
    }
}

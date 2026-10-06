import SwiftUI

/// A monochrome ink surface: microphone levels reshape the silhouette while
/// nested contours flow inside it. No glyph or separate waveform is needed.
struct VoiceOrbView: View {
    var levels: [CGFloat] = []
    var phase: RecordingPhase = .idle
    var pressed = false
    // Deterministic inputs for previews and native render tests only.
    var previewTime: Double?
    var previewReduceMotion: Bool?
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var motionOrigin = Date()

    private var listening: Bool { phase == .recording }
    private var active: Bool { phase != .idle }
    private var reduceMotion: Bool { previewReduceMotion ?? systemReduceMotion }
    private var moving: Bool { active && !reduceMotion && scenePhase == .active }
    private var energy: CGFloat {
        guard listening, !levels.isEmpty else { return 0 }
        return levels.reduce(0) { $0 + safeLevel($1) } / CGFloat(levels.count)
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !moving || previewTime != nil)) { context in
            let time = reduceMotion ? 0 : (previewTime ?? (moving ? context.date.timeIntervalSince(motionOrigin) : 0))
            ZStack {
                Canvas { context, size in
                    drawInk(context: &context, size: size, time: time)
                }
                if phase == .preparing || phase == .processing {
                    ProgressView().tint(.white)
                }
            }
            .frame(width: 128, height: 128)
            .scaleEffect(pressed && !reduceMotion ? 0.96 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: pressed)
        }
        .onChange(of: active) { _, started in
            if started { motionOrigin = Date() }
        }
    }

    private func drawInk(context: inout GraphicsContext, size: CGSize, time: Double) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let silhouette = outline(center: center, time: time)
        // A fine contour just outside the surface makes its audio-driven edge
        // readable without detaching it into a ring of waveform bars.
        context.stroke(outline(center: center, time: time, expansion: 3 + energy * 2),
                       with: .color(.black.opacity(active ? 0.18 : 0.07)), lineWidth: 0.7)
        context.fill(silhouette, with: .linearGradient(
            Gradient(colors: [Color(white: 0.14), Color(white: 0.025)]),
            startPoint: CGPoint(x: center.x - 36, y: center.y - 44),
            endPoint: CGPoint(x: center.x + 30, y: center.y + 44)))

        var interior = context
        interior.clip(to: silhouette)
        for index in 0..<6 {
            let path = contour(index: index, center: center, time: time)
            let opacity = (active ? 0.25 : 0.14) + Double(index) * 0.018
            interior.stroke(path, with: .color(.white.opacity(opacity)),
                            style: StrokeStyle(lineWidth: index == 5 ? 0.65 : 0.85, lineCap: .round))
        }
    }

    private func outline(center: CGPoint, time: Double, expansion: CGFloat = 0) -> Path {
        let amplitude = energy
        let points = (0..<96).map { index -> CGPoint in
            let fraction = Double(index) / 96
            let angle = fraction * .pi * 2
            let fold = sin(angle * 3 - time * 0.95) + 0.42 * sin(angle * 5 + time * 0.65)
            let organic = active ? CGFloat(fold) * (0.6 + amplitude * 2.5) : 0
            let audio = listening ? angularLevel(fraction) * 4 : 0
            let radius = 44 + expansion + amplitude * 2 + organic + audio
            return CGPoint(x: center.x + CGFloat(cos(angle)) * radius,
                           y: center.y + CGFloat(sin(angle)) * radius)
        }
        return smoothLoop(points)
    }

    private func contour(index: Int, center: CGPoint, time: Double) -> Path {
        let layer = Double(index)
        let amplitude = Double(energy)
        let flow = time
        let rotation = flow * 0.22 + sin(flow * 0.31) * 0.25
        let offsetX = sin(flow * 0.7 + layer * 0.30) * 4 + (layer - 2.5)
        let offsetY = cos(flow * 0.55 + layer * 0.38) * 4
        let points = (0..<80).map { index -> CGPoint in
            let angle = Double(index) / 80 * .pi * 2
            let fold = sin(angle * 2 + flow * 0.8 + layer * 0.24) * (1.5 + amplitude * 2)
            let ripple = sin(angle * 3 - flow * 0.55 + layer * 0.18) * 1.2
            let radius = 10 + layer * 4.8 + fold + ripple
            let x = cos(angle) * radius * 1.10
            let y = sin(angle) * radius * 0.82
            let rotatedX = x * cos(rotation) - y * sin(rotation)
            let rotatedY = x * sin(rotation) + y * cos(rotation)
            return CGPoint(x: center.x + CGFloat(rotatedX + offsetX),
                           y: center.y + CGFloat(rotatedY + offsetY))
        }
        return smoothLoop(points)
    }

    // Smooth, periodic interpolation avoids polygon corners as the audio edge moves.
    private func smoothLoop(_ points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first, points.count > 3 else { return path }
        path.move(to: first)
        for index in points.indices {
            let previous = points[(index + points.count - 1) % points.count]
            let current = points[index]
            let next = points[(index + 1) % points.count]
            let after = points[(index + 2) % points.count]
            let firstControl = CGPoint(x: current.x + (next.x - previous.x) / 6,
                                       y: current.y + (next.y - previous.y) / 6)
            let secondControl = CGPoint(x: next.x - (after.x - current.x) / 6,
                                        y: next.y - (after.y - current.y) / 6)
            path.addCurve(to: next, control1: firstControl, control2: secondControl)
        }
        path.closeSubpath()
        return path
    }

    private func angularLevel(_ fraction: Double) -> CGFloat {
        guard !levels.isEmpty else { return 0 }
        let position = fraction * Double(levels.count)
        let index = Int(position) % levels.count
        let next = (index + 1) % levels.count
        let previous = (index + levels.count - 1) % levels.count
        let blend = CGFloat(position - floor(position))
        let sample = safeLevel(levels[index]) * (1 - blend) + safeLevel(levels[next]) * blend
        return sample * 0.65 + (safeLevel(levels[previous]) + safeLevel(levels[next])) * 0.175
    }

    private func safeLevel(_ value: CGFloat) -> CGFloat { value.isFinite ? min(1, max(0, value)) : 0 }
}

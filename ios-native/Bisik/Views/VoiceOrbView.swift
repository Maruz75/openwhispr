import SwiftUI

/// A native, audio-responsive orb. The ring reads microphone samples; the
/// interior has a gentle cloud drift inspired by conversational voice UIs.
struct VoiceOrbView: View {
    var levels: [CGFloat] = []
    var phase: RecordingPhase = .idle
    var pressed = false
    var showsMicrophone = true
    // Fixed time is used by previews/render tests, never by production recording.
    var previewTime: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    private var listening: Bool { phase == .recording }
    private var moving: Bool { phase != .idle && !reduceMotion && scenePhase == .active }
    private var energy: CGFloat {
        guard listening, !levels.isEmpty else { return 0 }
        return levels.reduce(0) { $0 + safeLevel($1) } / CGFloat(levels.count)
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !moving || previewTime != nil)) { context in
            let time = reduceMotion ? 0 : (previewTime ?? (moving ? context.date.timeIntervalSinceReferenceDate : 0))
            ZStack {
                clouds(time: time)
                    .frame(width: 88, height: 88)
                    .clipShape(Circle())
                    .scaleEffect(reduceMotion ? 1 : 1 + energy * 0.08)
                radialWaveform
                    .frame(width: 120, height: 120)
                if showsMicrophone && phase != .preparing && phase != .processing {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(.white)
                }
                if phase == .preparing || phase == .processing {
                    ProgressView().tint(.white)
                }
            }
            .frame(width: 128, height: 128)
            .scaleEffect(pressed && !reduceMotion ? 0.96 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: pressed)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: energy)
        }
    }

    private func clouds(time: Double) -> some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Color(red: 0.11, green: 0.43, blue: 0.95), Color(red: 0.28, green: 0.69, blue: 1)], startPoint: .bottomLeading, endPoint: .topTrailing))
            Ellipse().fill(RadialGradient(colors: [.white.opacity(0.88), Color(red: 0.72, green: 0.87, blue: 1).opacity(0.55), .clear], center: .center, startRadius: 2, endRadius: 46))
                .frame(width: 100, height: 80)
                .offset(x: CGFloat(cos(time * 0.7) * 14), y: CGFloat(-22 + sin(time * 0.6) * 10))
                .rotationEffect(.degrees(sin(time * 0.4) * 22))
            Ellipse().fill(RadialGradient(colors: [Color(red: 0.08, green: 0.31, blue: 0.85).opacity(0.9), .clear], center: .center, startRadius: 4, endRadius: 50))
                .frame(width: 110, height: 90)
                .offset(x: CGFloat(-22 + sin(time * 0.5) * 12), y: CGFloat(30 + cos(time * 0.65) * 12))
                .rotationEffect(.degrees(cos(time * 0.3) * 20))
        }
    }

    private var radialWaveform: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            for index in 0..<48 {
                let angle = Double(index) / 48 * .pi * 2 - .pi / 2
                let sample = listening && !levels.isEmpty ? safeLevel(levels[index * levels.count / 48]) : 0
                let length: CGFloat = listening ? 3 + sample * 10 : 2
                let inner: CGFloat = 48
                var path = Path()
                path.move(to: CGPoint(x: center.x + CGFloat(cos(angle)) * inner, y: center.y + CGFloat(sin(angle)) * inner))
                path.addLine(to: CGPoint(x: center.x + CGFloat(cos(angle)) * (inner + length), y: center.y + CGFloat(sin(angle)) * (inner + length)))
                context.stroke(path, with: .color(Color(red: 0.16, green: 0.48, blue: 0.94).opacity(listening ? 0.9 : 0.24)), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            }
        }
    }

    private func safeLevel(_ value: CGFloat) -> CGFloat { value.isFinite ? min(1, max(0, value)) : 0 }
}

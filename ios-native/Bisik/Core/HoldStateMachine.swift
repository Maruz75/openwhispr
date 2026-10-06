import Foundation

/// An end/cancel invalidates all outstanding asynchronous preparation work.
/// Permission dialogs and network requests may complete after the finger is lifted.
struct HoldStateMachine {
    private(set) var generation = 0
    private(set) var held = false

    mutating func begin() -> Int {
        generation &+= 1
        held = true
        return generation
    }

    mutating func end() {
        held = false
        generation &+= 1
    }

    func accepts(_ token: Int) -> Bool { held && token == generation }
}

/// Shared by the PCM writer and tests: timers never decide how many audio frames get billed.
struct RecordingFrameBudget {
    let maximumFrames: Int64
    private(set) var writtenFrames: Int64 = 0

    init(maximumSeconds: Double, sampleRate: Int = 16_000) {
        maximumFrames = Int64(floor(max(0, min(600, maximumSeconds.isFinite ? maximumSeconds : 0)) * Double(max(1, sampleRate))))
    }

    mutating func take(_ requestedFrames: Int) -> Int {
        let allowed = min(Int64(max(0, requestedFrames)), max(0, maximumFrames - writtenFrames))
        writtenFrames += allowed
        return Int(allowed)
    }
}

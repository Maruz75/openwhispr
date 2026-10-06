import AVFoundation
import Speech
import UIKit

enum RecorderError: LocalizedError {
    case microphoneDenied, noInput, emptyAudio, writeFailed
    var errorDescription: String? {
        switch self {
        case .microphoneDenied: return "Akses mikrofon diperlukan untuk merekam. Buka Pengaturan iPhone untuk mengizinkannya."
        case .noInput: return "Mikrofon tidak tersedia. Periksa perangkat audio lalu coba lagi."
        case .emptyAudio: return "Rekaman terlalu singkat. Tahan mikrofon sambil berbicara."
        case .writeFailed: return "Rekaman tidak dapat disimpan. Periksa ruang kosong iPhone."
        }
    }
}

/// The audio tap runs off the main thread; file access and metering share one lock.
private final class AudioCaptureWriter {
    private let lock = NSLock()
    private var file: AVAudioFile?
    private var level: CGFloat = 0.08
    private var failed = false
    private var budget: RecordingFrameBudget
    private let converter: AVAudioConverter
    private let outputFormat: AVAudioFormat

    init(file: AVAudioFile, converter: AVAudioConverter, outputFormat: AVAudioFormat, maximumSeconds: Double) {
        self.file = file; self.converter = converter; self.outputFormat = outputFormat
        self.budget = RecordingFrameBudget(maximumSeconds: maximumSeconds)
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard let file else { return }
        let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * outputFormat.sampleRate / buffer.format.sampleRate)) + 64
        if let converted = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) {
            var provided = false
            var conversionError: NSError?
            let status = converter.convert(to: converted, error: &conversionError) { _, status in
                if provided { status.pointee = .noDataNow; return nil }
                provided = true; status.pointee = .haveData; return buffer
            }
            if status == .error || conversionError != nil { failed = true }
            else if converted.frameLength > 0 {
                // A UI timer can run late. The audio writer enforces the exact server quota cap.
                converted.frameLength = AVAudioFrameCount(budget.take(Int(converted.frameLength)))
                if converted.frameLength > 0 {
                    do { try file.write(from: converted) }
                    catch { failed = true }
                }
            }
        } else { failed = true }
        if let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 {
            var power: Float = 0
            for frame in 0..<Int(buffer.frameLength) { power += samples[frame] * samples[frame] }
            let rms = sqrt(power / Float(buffer.frameLength))
            let decibels = 20 * log10(max(rms, 0.00001))
            level = CGFloat(max(0.08, min(1, (decibels + 55) / 55)))
        }
    }

    func snapshot() -> (CGFloat, Bool, AVAudioFramePosition) {
        lock.lock(); defer { lock.unlock() }
        return (level, failed, budget.writtenFrames)
    }

    func close() { lock.lock(); file = nil; lock.unlock() }
}

@MainActor
final class AudioRecorder {
    var onSamples: (([CGFloat], Double) -> Void)?
    var onPreview: ((String) -> Void)?
    var onLimit: (() -> Void)?
    var onFailure: ((Error) -> Void)?

    private var engine: AVAudioEngine?
    private var writer: AudioCaptureWriter?
    private var url: URL?
    private var startedAt: Date?
    private var timer: Timer?
    private var recognizer: SFSpeechRecognizer?
    private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
    private var speechTask: SFSpeechRecognitionTask?
    private var samples = Array(repeating: CGFloat(0.08), count: 32)
    private var sampleRate: Double = 0
    private var limitTriggered = false
    private var recognitionID: UUID?

    func requestMicrophone() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }

    /// Preview is optional and strictly on-device. Unsupported locales still record normally.
    func prepareLiveSpeech(language: String) async {
        recognizer = nil
        guard let candidate = SFSpeechRecognizer(locale: Locale(identifier: language)),
              candidate.supportsOnDeviceRecognition else { return }
        let status = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        if status == .authorized, candidate.isAvailable { recognizer = candidate }
    }

    func start(maximumSeconds: Double) throws {
        cancel()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.allowBluetooth])
        try session.setActive(true)
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw RecorderError.noInput
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("bisik-" + UUID().uuidString + ".wav")
        guard let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: format, to: outputFormat) else {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw RecorderError.noInput
        }
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM,
                                       AVSampleRateKey: 16_000,
                                       AVNumberOfChannelsKey: 1,
                                       AVLinearPCMBitDepthKey: 16,
                                       AVLinearPCMIsFloatKey: false,
                                       AVLinearPCMIsBigEndianKey: false,
                                       AVLinearPCMIsNonInterleaved: false]
        do {
            let file = try AVAudioFile(forWriting: url, settings: settings,
                                      commonFormat: .pcmFormatFloat32, interleaved: false)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
            let writer = AudioCaptureWriter(file: file, converter: converter, outputFormat: outputFormat, maximumSeconds: maximumSeconds)
            self.writer = writer
            self.url = url
            self.engine = engine
            self.sampleRate = 16_000
            if let recognizer {
                let recognitionID = UUID()
                self.recognitionID = recognitionID
                let request = SFSpeechAudioBufferRecognitionRequest()
                request.shouldReportPartialResults = true
                request.requiresOnDeviceRecognition = true
                speechRequest = request
                speechTask = recognizer.recognitionTask(with: request) { [weak self] result, _ in
                    guard let result else { return }
                    DispatchQueue.main.async {
                        guard let self, self.recognitionID == recognitionID, self.engine?.isRunning == true else { return }
                        self.onPreview?(result.bestTranscription.formattedString)
                    }
                }
            }
            let preview = speechRequest
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                writer.append(buffer)
                preview?.append(buffer)
            }
            engine.prepare()
            try engine.start()
            startedAt = Date()
            samples = Array(repeating: 0.08, count: 32)
            limitTriggered = false
            timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                // Timer is installed from main actor and delivered on its run loop.
                Task { @MainActor [weak self] in self?.tick(maximumSeconds: maximumSeconds) }
            }
        } catch {
            cancel()
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }

    private func tick(maximumSeconds: Double) {
        guard let startedAt, let writer, !limitTriggered else { return }
        let (level, failed, frames) = writer.snapshot()
        samples.removeFirst(); samples.append(level)
        let duration = sampleRate > 0 ? Double(frames) / sampleRate : Date().timeIntervalSince(startedAt)
        onSamples?(samples, duration)
        if failed {
            limitTriggered = true
            onFailure?(RecorderError.writeFailed)
        } else if duration >= maximumSeconds {
            limitTriggered = true
            onLimit?()
        }
    }

    func stop() throws -> (URL, Double) {
        guard let url, let writer else { throw RecorderError.emptyAudio }
        // Stop tap delivery before reading the final frame count and closing the WAV header.
        engine?.stop()
        let (_, failed, frames) = writer.snapshot()
        let duration = sampleRate > 0 ? Double(frames) / sampleRate : 0
        shutdown()
        self.url = nil
        if failed || duration < 0.25 {
            try? FileManager.default.removeItem(at: url)
            throw failed ? RecorderError.writeFailed : RecorderError.emptyAudio
        }
        return (url, duration)
    }

    func cancel() {
        let oldURL = url
        shutdown()
        url = nil
        if let oldURL { try? FileManager.default.removeItem(at: oldURL) }
    }

    private func shutdown() {
        timer?.invalidate(); timer = nil
        if let engine {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        engine = nil
        writer?.close(); writer = nil
        speechRequest?.endAudio(); speechTask?.cancel()
        speechTask = nil; speechRequest = nil
        recognitionID = nil
        startedAt = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

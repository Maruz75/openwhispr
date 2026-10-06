import Foundation

enum RecordingPhase: Equatable {
    case idle, preparing, recording, processing
}

struct TranscriptRecord: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var text: String
    var originalText: String
    var createdAt: Date = Date()
    var durationSeconds: Double
}

struct DictionaryEntry: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var source: String
    var replacement: String
    var learned: Bool = false
    var createdAt: Date = Date()

    var isValidContext: Bool {
        [source, replacement].allSatisfy {
            !$0.isEmpty && $0.count <= 80 && $0 == $0.trimmingCharacters(in: .whitespacesAndNewlines)
                && $0.rangeOfCharacter(from: .controlCharacters) == nil
        }
    }
}

struct AppSettings: Codable, Equatable {
    var autoCopy: Bool = true
    var learnCorrections: Bool = true
    var haptics: Bool = true
    var saveHistory: Bool = true
    var language: String = "id-ID"
    var consentGranted: Bool = false
    var consentDisclosure: String?
}

struct UsageQuota: Codable, Equatable {
    let usedSeconds: Int
    let limitSeconds: Int
    let resetAt: Date
    let plan: String

    var remainingSeconds: Int { max(0, limitSeconds - usedSeconds) }
    var progress: Double {
        guard limitSeconds > 0 else { return 1 }
        return min(1, max(0, Double(usedSeconds) / Double(limitSeconds)))
    }
}

struct StoredData: Codable {
    var settings: AppSettings = AppSettings()
    var history: [TranscriptRecord] = []
    var dictionary: [DictionaryEntry] = []
}

struct AuthSession: Codable {
    let accessToken: String
    let accountToken: UUID
}

struct AuthResponse: Decodable {
    let accessToken: String
    let accountToken: UUID
    let quota: UsageQuota
}

struct TranscriptionResponse: Decodable {
    let text: String
    let quota: UsageQuota
}

struct SubscriptionResponse: Decodable {
    let quota: UsageQuota
}

struct PendingRecording {
    let url: URL
    let requestID: UUID
    let durationSeconds: Double
    let dictionary: [DictionaryEntry]
    let language: String
}

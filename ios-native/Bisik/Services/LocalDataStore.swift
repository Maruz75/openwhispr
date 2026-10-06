import Foundation

/// Private on-device transcripts, never backed up to iCloud or sent to analytics.
final class LocalDataStore {
    private let directory: URL
    private let fileURL: URL

    init(directory: URL? = nil) throws {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Bisik", isDirectory: true)
        self.fileURL = self.directory.appendingPathComponent("library.json")
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.complete])
        var excludedURL = self.directory
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try excludedURL.setResourceValues(resourceValues)
    }

    func load() throws -> StoredData {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return StoredData() }
        return try JSONDecoder().decode(StoredData.self, from: Data(contentsOf: fileURL))
    }

    func save(_ data: StoredData) throws {
        try JSONEncoder().encode(data).write(to: fileURL, options: [.atomic, .completeFileProtection])
    }
}

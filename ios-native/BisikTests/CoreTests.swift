import XCTest
@testable import Bisik

final class CoreTests: XCTestCase {
    func testReleaseInvalidatesPendingPreparation() {
        var hold = HoldStateMachine()
        let permissionRequest = hold.begin()
        XCTAssertTrue(hold.accepts(permissionRequest))
        hold.end()
        XCTAssertFalse(hold.accepts(permissionRequest), "A permission dialog resolving after release must not start recording")
        let nextHold = hold.begin()
        XCTAssertTrue(hold.accepts(nextHold))
        XCTAssertFalse(hold.accepts(permissionRequest), "An older preparation cannot overwrite a newer hold")
    }

    func testMultipleEndsCannotResurrectHold() {
        var hold = HoldStateMachine()
        let token = hold.begin()
        hold.end(); hold.end()
        XCTAssertFalse(hold.held)
        XCTAssertFalse(hold.accepts(token))
    }

    func testAudioWriterBudgetClampsDelayedTimerAtExactQuotaSecond() {
        var budget = RecordingFrameBudget(maximumSeconds: 1)
        XCTAssertEqual(budget.take(15_500), 15_500)
        XCTAssertEqual(budget.take(1_024), 500)
        XCTAssertEqual(budget.take(1_024), 0)
        XCTAssertEqual(budget.writtenFrames, 16_000)
        XCTAssertEqual(ceil(Double(budget.writtenFrames) / 16_000), 1)
    }

    func testAudioWriterBudgetRejectsInvalidLimits() {
        var zero = RecordingFrameBudget(maximumSeconds: -.infinity)
        XCTAssertEqual(zero.take(1_024), 0)
        var capped = RecordingFrameBudget(maximumSeconds: 300)
        XCTAssertEqual(capped.take(10_000_000), 4_800_000)
        XCTAssertEqual(capped.take(-1), 0)
    }

    func testQuotaClampsZeroAndOverdrawnStates() {
        let exhausted = UsageQuota(usedSeconds: 901, limitSeconds: 900, resetAt: Date(), plan: "free")
        XCTAssertEqual(exhausted.remainingSeconds, 0)
        XCTAssertEqual(exhausted.progress, 1)
        let zero = UsageQuota(usedSeconds: 0, limitSeconds: 0, resetAt: Date(), plan: "free")
        XCTAssertEqual(zero.remainingSeconds, 0)
        XCTAssertEqual(zero.progress, 1)
        let available = UsageQuota(usedSeconds: 180, limitSeconds: 900, resetAt: Date(), plan: "free")
        XCTAssertEqual(available.remainingSeconds, 720)
        XCTAssertEqual(available.progress, 0.2, accuracy: 0.0001)
    }

    func testPhoneticCorrectionLearnsSourceAndReplacement() {
        let entries = CorrectionLearner.extract(original: "Hey Shunade how are you", edited: "Hey Sinead how are you", existing: [])
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.first?.source, "Shunade")
        XCTAssertEqual(entries.first?.replacement, "Sinead")
        XCTAssertEqual(entries.first?.learned, true)
    }

    func testSingleWordVocabularyCorrectionIsLearned() {
        let entries = CorrectionLearner.extract(original: "Openwispr", edited: "OpenWhispr", existing: [])
        XCTAssertEqual(entries.first?.source, "Openwispr")
        XCTAssertEqual(entries.first?.replacement, "OpenWhispr")
        XCTAssertTrue(CorrectionLearner.extract(original: "cat", edited: "elephant", existing: []).isEmpty)
    }

    func testContextRejectsControlCharactersAndOversizedEntries() {
        XCTAssertFalse(DictionaryEntry(source: "word\nother", replacement: "name").isValidContext)
        XCTAssertFalse(DictionaryEntry(source: String(repeating: "a", count: 81), replacement: "name").isValidContext)
        XCTAssertTrue(DictionaryEntry(source: "Openwispr", replacement: "OpenWhispr").isValidContext)
    }

    func testOrdinaryIndonesianEditIsNotVocabulary() {
        XCTAssertTrue(CorrectionLearner.extract(original: "saya sudah kirim dokumen", edited: "saya belum kirim dokumen", existing: []).isEmpty)
        XCTAssertTrue(CorrectionLearner.extract(original: "This is why I'm speaking", edited: "This is what I'm speaking", existing: []).isEmpty)
    }

    func testRewriteAndPhraseReplacementAreNotLearned() {
        XCTAssertTrue(CorrectionLearner.extract(original: "the cat sat on the mat", edited: "a dog stood under a rug", existing: []).isEmpty)
        XCTAssertTrue(CorrectionLearner.extract(original: "tolong temui Shunade di kantor", edited: "tolong temui Sinead Murphy di kantor", existing: []).isEmpty)
        XCTAssertTrue(CorrectionLearner.extract(original: "saya melihat kucing kemarin", edited: "saya melihat gedung kemarin", existing: []).isEmpty)
    }

    func testPunctuationAndCapitalizationAreIgnored() {
        XCTAssertTrue(CorrectionLearner.extract(original: "Halo, Sinead.", edited: "halo SINEAD!", existing: []).isEmpty)
        XCTAssertEqual(CorrectionLearner.tokenize("  Halo, café!  "), ["Halo", "café"])
    }

    func testDictionaryDeduplicatesCaseInsensitively() {
        let existing = [DictionaryEntry(source: "shunade", replacement: "sinead", learned: true)]
        XCTAssertTrue(CorrectionLearner.extract(original: "Hey Shunade how are you", edited: "Hey Sinead how are you", existing: existing).isEmpty)
        let repeated = CorrectionLearner.extract(original: "Shunade said hi to Shunade", edited: "Sinead said hi to Sinead", existing: [])
        XCTAssertEqual(repeated.count, 1)
    }

    func testEmptyShortAndLongInputsAreSafe() {
        XCTAssertTrue(CorrectionLearner.extract(original: "", edited: "name", existing: []).isEmpty)
        XCTAssertTrue(CorrectionLearner.extract(original: "see XX today", edited: "see Al today", existing: []).isEmpty)
        let long = Array(repeating: "word", count: 601).joined(separator: " ")
        XCTAssertTrue(CorrectionLearner.extract(original: long, edited: long + " changed", existing: []).isEmpty)
        XCTAssertEqual(CorrectionLearner.distance("", "café"), 4)
    }

    func testServerDatesDecodeBothFractionalAndWholeSeconds() throws {
        for reset in ["2026-11-01T00:00:00Z", "2026-11-01T00:00:00.000000+00:00"] {
            let json = "{\"usedSeconds\":60,\"limitSeconds\":900,\"resetAt\":\"\(reset)\",\"plan\":\"free\"}"
            let quota = try APIClient.decoder().decode(UsageQuota.self, from: Data(json.utf8))
            XCTAssertEqual(quota.remainingSeconds, 840)
            XCTAssertEqual(Calendar(identifier: .gregorian).component(.year, from: quota.resetAt), 2026)
        }
    }

    func testHistoryDictionaryAndConsentPersistTogether() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try LocalDataStore(directory: directory)
        var settings = AppSettings()
        settings.consentGranted = true
        settings.consentDisclosure = "provider-v1"
        let history = [TranscriptRecord(text: "Sinead", originalText: "Shunade", durationSeconds: 1.4)]
        let dictionary = [DictionaryEntry(source: "Shunade", replacement: "Sinead", learned: true)]
        try store.save(StoredData(settings: settings, history: history, dictionary: dictionary))
        let loaded = try store.load()
        XCTAssertEqual(loaded.settings, settings)
        XCTAssertEqual(loaded.history, history)
        XCTAssertEqual(loaded.dictionary, dictionary)
    }

    func testCorruptLocalDataDoesNotSilentlyOverwriteHistory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try LocalDataStore(directory: directory)
        try Data("invalid json".utf8).write(to: directory.appendingPathComponent("library.json"))
        XCTAssertThrowsError(try store.load())
        XCTAssertEqual(try String(contentsOf: directory.appendingPathComponent("library.json")), "invalid json")
    }
}

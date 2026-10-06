import SwiftUI
import UIKit
import XCTest
@testable import Bisik

final class InterfaceTests: XCTestCase {
    func testLanguageResolutionAndBundledTranslations() throws {
        XCTAssertEqual(L10n.resolveLanguage(preference: "system", preferredLanguages: ["id-ID", "en"]), "id")
        XCTAssertEqual(L10n.resolveLanguage(preference: "system", preferredLanguages: ["en-GB", "id"]), "en")
        XCTAssertEqual(L10n.resolveLanguage(preference: "id", preferredLanguages: ["en"]), "id")
        XCTAssertEqual(L10n.resolveLanguage(preference: "en", preferredLanguages: ["id"]), "en")
        XCTAssertEqual(L10n.resolveLanguage(preference: "system", preferredLanguages: ["ja-JP"]), "en")
        XCTAssertEqual(L10n.text("Pengaturan", language: "en"), "Settings")
        XCTAssertEqual(L10n.text("Pengaturan", language: "id"), "Pengaturan")

        let idURL = try XCTUnwrap(Bundle.main.url(forResource: "Localizable", withExtension: "strings", subdirectory: "id.lproj"))
        let enURL = try XCTUnwrap(Bundle.main.url(forResource: "Localizable", withExtension: "strings", subdirectory: "en.lproj"))
        let indonesian = try XCTUnwrap(NSDictionary(contentsOf: idURL) as? [String: String])
        let english = try XCTUnwrap(NSDictionary(contentsOf: enURL) as? [String: String])
        XCTAssertEqual(Set(indonesian.keys), Set(english.keys))
        XCTAssertGreaterThan(english.count, 200)
        for (key, translated) in english {
            XCTAssertFalse(translated.isEmpty, key)
            XCTAssertEqual(key.components(separatedBy: "%@").count, translated.components(separatedBy: "%@").count, "Format arguments must survive translation: \(key)")
        }
        for language in ["en", "id"] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
            let bundle = try XCTUnwrap(Bundle(path: path))
            XCTAssertNotEqual(bundle.localizedString(forKey: "NSMicrophoneUsageDescription", value: nil, table: "InfoPlist"), "NSMicrophoneUsageDescription")
        }
    }

    func testEnglishFormatsAndServiceErrorsFollowLanguagePreference() {
        let saved = UserDefaults.standard.object(forKey: L10n.preferenceKey)
        defer {
            if let saved { UserDefaults.standard.set(saved, forKey: L10n.preferenceKey) }
            else { UserDefaults.standard.removeObject(forKey: L10n.preferenceKey) }
        }
        UserDefaults.standard.set("en", forKey: L10n.preferenceKey)
        XCTAssertEqual(L10n.format("%@ dari %@", "3", "15"), "3 of 15")
        XCTAssertEqual(BisikTheme.minutes(1), "1 second")
        XCTAssertEqual(BisikTheme.minutes(60), "1 minute")
        XCTAssertEqual(BisikTheme.minutes(61), "2 minutes")
        XCTAssertEqual(APIError.server(code: "quota_exceeded", message: "Kuota transkripsi bulan ini sudah habis.", status: 402).localizedDescription, "Your transcription quota for this month is used up.")
        UserDefaults.standard.set("id", forKey: L10n.preferenceKey)
        XCTAssertEqual(BisikTheme.minutes(60), "1 menit")
        XCTAssertEqual(L10n.format("%@ dari %@", "3", "15"), "3 dari 15")
    }

    @MainActor
    func testOrbRespondsToAudioAndRespectsReduceMotion() throws {
        let silent = try renderOrb(levels: Array(repeating: 0, count: 32), time: 0)
        let speaking = try renderOrb(levels: Array(repeating: 0.8, count: 32), time: 0)
        XCTAssertNotEqual(silent.pngData(), speaking.pngData(), "The waveform must change with microphone levels")
        let later = try renderOrb(levels: Array(repeating: 0.8, count: 32), time: 2)
        XCTAssertNotEqual(speaking.pngData(), later.pngData(), "The inner contours must flow while recording")
        let reducedStart = try renderOrb(levels: [0.2, 0.8], time: 0, reduced: true)
        let reducedLater = try renderOrb(levels: [0.2, 0.8], time: 2, reduced: true)
        XCTAssertEqual(reducedStart.pngData(), reducedLater.pngData(), "Reduce Motion removes decorative movement")
        let invalid = try renderOrb(levels: [.nan, .infinity, -1], time: 0)
        XCTAssertEqual(silent.pngData(), invalid.pngData(), "Invalid samples must not disturb the waveform")
        attach(speaking, name: "Orb - actual SwiftUI rendering")
    }

    @MainActor
    func testCaptureNativeMotionAndSplashEvidence() throws {
        // Render the production SwiftUI component with deterministic audio-level
        // fixtures. This is animation evidence, not a fabricated voice session.
        for frame in 0..<24 {
            let time = Double(frame) / 12
            let levels = (0..<32).map { CGFloat(0.15 + 0.5 * abs(sin(Double($0) * 0.45 + time * 3))) }
            attach(try renderOrb(levels: levels, time: time), name: String(format: "Orb frame %02d", frame))
        }
        let renderer = ImageRenderer(content: SplashView().frame(width: 393, height: 852))
        renderer.scale = 2
        let splash = try XCTUnwrap(renderer.uiImage)
        XCTAssertEqual(splash.size.width, 393)
        attach(splash, name: "Splash - native one-second launch view")
    }

    @MainActor
    private func renderOrb(levels: [CGFloat], time: Double, reduced: Bool = false) throws -> UIImage {
        let content = VoiceOrbView(levels: levels, phase: .recording, pressed: true, previewTime: time, previewReduceMotion: reduced)
            .frame(width: 240, height: 240)
            .background(Color.white)
            .environment(\.scenePhase, .active)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        return try XCTUnwrap(renderer.uiImage)
    }

    private func attach(_ image: UIImage, name: String) {
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

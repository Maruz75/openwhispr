import XCTest

/// Exercises real controls with manually typed drafts; no mocked authentication or recordings.
final class EditingNavigationTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(id)", "-AppleLocale", "id_ID"]
        app.launch()
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
    }

    override func tearDownWithError() throws {
        app.terminate()
        app = nil
    }

    func testMinimalHomeAndMenuDestinationsPreserveDraft() {
        XCTAssertEqual(app.tabBars.count, 0)
        XCTAssertTrue(app.buttons["navigation.menu"].isHittable)
        XCTAssertTrue(element("transcript.copy").exists)
        XCTAssertTrue(element("recorder.microphone").exists)
        XCTAssertTrue(app.buttons["navigation.newDraft"].exists)
        XCTAssertFalse(app.staticTexts["Baru"].exists)
        for oldLabel in ["bisik", "Pikiranmu, menjadi tulisan.", "TULISANMU", "Tahan untuk berbicara", "Ruang untuk bicara"] {
            XCTAssertFalse(app.staticTexts[oldLabel].exists)
        }
        screenshot("Home - minimal native interface")

        let draft = "Alpha beta gamma."
        typeDraft(draft)
        dismissKeyboard()
        openMenu()
        for destination in ["recorder", "history", "dictionary", "quota", "settings", "subscription", "newDraft"] {
            XCTAssertTrue(app.buttons["menu." + destination].exists)
        }
        screenshot("Menu - all destinations")

        app.buttons["menu.history"].tap()
        XCTAssertTrue(waitUntilGone(app.buttons["menu.close"]))
        XCTAssertTrue(app.staticTexts["Riwayat"].firstMatch.waitForExistence(timeout: 5))
        navigate("dictionary")
        XCTAssertTrue(app.staticTexts["Kamus"].firstMatch.waitForExistence(timeout: 5))
        navigate("settings")
        XCTAssertTrue(app.staticTexts["Pengaturan"].firstMatch.waitForExistence(timeout: 5))
        navigate("quota")
        XCTAssertTrue(app.staticTexts["Paket & kuota"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["quota.openPaywall"].exists)
        screenshot("Quota - dedicated package screen")

        openMenu()
        app.buttons["menu.subscription"].tap()
        XCTAssertTrue(app.buttons["Tutup langganan"].waitForExistence(timeout: 5))
        app.buttons["Tutup langganan"].tap()
        XCTAssertTrue(waitUntilGone(app.buttons["Tutup langganan"]))
        XCTAssertTrue(app.staticTexts["Paket & kuota"].firstMatch.waitForExistence(timeout: 5))

        navigate("recorder")
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertEqual(editor.value as? String, draft)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
    }

    func testTapPositionsCursorInFirstLineAndCheckmarkDismissesKeyboard() {
        let draft = "Alpha beta gamma.\nSecond line stays here."
        typeDraft(draft)
        screenshot("Keyboard - checkmark accessory")
        dismissKeyboard()
        XCTAssertEqual(editor.value as? String, draft)

        // Tap within the first rendered word rather than calling focus programmatically.
        // Coordinates are relative to the text view's own text container, before keyboard resizing.
        editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 24, dy: 17)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.typeText("X")
        let changed = editor.value as? String ?? ""
        XCTAssertEqual(changed.count, draft.count + 1)
        XCTAssertTrue(changed.components(separatedBy: "\n")[0].contains("X"), "Retapping a visible word must insert in that line")
        XCTAssertFalse(changed.hasSuffix("X"), "The cursor must not jump to the end of the entire transcript")
        dismissKeyboard()
        screenshot("Editor - cursor edit committed and keyboard hidden")
    }

    func testLongDraftScrollDoesNotFocusAndMenuDismissesKeyboard() {
        let longDraft = (1...34).map { "Line \($0) alpha beta." }.joined(separator: "\n")
        typeDraft(longDraft)
        dismissKeyboard()
        let beforeScrolling = editor.value as? String

        editor.swipeDown()
        editor.swipeDown()
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Scrolling an unfocused transcript must not open the keyboard")
        XCTAssertEqual(editor.value as? String, beforeScrolling)

        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.20)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Tap after scrolling must begin editing")
        XCTAssertTrue(app.buttons["transcript.done"].exists)
        openMenu()
        XCTAssertTrue(waitUntilGone(app.keyboards.firstMatch), "Opening the menu must end editing and dismiss the keyboard")
        screenshot("Menu - opened from a scrolled editor")
        app.buttons["menu.close"].tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertEqual(editor.value as? String, beforeScrolling)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
    }

    func testEdgeSwipeCopyAndPlusUseReachableControls() {
        let draft = "A short editable draft."
        typeDraft(draft)
        dismissKeyboard()
        let copy = app.buttons["transcript.copy"]
        XCTAssertGreaterThan(copy.frame.midY, editor.frame.maxY, "Copy belongs below the text area")
        XCTAssertGreaterThan(copy.frame.midX, editor.frame.midX, "Copy belongs on the right")
        XCTAssertGreaterThanOrEqual(copy.frame.width, 48)
        copy.tap()
        XCTAssertTrue(app.buttons["Tulisan tersalin"].waitForExistence(timeout: 3))
        screenshot("Home - bottom copy confirmation and integrated orb")

        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.40)).withOffset(CGVector(dx: 5, dy: 0))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.40))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(app.buttons["menu.close"].waitForExistence(timeout: 5), "An inward swipe from the left edge opens the menu")
        app.buttons["menu.close"].tap()
        XCTAssertTrue(waitUntilGone(app.buttons["menu.close"]))
        XCTAssertEqual(editor.value as? String, draft)
        app.buttons["navigation.newDraft"].tap()
        XCTAssertEqual(editor.value as? String, "")
        XCTAssertFalse(app.keyboards.firstMatch.exists)
    }

    func testSwitchToEnglishPreservesDraftAndSpeechLanguage() {
        let draft = "Tulisan ini tidak diterjemahkan."
        typeDraft(draft)
        dismissKeyboard()
        navigate("settings")
        app.buttons["settings.interfaceLanguage"].tap()
        app.buttons["English"].tap()
        XCTAssertTrue(app.staticTexts["Settings"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["settings.interfaceLanguage"].label.contains("App language"))
        XCTAssertTrue(app.buttons["settings.speechLanguage"].label.contains("Speech language"))
        // Interface selection must not change the stored speech-recognition locale.
        let speech = app.buttons["settings.speechLanguage"]
        XCTAssertTrue((speech.label + " " + (speech.value as? String ?? "")).contains("Indonesian"))
        screenshot("English - settings and separate speech language")

        openMenu()
        for (destination, label) in [("recorder", "Record"), ("history", "History"), ("dictionary", "Dictionary"), ("subscription", "Subscription"), ("quota", "Plan & quota"), ("settings", "Settings")] {
            XCTAssertEqual(app.buttons["menu." + destination].label, label)
        }
        screenshot("English - all menu destinations")
        app.buttons["menu.quota"].tap()
        XCTAssertTrue(waitUntilGone(app.buttons["menu.close"]))
        XCTAssertTrue(app.staticTexts["Plan & quota"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Free plan"].firstMatch.exists)
        screenshot("English - dedicated free plan and quota")
        navigate("recorder")
        XCTAssertEqual(editor.value as? String, draft)
        XCTAssertEqual(editor.label, "Transcription")

        navigate("settings")
        app.buttons["settings.interfaceLanguage"].tap()
        app.buttons["System default"].tap()
        XCTAssertTrue(app.staticTexts["Pengaturan"].firstMatch.waitForExistence(timeout: 5))
    }

    private var editor: XCUIElement { app.textViews["transcript.editor"] }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func typeDraft(_ text: String) {
        editor.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.typeText(text)
        XCTAssertTrue(app.buttons["transcript.done"].waitForExistence(timeout: 5))
    }

    private func dismissKeyboard() {
        app.buttons["transcript.done"].tap()
        XCTAssertTrue(waitUntilGone(app.keyboards.firstMatch))
    }

    private func openMenu() {
        let menu = app.buttons["navigation.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        XCTAssertTrue(menu.isHittable)
        menu.tap()
        XCTAssertTrue(app.buttons["menu.close"].waitForExistence(timeout: 5))
    }

    private func navigate(_ destination: String) {
        openMenu()
        app.buttons["menu." + destination].tap()
        XCTAssertTrue(waitUntilGone(app.buttons["menu.close"]))
    }

    private func waitUntilGone(_ element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

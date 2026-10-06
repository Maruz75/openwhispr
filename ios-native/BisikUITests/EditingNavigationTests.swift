import XCTest

/// Exercises real controls with manually typed drafts; no mocked authentication or recordings.
final class EditingNavigationTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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
        XCTAssertTrue(element("screen.history").waitForExistence(timeout: 5))
        navigate("dictionary")
        XCTAssertTrue(element("screen.dictionary").waitForExistence(timeout: 5))
        navigate("settings")
        XCTAssertTrue(element("screen.settings").waitForExistence(timeout: 5))
        navigate("quota")
        XCTAssertTrue(element("screen.quota").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["quota.openPaywall"].exists)
        screenshot("Quota - dedicated package screen")

        openMenu()
        app.buttons["menu.subscription"].tap()
        XCTAssertTrue(app.buttons["Tutup langganan"].waitForExistence(timeout: 5))
        app.buttons["Tutup langganan"].tap()
        XCTAssertTrue(element("screen.quota").waitForExistence(timeout: 5))

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

import AVFoundation
import Combine
import StoreKit
import SwiftUI
import UIKit

@MainActor
final class AppModel: ObservableObject {
    @Published var text = ""
    @Published var phase: RecordingPhase = .idle
    @Published var levels = Array(repeating: CGFloat(0.08), count: 32)
    @Published var elapsedSeconds: Double = 0
    @Published var history: [TranscriptRecord] = []
    @Published var dictionary: [DictionaryEntry] = []
    @Published var settings = AppSettings()
    @Published var quota: UsageQuota?
    @Published var errorMessage: String?
    @Published var copied = false
    @Published var showPaywall = false
    @Published var needsConsent = false
    @Published var needsSignIn = false
    @Published var isSignedIn = false
    @Published var products: [Product] = []
    @Published var isPurchasing = false
    @Published var isConfigured = AppConfiguration.apiBaseURL != nil && AppConfiguration.privacyURL != nil && AppConfiguration.termsURL != nil
    @Published var learnedCount = 0
    @Published var hasPendingRecording = false

    private let api = APIClient()
    private let keychain = SecureSessionStore()
    private let recorder = AudioRecorder()
    private let subscriptions = SubscriptionService()
    private var store: LocalDataStore?
    private var session: AuthSession?
    private var accountGeneration = 0
    private var hold = HoldStateMachine()
    private var pending: PendingRecording?
    private var uploadTask: Task<TranscriptionResponse, Error>?
    private var copiedTask: Task<Void, Never>?
    private var bootstrapped = false
    private var activeHistoryID: UUID?
    private var editBaseline = ""
    private var draftBeforeRecording: (text: String, baseline: String, historyID: UUID?)?
    private var observers: [NSObjectProtocol] = []

    init() {
        recorder.onSamples = { [weak self] levels, elapsed in
            self?.levels = levels; self?.elapsedSeconds = elapsed
        }
        recorder.onPreview = { [weak self] preview in
            guard let self, self.phase == .recording else { return }
            self.text = preview
        }
        recorder.onLimit = { [weak self] in Task { await self?.endHold() } }
        recorder.onFailure = { [weak self] error in
            self?.cancelRecording(); self?.errorMessage = error.localizedDescription
        }
        subscriptions.synchronize = { [weak self] transaction, signedTransaction in
            guard let self, let session = self.session else { throw SubscriptionError.noAccount }
            guard transaction.appAccountToken == session.accountToken else { throw SubscriptionError.noAccount }
            let generation = self.accountGeneration
            let response = try await self.api.verifySubscription(signedTransaction: signedTransaction, token: session.accessToken)
            guard generation == self.accountGeneration else { throw CancellationError() }
            self.quota = response.quota
        }
        subscriptions.onError = { [weak self] error in
            guard self?.isSignedIn == true else { return }
            self?.handle(error)
        }
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.phase != .idle { self.cancelRecording() }
            }
        })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  raw == AVAudioSession.InterruptionType.began.rawValue else { return }
            Task { @MainActor in
                guard let self, self.phase != .idle else { return }
                self.cancelRecording()
                self.errorMessage = "Rekaman dihentikan karena audio terganggu. Tahan mikrofon untuk merekam kembali."
            }
        })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  raw == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
            Task { @MainActor in
                guard let self, self.phase == .recording else { return }
                self.cancelRecording()
                self.errorMessage = "Perangkat mikrofon terputus. Tahan mikrofon untuk merekam kembali."
            }
        })
    }

    func bootstrap() async {
        guard !bootstrapped else { return }
        bootstrapped = true
        do {
            let store = try LocalDataStore()
            let saved = try store.load()
            self.store = store
            settings = saved.settings; history = saved.history; dictionary = saved.dictionary
            if settings.consentGranted, settings.consentDisclosure != consentDisclosure {
                settings.consentGranted = false
                saveSettings()
            }
        } catch {
            self.store = nil
            errorMessage = "Data lokal belum dapat dibuka. Berkas riwayat tetap dipertahankan dan tidak akan ditimpa."
        }
        do { session = try keychain.load(); isSignedIn = session != nil }
        catch { handle(error) }
        cleanOrphanedAudio()
        subscriptions.startObserving()
        do { products = try await subscriptions.loadProducts() }
        catch { /* Recording remains available when StoreKit is temporarily unavailable. */ }
        if session != nil {
            await refreshQuota()
            do { try await subscriptions.reconcile() } catch { handle(error) }
        }
    }

    func beginHold() async {
        guard phase == .idle else { return }
        guard !hasPendingRecording else {
            errorMessage = "Coba kembali rekaman terakhir, atau hapus draf sebelum merekam lagi."
            return
        }
        guard isConfigured else {
            errorMessage = "Layanan dan kebijakan privasi perlu dikonfigurasi oleh pengembang sebelum merekam."
            return
        }
        guard settings.consentGranted, settings.consentDisclosure == consentDisclosure else { needsConsent = true; return }
        guard let currentSession = session else { needsSignIn = true; return }
        let token = hold.begin()
        let generation = accountGeneration
        phase = .preparing
        errorMessage = nil
        do {
            let latestQuota = try await api.quota(token: currentSession.accessToken)
            guard hold.accepts(token), generation == accountGeneration else { return }
            quota = latestQuota
            guard latestQuota.remainingSeconds > 0 else {
                hold.end(); phase = .idle; showPaywall = true; return
            }
            let microphoneAllowed = await recorder.requestMicrophone()
            guard hold.accepts(token), generation == accountGeneration else { return }
            guard microphoneAllowed else { throw RecorderError.microphoneDenied }
            await recorder.prepareLiveSpeech(language: settings.language)
            guard hold.accepts(token), generation == accountGeneration else { return }
            guard UIApplication.shared.applicationState == .active else { cancelRecording(); return }
            // Preserve the user's draft until auth, quota and permissions have all succeeded.
            commitEdits()
            draftBeforeRecording = (text, editBaseline, activeHistoryID)
            try recorder.start(maximumSeconds: min(Double(latestQuota.remainingSeconds), 300))
            text = ""; editBaseline = ""; activeHistoryID = nil
            copied = false; learnedCount = 0; elapsedSeconds = 0
            phase = .recording
            haptic(.medium)
        } catch {
            guard hold.accepts(token), generation == accountGeneration else { return }
            hold.end(); phase = .idle
            recorder.cancel()
            restoreDraft()
            handle(error)
        }
    }

    func endHold() async {
        hold.end()
        if phase == .preparing { phase = .idle; return }
        guard phase == .recording else { return }
        do {
            let (url, duration) = try recorder.stop()
            pending = PendingRecording(url: url, requestID: UUID(), durationSeconds: duration,
                                       dictionary: outgoingDictionary(), language: settings.language)
            hasPendingRecording = true
            haptic(.light)
            await retryTranscription()
        } catch {
            phase = .idle; restoreDraft(); handle(error)
        }
    }

    func cancelRecording() {
        hold.end()
        uploadTask?.cancel(); uploadTask = nil
        recorder.cancel()
        discardPending()
        restoreDraft()
        phase = .idle
        elapsedSeconds = 0
        levels = Array(repeating: 0.08, count: 32)
    }

    func retryTranscription() async {
        guard phase != .processing, let recording = pending else { return }
        guard settings.consentGranted, settings.consentDisclosure == consentDisclosure else { needsConsent = true; return }
        guard let currentSession = session else { needsSignIn = true; return }
        let generation = accountGeneration
        phase = .processing; errorMessage = nil
        let task = Task { try await api.transcribe(recording, token: currentSession.accessToken) }
        uploadTask = task
        do {
            let response = try await task.value
            guard !task.isCancelled, generation == accountGeneration, pending?.requestID == recording.requestID else { return }
            let transcript = response.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !transcript.isEmpty else { throw APIError.invalidResponse }
            quota = response.quota
            text = transcript; editBaseline = transcript
            let record = TranscriptRecord(text: transcript, originalText: transcript, durationSeconds: recording.durationSeconds)
            activeHistoryID = record.id
            if settings.saveHistory { history.insert(record, at: 0); persist() }
            discardPending()
            draftBeforeRecording = nil
            uploadTask = nil; phase = .idle
            if settings.autoCopy { copyText() }
        } catch {
            guard !task.isCancelled, generation == accountGeneration, pending?.requestID == recording.requestID else { return }
            uploadTask = nil; phase = .idle
            handle(error)
        }
    }

    func copyText() {
        guard phase == .idle, !hasPendingRecording, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        commitEdits()
        // Writing only: never inspect the user's clipboard.
        UIPasteboard.general.string = text
        copied = true
        haptic(.light)
        copiedTask?.cancel()
        copiedTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            guard !Task.isCancelled else { return }
            self?.copied = false
        }
    }

    func commitEdits() {
        guard phase != .recording, phase != .processing, !hasPendingRecording, text != editBaseline else { return }
        if settings.learnCorrections {
            let learned = CorrectionLearner.extract(original: editBaseline, edited: text, existing: dictionary)
            for entry in learned {
                if let index = dictionary.firstIndex(where: { $0.source.caseInsensitiveCompare(entry.source) == .orderedSame }) {
                    if dictionary[index].learned { dictionary[index] = entry }
                } else { dictionary.append(entry) }
            }
            learnedCount = learned.count
        }
        if let id = activeHistoryID, let index = history.firstIndex(where: { $0.id == id }) {
            history[index].text = text
        }
        editBaseline = text
        copied = false
        persist()
    }

    func newDraft() {
        if phase != .idle || hasPendingRecording { cancelRecording() }
        commitEdits()
        text = ""; editBaseline = ""; activeHistoryID = nil; copied = false; learnedCount = 0
    }

    func openHistory(_ record: TranscriptRecord) {
        guard phase == .idle else { return }
        if hasPendingRecording { cancelRecording() }
        commitEdits()
        text = record.text; editBaseline = record.text; activeHistoryID = record.id
        copied = false; learnedCount = 0
    }

    func deleteHistory(_ id: UUID) {
        history.removeAll { $0.id == id }
        if activeHistoryID == id { activeHistoryID = nil }
        persist()
    }

    func clearHistory() { history = []; activeHistoryID = nil; persist() }

    func addDictionary(source: String, replacement: String) {
        let source = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let replacement = replacement.trimmingCharacters(in: .whitespacesAndNewlines)
        let entry = DictionaryEntry(source: source, replacement: replacement)
        guard entry.isValidContext else {
            errorMessage = "Isi kata asli dan koreksinya, masing-masing maksimal 80 karakter."
            return
        }
        if let index = dictionary.firstIndex(where: { $0.source.caseInsensitiveCompare(source) == .orderedSame }) { dictionary[index] = entry }
        else { dictionary.append(entry) }
        persist()
    }

    func deleteDictionary(_ id: UUID) { dictionary.removeAll { $0.id == id }; persist() }
    func saveSettings() { persist() }

    func acceptConsent() {
        settings.consentGranted = true
        settings.consentDisclosure = consentDisclosure
        needsConsent = false
        persist()
    }

    func revokeConsent() {
        cancelRecording()
        settings.consentGranted = false; settings.consentDisclosure = nil
        needsConsent = false
        persist()
    }

    func signIn(identityToken: String, nonce: String, authorizationCode: String? = nil) async {
        let generation = accountGeneration
        do {
            let response = try await api.signIn(identityToken: identityToken, nonce: nonce, authorizationCode: authorizationCode)
            guard generation == accountGeneration else { return }
            let signedIn = AuthSession(accessToken: response.accessToken, accountToken: response.accountToken)
            try keychain.save(signedIn)
            session = signedIn; isSignedIn = true; quota = response.quota; needsSignIn = false
            do { try await subscriptions.reconcile() } catch { handle(error) }
        } catch { handle(error) }
    }

    func signOut() {
        let accessToken = session?.accessToken
        cancelRecording()
        invalidateSession()
        newDraft()
        // Local sign-out happens immediately; server logout revokes this opaque session.
        if let accessToken { Task { try? await api.logout(token: accessToken) } }
    }

    func deleteAccount() async {
        guard let currentSession = session else { needsSignIn = true; return }
        let generation = accountGeneration
        do {
            cancelRecording()
            try await api.deleteAccount(token: currentSession.accessToken)
            guard generation == accountGeneration else { return }
            invalidateSession()
            history = []; dictionary = []; settings = AppSettings(); learnedCount = 0
            text = ""; editBaseline = ""; activeHistoryID = nil
            persist()
        } catch { handle(error) }
    }

    func purchase(_ product: Product) async {
        guard !isPurchasing else { return }
        guard let session else { needsSignIn = true; return }
        isPurchasing = true
        defer { isPurchasing = false }
        do { try await subscriptions.purchase(product, accountToken: session.accountToken); if quota?.plan == "pro" { showPaywall = false } }
        catch { handle(error) }
    }

    func restorePurchases() async {
        guard !isPurchasing else { return }
        guard session != nil else { needsSignIn = true; return }
        isPurchasing = true
        defer { isPurchasing = false }
        do { try await subscriptions.restore(); await refreshQuota(); if quota?.plan == "pro" { showPaywall = false } }
        catch { handle(error) }
    }

    func refreshQuota() async {
        guard let session else { return }
        let generation = accountGeneration
        do {
            let quota = try await api.quota(token: session.accessToken)
            guard generation == accountGeneration else { return }
            self.quota = quota
        } catch { if generation == accountGeneration { handle(error) } }
    }

    private var consentDisclosure: String {
        [AppConfiguration.aiProviderDisclosure, AppConfiguration.apiBaseURL?.absoluteString ?? "",
         AppConfiguration.privacyURL?.absoluteString ?? ""].joined(separator: "\n")
    }

    private func persist() {
        guard let store else {
            errorMessage = "Data lokal belum tersedia; riwayat baru belum tersimpan. Data lama tetap dipertahankan."
            return
        }
        do { try store.save(StoredData(settings: settings, history: history, dictionary: dictionary)) }
        catch { errorMessage = "Data lokal belum tersimpan. Periksa ruang kosong dan buka kunci iPhone." }
    }

    private func discardPending() {
        if let pending { try? FileManager.default.removeItem(at: pending.url) }
        pending = nil; hasPendingRecording = false
    }

    private func outgoingDictionary() -> [DictionaryEntry] {
        var entries = Array(dictionary.filter(\.isValidContext).sorted { $0.createdAt > $1.createdAt }.prefix(100))
        while !entries.isEmpty {
            let encoded = try? JSONSerialization.data(withJSONObject: entries.map { ["source": $0.source, "replacement": $0.replacement] })
            if let encoded, encoded.count <= 60 * 1024 { break }
            entries.removeLast()
        }
        return entries
    }

    private func restoreDraft() {
        if let draftBeforeRecording {
            text = draftBeforeRecording.text; editBaseline = draftBeforeRecording.baseline; activeHistoryID = draftBeforeRecording.historyID
        }
        draftBeforeRecording = nil
    }

    private func invalidateSession() {
        accountGeneration &+= 1
        session = nil; isSignedIn = false; quota = nil; needsSignIn = false
        do { try keychain.clear() } catch { errorMessage = error.localizedDescription }
    }

    private func handle(_ error: Error) {
        if error is CancellationError { return }
        if let apiError = error as? APIError {
            if apiError.isUnauthorized { invalidateSession(); needsSignIn = true }
            if apiError.isQuotaExceeded { showPaywall = true }
        }
        if error is URLError {
            errorMessage = "Koneksi ke layanan terputus. Periksa internet dan coba lagi."
            return
        }
        if error is DecodingError {
            errorMessage = APIError.invalidResponse.localizedDescription
            return
        }
        errorMessage = error.localizedDescription
    }

    private func haptic(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        guard settings.haptics else { return }
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    private func cleanOrphanedAudio() {
        // Audio retry lives only for this foreground session. Crash leftovers are removed on launch.
        let directory = FileManager.default.temporaryDirectory
        guard let urls = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for url in urls where url.lastPathComponent.hasPrefix("bisik-") && ["wav", "multipart"].contains(url.pathExtension) {
            if url != pending?.url { try? FileManager.default.removeItem(at: url) }
        }
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        uploadTask?.cancel(); copiedTask?.cancel()
    }
}

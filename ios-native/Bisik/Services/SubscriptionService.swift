import Foundation
import StoreKit

enum SubscriptionError: LocalizedError {
    case unverified, pending, noAccount, accountMismatch, unavailable
    var errorDescription: String? {
        switch self {
        case .unverified: return L10n.text("Pembelian belum dapat diverifikasi oleh App Store.")
        case .pending: return L10n.text("Pembelian menunggu persetujuan App Store. Kuota diperbarui setelah disetujui.")
        case .noAccount: return L10n.text("Masuk dengan Apple sebelum berlangganan atau memulihkan pembelian.")
        case .accountMismatch: return L10n.text("Pembelian ini terhubung ke akun Bisik lain. Masuk dengan akun Apple yang digunakan saat membeli.")
        case .unavailable: return L10n.text("Langganan belum tersedia. Coba lagi nanti.")
        }
    }
}

@MainActor
final class SubscriptionService {
    /// True means the server confirmed an active subscription, after online Apple verification.
    var synchronize: ((Transaction, String) async throws -> Bool)?
    var onError: ((Error) -> Void)?
    private var updatesTask: Task<Void, Never>?
    private var inFlight: [UInt64: Task<Bool, Error>] = [:]

    func startObserving() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled else { return }
                do { _ = try await self?.process(result) }
                catch { self?.onError?(error) }
            }
        }
    }

    func loadProducts() async throws -> [Product] {
        let products = try await Product.products(for: AppConfiguration.productIDs)
        return products.sorted { $0.price < $1.price }
    }

    func purchase(_ product: Product, accountToken: UUID) async throws {
        guard AppConfiguration.productIDs.contains(product.id) else { throw SubscriptionError.unavailable }
        switch try await product.purchase(options: [.appAccountToken(accountToken)]) {
        case .success(let result): _ = try await process(result)
        case .userCancelled: break
        case .pending: throw SubscriptionError.pending
        @unknown default: throw SubscriptionError.unavailable
        }
    }

    func restore() async throws {
        try await AppStore.sync()
        try await reconcile()
    }

    /// Server errors leave the Apple transaction unfinished for automatic retry on next launch/login.
    func reconcile() async throws {
        var firstError: Error?
        var synchronizedActive = false
        for await result in Transaction.unfinished {
            do { if try await process(result) { synchronizedActive = true } }
            catch SubscriptionError.accountMismatch { continue }
            catch { if firstError == nil { firstError = error } }
        }
        for await result in Transaction.currentEntitlements {
            do { if try await process(result) { synchronizedActive = true } }
            catch SubscriptionError.accountMismatch { continue }
            catch { if firstError == nil { firstError = error } }
        }
        if !synchronizedActive, let firstError { throw firstError }
    }

    private func process(_ result: VerificationResult<Transaction>) async throws -> Bool {
        guard case .verified(let transaction) = result else { throw SubscriptionError.unverified }
        guard AppConfiguration.productIDs.contains(transaction.productID) else { return false }
        if let existing = inFlight[transaction.id] { return try await existing.value }
        guard let synchronize else { throw SubscriptionError.noAccount }
        let signedTransaction = result.jwsRepresentation
        let task = Task {
            let active = try await synchronize(transaction, signedTransaction)
            try Task.checkCancellation()
            // Finishing happens only after server Apple verification and quota update succeed.
            await transaction.finish()
            return active
        }
        inFlight[transaction.id] = task
        defer { inFlight[transaction.id] = nil }
        return try await task.value
    }

    deinit {
        updatesTask?.cancel()
        for task in inFlight.values { task.cancel() }
    }
}

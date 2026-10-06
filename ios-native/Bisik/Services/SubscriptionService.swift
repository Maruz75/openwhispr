import Foundation
import StoreKit

enum SubscriptionError: LocalizedError {
    case unverified, pending, noAccount, unavailable
    var errorDescription: String? {
        switch self {
        case .unverified: return "Pembelian belum dapat diverifikasi oleh App Store."
        case .pending: return "Pembelian menunggu persetujuan App Store. Kuota diperbarui setelah disetujui."
        case .noAccount: return "Masuk dengan Apple sebelum berlangganan atau memulihkan pembelian."
        case .unavailable: return "Langganan belum tersedia. Coba lagi nanti."
        }
    }
}

@MainActor
final class SubscriptionService {
    var synchronize: ((Transaction, String) async throws -> Void)?
    var onError: ((Error) -> Void)?
    private var updatesTask: Task<Void, Never>?
    private var inFlight: [UInt64: Task<Void, Error>] = [:]

    func startObserving() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled else { return }
                do { try await self?.process(result) }
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
        case .success(let result): try await process(result)
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
        for await result in Transaction.unfinished { try await process(result) }
        for await result in Transaction.currentEntitlements { try await process(result) }
    }

    private func process(_ result: VerificationResult<Transaction>) async throws {
        guard case .verified(let transaction) = result else { throw SubscriptionError.unverified }
        guard AppConfiguration.productIDs.contains(transaction.productID) else { return }
        if let existing = inFlight[transaction.id] { try await existing.value; return }
        guard let synchronize else { throw SubscriptionError.noAccount }
        let signedTransaction = result.jwsRepresentation
        let task = Task {
            try await synchronize(transaction, signedTransaction)
            try Task.checkCancellation()
            // Finishing happens only after server Apple verification and quota update succeed.
            await transaction.finish()
        }
        inFlight[transaction.id] = task
        defer { inFlight[transaction.id] = nil }
        try await task.value
    }

    deinit {
        updatesTask?.cancel()
        for task in inFlight.values { task.cancel() }
    }
}

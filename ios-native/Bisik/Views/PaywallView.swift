import SwiftUI
import StoreKit

struct PaywallView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var selectedID: String?
    @State private var manageSubscriptions = false

    private var products: [Product] {
        model.products.sorted { periodRank($0) < periodRank($1) }
    }
    private var selectedProduct: Product? {
        products.first { $0.id == selectedID } ?? products.first
    }
    private var readyToPurchase: Bool {
        selectedProduct != nil && model.isConfigured && AppConfiguration.privacyURL != nil && AppConfiguration.termsURL != nil && !model.isPurchasing
    }
    private var pro: Bool { model.quota?.plan == "pro" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        Text(L10n.text("BISIK PRO")).font(BisikTheme.font(11, semibold: true, relativeTo: .caption2)).foregroundStyle(BisikTheme.accent)
                        Spacer()
                        IconControl(symbol: "xmark", label: L10n.text("Tutup langganan"), disabled: model.isPurchasing) { dismiss() }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text(pro ? L10n.text("Bisik Pro aktif") : L10n.text("Langganan Bisik Pro"))
                            .font(BisikTheme.font(24, semibold: true, relativeTo: .title))
                            .foregroundStyle(BisikTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(L10n.format("%@ menit transkripsi setiap bulan.", AppConfiguration.proMinutes))
                            .font(BisikTheme.font(14))
                            .foregroundStyle(BisikTheme.secondary)
                            .lineSpacing(4)
                    }
                    VStack(alignment: .leading, spacing: 20) {
                        feature("waveform", title: L10n.text("Kuota transkripsi"), detail: L10n.format("%@ menit per bulan. Paket Free mendapat %@ menit.", AppConfiguration.proMinutes, AppConfiguration.freeMinutes))
                        feature("sparkle", title: L10n.text("Kamus dan riwayat"), detail: L10n.text("Kamus, pembelajaran koreksi, dan riwayat tersedia di semua paket."))
                        feature("doc.on.doc", title: L10n.text("Salin hasil"), detail: L10n.text("Hasil transkripsi dapat diedit dan disalin ke aplikasi lain."))
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 22))

                    if products.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Label(L10n.text("Paket belum tersedia"), systemImage: "info.circle")
                                .font(BisikTheme.font(14, semibold: true))
                                .foregroundStyle(BisikTheme.ink)
                            Text(L10n.text("Harga langganan akan muncul setelah terhubung dengan App Store. Kamu tetap dapat menggunakan kuota gratis yang tersedia."))
                                .font(BisikTheme.font(12, relativeTo: .caption))
                                .foregroundStyle(BisikTheme.secondary)
                                .lineSpacing(4)
                        }.padding(16)
                    } else {
                        VStack(spacing: 12) {
                            ForEach(products) { product in
                                planCard(product)
                            }
                        }
                    }
                    if let message = model.errorMessage {
                        Label(message, systemImage: "exclamationmark.circle")
                            .font(BisikTheme.font(12, relativeTo: .caption))
                            .foregroundStyle(BisikTheme.danger)
                    }
                    VStack(spacing: 12) {
                        if pro {
                            Button(L10n.text("Kelola langganan")) { manageSubscriptions = true }
                                .buttonStyle(BisikButtonStyle())
                        } else {
                            Button {
                                guard let product = selectedProduct else { return }
                                if !model.isSignedIn {
                                    model.needsSignIn = true
                                } else {
                                    Task { await model.purchase(product) }
                                }
                            } label: {
                                HStack(spacing: 12) {
                                    if model.isPurchasing { ProgressView().tint(.white) }
                                    Text(model.isPurchasing ? L10n.text("Memproses pembelian…") : model.isSignedIn ? L10n.text("Berlangganan Pro") : L10n.text("Masuk untuk berlangganan"))
                                }
                            }
                            .buttonStyle(BisikButtonStyle())
                            .disabled(!readyToPurchase)
                            .opacity(readyToPurchase ? 1 : 0.5)
                        }
                        if let product = selectedProduct, !pro {
                            Text(L10n.format("%@ %@. Langganan diperpanjang otomatis sampai kamu membatalkannya melalui App Store. Kuota diperbarui setiap bulan dan tidak diakumulasi.", product.displayPrice, periodDescription(product)))
                                .font(BisikTheme.font(11, relativeTo: .caption2))
                                .foregroundStyle(BisikTheme.secondary)
                                .multilineTextAlignment(.center)
                                .lineSpacing(4)
                        }
                        Button(L10n.text("Pulihkan pembelian")) { Task { await model.restorePurchases() } }
                            .font(BisikTheme.font(13, semibold: true))
                            .foregroundStyle(BisikTheme.ink)
                            .frame(minHeight: 44)
                            .disabled(model.isPurchasing)
                        if !pro {
                            Button(L10n.text("Kelola langganan App Store")) { manageSubscriptions = true }
                                .font(BisikTheme.font(12, relativeTo: .caption))
                                .foregroundStyle(BisikTheme.secondary)
                                .frame(minHeight: 44)
                        }
                    }
                    LegalLinks()
                }
                .padding(24)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(Color.white)
            .toolbar(.hidden, for: .navigationBar)
            .manageSubscriptionsSheet(isPresented: $manageSubscriptions)
            .onChange(of: model.products.map(\.id)) { _, ids in
                if selectedID == nil || !ids.contains(selectedID ?? "") { selectedID = ids.first }
            }
            .onAppear { if selectedID == nil { selectedID = products.first?.id } }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(model.isPurchasing)
    }

    private func planCard(_ product: Product) -> some View {
        let selected = selectedProduct?.id == product.id
        return Button {
            selectedID = product.id
        } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(selected ? BisikTheme.accent : BisikTheme.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text(periodTitle(product)).font(BisikTheme.font(14, semibold: true)).foregroundStyle(BisikTheme.ink)
                    Text(L10n.format("%@ menit diperbarui setiap bulan", AppConfiguration.proMinutes))
                        .font(BisikTheme.font(11, relativeTo: .caption2))
                        .foregroundStyle(BisikTheme.secondary)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(product.displayPrice).font(BisikTheme.font(16, semibold: true)).foregroundStyle(BisikTheme.ink)
                    Text(periodDescription(product)).font(BisikTheme.font(11, relativeTo: .caption2)).foregroundStyle(BisikTheme.secondary)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 80)
            .background(selected ? BisikTheme.panel : Color.white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(selected ? BisikTheme.accent : BisikTheme.line, lineWidth: selected ? 2 : 1))
        }
        .buttonStyle(.plain)
        .disabled(model.isPurchasing)
        .accessibilityLabel("\(periodTitle(product)), \(product.displayPrice), \(periodDescription(product))")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func feature(_ symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.system(size: 20, weight: .regular)).foregroundStyle(BisikTheme.accent).frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(BisikTheme.font(14, semibold: true)).foregroundStyle(BisikTheme.ink)
                Text(detail).font(BisikTheme.font(12, relativeTo: .caption)).foregroundStyle(BisikTheme.secondary).lineSpacing(4)
            }
        }
    }

    private func periodRank(_ product: Product) -> Int {
        product.subscription?.subscriptionPeriod.unit == .month ? 0 : 1
    }

    private func periodTitle(_ product: Product) -> String {
        guard let period = product.subscription?.subscriptionPeriod else { return product.displayName }
        switch period.unit {
        case .month: return period.value == 1 ? L10n.text("Bulanan") : L10n.format("%@ bulan", period.value)
        case .year: return period.value == 1 ? L10n.text("Tahunan") : L10n.format("%@ tahun", period.value)
        case .week: return period.value == 1 ? L10n.text("Mingguan") : L10n.format("%@ minggu", period.value)
        case .day: return L10n.format("%@ hari", period.value)
        @unknown default: return product.displayName
        }
    }

    private func periodDescription(_ product: Product) -> String {
        guard let period = product.subscription?.subscriptionPeriod else { return L10n.text("sesuai paket") }
        let unit: String
        switch period.unit {
        case .day: unit = L10n.text(period.value == 1 ? "hari" : "hari jamak")
        case .week: unit = L10n.text(period.value == 1 ? "minggu" : "minggu jamak")
        case .month: unit = L10n.text(period.value == 1 ? "bulan" : "bulan jamak")
        case .year: unit = L10n.text(period.value == 1 ? "tahun" : "tahun jamak")
        @unknown default: return L10n.text("sesuai paket")
        }
        return period.value == 1 ? L10n.format("per %@", unit) : L10n.format("setiap %@ %@", period.value, unit)
    }
}

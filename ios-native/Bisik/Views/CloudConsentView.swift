import SwiftUI

struct CloudConsentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "waveform.and.mic")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(BisikTheme.accent)
                        .frame(width: 72, height: 72)
                        .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 22))
                        .accessibilityHidden(true)
                    PageTitle(title: L10n.text("Pemrosesan suara"), subtitle: L10n.text("Tinjau penggunaan data sebelum merekam."))
                    VStack(alignment: .leading, spacing: 12) {
                        Text(L10n.text("PEMROSES SUARAMU"))
                            .font(BisikTheme.font(11, semibold: true, relativeTo: .caption2))
                            .foregroundStyle(BisikTheme.secondary)
                        Text(AppConfiguration.aiProviderDisclosure)
                            .font(BisikTheme.font(15, semibold: true))
                            .foregroundStyle(BisikTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 18))
                    VStack(alignment: .leading, spacing: 20) {
                        consentRow("arrow.up.circle", title: L10n.text("Dikirim setelah kamu selesai"), detail: L10n.text("Rekaman suara, bahasa ucapan, dan kata dalam kamus dikirim ke server Bisik untuk diproses oleh layanan di atas."))
                        consentRow("text.alignleft", title: L10n.text("Diubah menjadi tulisan"), detail: L10n.text("Layanan AI mentranskripsi suara dan merapikan hasilnya. Hasil kembali ke iPhone untuk diedit atau disalin."))
                        consentRow("lock.shield", title: L10n.text("Kendali tetap di tanganmu"), detail: L10n.text("Riwayat dan kamus disimpan di perangkat. Kamu bisa mencabut persetujuan dan menghapus data melalui Pengaturan."))
                    }
                    if AppConfiguration.privacyURL == nil || !model.isConfigured {
                        Label(L10n.text("Layanan pemrosesan belum tersedia. Coba kembali nanti."), systemImage: "exclamationmark.circle")
                            .font(BisikTheme.font(12, relativeTo: .caption))
                            .foregroundStyle(BisikTheme.danger)
                    }
                    VStack(spacing: 8) {
                        Button(L10n.text("Setuju & lanjutkan")) { model.acceptConsent() }
                            .buttonStyle(BisikButtonStyle())
                            .disabled(AppConfiguration.privacyURL == nil || !model.isConfigured)
                            .opacity(AppConfiguration.privacyURL == nil || !model.isConfigured ? 0.5 : 1)
                        Button(L10n.text("Nanti saja")) { model.revokeConsent() }
                            .font(BisikTheme.font(14))
                            .foregroundStyle(BisikTheme.secondary)
                            .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    LegalLinks()
                }
                .padding(24)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(Color.white)
            .toolbar(.hidden, for: .navigationBar)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func consentRow(_ symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.system(size: 18)).foregroundStyle(BisikTheme.secondary).frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(BisikTheme.font(14, semibold: true)).foregroundStyle(BisikTheme.ink)
                Text(detail).font(BisikTheme.font(13)).foregroundStyle(BisikTheme.secondary).lineSpacing(4)
            }
        }
    }
}

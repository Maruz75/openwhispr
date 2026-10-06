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
                    PageTitle(title: "Sebelum mulai bicara", subtitle: "Kamu yang menentukan ke mana suaramu pergi.")
                    VStack(alignment: .leading, spacing: 12) {
                        Text("PEMROSES SUARAMU")
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
                        consentRow("arrow.up.circle", title: "Dikirim setelah kamu selesai", detail: "Rekaman suara, bahasa ucapan, dan kata dalam kamus dikirim ke server Bisik untuk diproses oleh layanan di atas.")
                        consentRow("text.alignleft", title: "Diubah menjadi tulisan", detail: "Layanan AI mentranskripsi suara dan merapikan hasilnya. Hasil kembali ke iPhone untuk diedit atau disalin.")
                        consentRow("lock.shield", title: "Kendali tetap di tanganmu", detail: "Riwayat dan kamus disimpan di perangkat. Kamu bisa mencabut persetujuan dan menghapus data melalui Pengaturan.")
                    }
                    if AppConfiguration.privacyURL == nil || !model.isConfigured {
                        Label("Layanan pemrosesan belum tersedia. Coba kembali nanti.", systemImage: "exclamationmark.circle")
                            .font(BisikTheme.font(12, relativeTo: .caption))
                            .foregroundStyle(BisikTheme.danger)
                    }
                    VStack(spacing: 8) {
                        Button("Setuju & lanjutkan") { model.acceptConsent() }
                            .buttonStyle(BisikButtonStyle())
                            .disabled(AppConfiguration.privacyURL == nil || !model.isConfigured)
                            .opacity(AppConfiguration.privacyURL == nil || !model.isConfigured ? 0.5 : 1)
                        Button("Nanti saja") { model.revokeConsent() }
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

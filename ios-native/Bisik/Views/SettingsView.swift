import SwiftUI
import StoreKit
import UIKit

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var clearHistoryAlert = false
    @State private var revokeConsentAlert = false
    @State private var deleteAccountAlert = false
    @State private var signOutAlert = false
    @State private var deletingAccount = false
    @State private var manageSubscriptions = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: "Pengaturan", subtitle: "Preferensi aplikasi.")
                .padding(24)
            Form {
                Section {
                    Toggle(isOn: $model.settings.autoCopy) {
                        settingsLabel("Salin otomatis", detail: "Salin hasil saat rekaman selesai.", symbol: "doc.on.doc")
                    }
                    Toggle(isOn: $model.settings.learnCorrections) {
                        settingsLabel("Pelajari koreksi", detail: "Tambahkan koreksi kata ke kamus.", symbol: "sparkle")
                    }
                    Toggle(isOn: $model.settings.haptics) {
                        settingsLabel("Getaran halus", detail: "Umpan balik saat mulai dan selesai.", symbol: "hand.tap")
                    }
                    Toggle(isOn: $model.settings.saveHistory) {
                        settingsLabel("Simpan riwayat", detail: "Simpan tulisan di iPhone ini.", symbol: "clock")
                    }
                    Picker(selection: $model.settings.language) {
                        Text("Bahasa Indonesia").tag("id-ID")
                        Text("English").tag("en-US")
                        Text("Bahasa Melayu").tag("ms-MY")
                        Text("日本語").tag("ja-JP")
                        Text("한국어").tag("ko-KR")
                        Text("中文").tag("zh-CN")
                        Text("Español").tag("es-ES")
                    } label: {
                        Label("Bahasa ucapan", systemImage: "globe")
                    }
                    .font(BisikTheme.font(14))
                } header: { sectionTitle("PREFERENSI") }

                Section {
                    Button { model.showPaywall = true } label: {
                        HStack {
                            settingsLabel("Bisik Pro", detail: "Paket langganan transkripsi.", symbol: "sparkles")
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(BisikTheme.secondary)
                        }
                    }
                    Button("Pulihkan pembelian") { Task { await model.restorePurchases() } }
                        .disabled(model.isPurchasing)
                    Button("Kelola langganan App Store") { manageSubscriptions = true }
                } header: { sectionTitle("LANGGANAN") }

                Section {
                    if model.isSignedIn {
                        Label("Terhubung dengan Apple", systemImage: "checkmark.circle")
                            .foregroundStyle(BisikTheme.accent)
                        Button("Keluar dari akun") {
                            if model.hasPendingRecording { signOutAlert = true } else { model.signOut() }
                        }
                        Button(role: .destructive) { deleteAccountAlert = true } label: {
                            HStack {
                                Text("Hapus akun & data")
                                Spacer()
                                if deletingAccount { ProgressView() }
                            }
                        }.disabled(deletingAccount)
                    } else {
                        Button { model.needsSignIn = true } label: {
                            settingsLabel("Masuk dengan Apple", detail: "Untuk kuota dan pembelianmu.", symbol: "apple.logo")
                        }
                    }
                    if let message = model.errorMessage {
                        Text(message).font(BisikTheme.font(12, relativeTo: .caption)).foregroundStyle(BisikTheme.danger)
                    }
                } header: { sectionTitle("AKUN") }

                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(model.settings.consentGranted ? "Pemrosesan suara disetujui" : "Pemrosesan suara belum disetujui", systemImage: "lock.shield")
                            .font(BisikTheme.font(14))
                        Text(AppConfiguration.aiProviderDisclosure)
                            .font(BisikTheme.font(12, relativeTo: .caption))
                            .foregroundStyle(BisikTheme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }.padding(.vertical, 8)
                    if model.settings.consentGranted {
                        Button("Cabut persetujuan pemrosesan") { revokeConsentAlert = true }
                    } else {
                        Button("Tinjau persetujuan pemrosesan") { model.needsConsent = true }
                    }
                    if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                        Link("Izin mikrofon & pengenalan suara", destination: settingsURL)
                    }
                    Button(role: .destructive) { clearHistoryAlert = true } label: {
                        Text("Hapus seluruh riwayat")
                    }.disabled(model.history.isEmpty)
                    if let privacy = AppConfiguration.privacyURL { Link("Kebijakan privasi", destination: privacy) }
                    if let terms = AppConfiguration.termsURL { Link("Ketentuan penggunaan", destination: terms) }
                } header: { sectionTitle("PRIVASI & DATA") } footer: {
                    Text("Riwayat dan kamus tersimpan di perangkat ini. Rekaman dikirim untuk pemrosesan hanya setelah kamu memberi persetujuan.")
                        .font(BisikTheme.font(11, relativeTo: .caption2))
                        .foregroundStyle(BisikTheme.secondary)
                }
                Section {
                    HStack {
                        Text("Bisik").font(BisikTheme.font(14, semibold: true))
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                            .font(BisikTheme.font(12, relativeTo: .caption))
                            .foregroundStyle(BisikTheme.secondary)
                    }
                }
            }
            .font(BisikTheme.font(14))
            .foregroundStyle(BisikTheme.ink)
            .tint(BisikTheme.accent)
            .scrollContentBackground(.hidden)
        }
        .background(Color.white)
        .manageSubscriptionsSheet(isPresented: $manageSubscriptions)
        .onChange(of: model.settings.autoCopy) { _, _ in model.saveSettings() }
        .onChange(of: model.settings.learnCorrections) { _, _ in model.saveSettings() }
        .onChange(of: model.settings.haptics) { _, _ in model.saveSettings() }
        .onChange(of: model.settings.saveHistory) { _, _ in model.saveSettings() }
        .onChange(of: model.settings.language) { _, _ in model.saveSettings() }
        .alert("Hapus seluruh riwayat?", isPresented: $clearHistoryAlert) {
            Button("Batal", role: .cancel) { }
            Button("Hapus riwayat", role: .destructive) { model.clearHistory() }
        } message: {
            Text("Semua tulisan tersimpan akan dihapus dari iPhone ini. Kamusmu tetap tersedia.")
        }
        .alert("Cabut persetujuan?", isPresented: $revokeConsentAlert) {
            Button("Batal", role: .cancel) { }
            Button("Cabut persetujuan", role: .destructive) { model.revokeConsent() }
        } message: {
            Text("Bisik berhenti mengirim rekaman untuk pemrosesan. Rekaman yang sedang berlangsung akan dibatalkan. Kamu dapat menyetujui kembali saat ingin merekam.")
        }
        .alert("Keluar dari akun?", isPresented: $signOutAlert) {
            Button("Batal", role: .cancel) { }
            Button("Hapus rekaman & keluar", role: .destructive) { model.signOut() }
        } message: {
            Text("Rekaman yang belum berhasil diproses akan dihapus saat kamu keluar dari akun.")
        }
        .alert("Hapus akun & data?", isPresented: $deleteAccountAlert) {
            Button("Batal", role: .cancel) { }
            Button("Hapus akun", role: .destructive) {
                deletingAccount = true
                Task {
                    await model.deleteAccount()
                    deletingAccount = false
                }
            }
        } message: {
            Text("Akun, riwayat, dan kamusmu akan dihapus. Tindakan ini tidak dapat dibatalkan. Langganan App Store tetap aktif sampai kamu membatalkannya melalui Kelola langganan.")
        }
    }

    private func settingsLabel(_ title: String, detail: String, symbol: String) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol).font(.system(size: 16)).frame(width: 24).foregroundStyle(BisikTheme.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(BisikTheme.font(14)).foregroundStyle(BisikTheme.ink)
                Text(detail).font(BisikTheme.font(11, relativeTo: .caption2)).foregroundStyle(BisikTheme.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        }.padding(.vertical, 4)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(BisikTheme.font(11, semibold: true, relativeTo: .caption2)).textCase(nil)
    }
}

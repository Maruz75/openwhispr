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
            PageTitle(title: L10n.text("Pengaturan"), subtitle: L10n.text("Preferensi aplikasi."))
                .padding(24)
            Form {
                Section {
                    Picker(L10n.text("Bahasa aplikasi"), selection: $model.interfaceLanguage) {
                        Text(L10n.text("Ikuti sistem")).tag("system")
                        Text(L10n.text("Bahasa Indonesia")).tag("id")
                        Text("English").tag("en")
                    }
                    .accessibilityIdentifier("settings.interfaceLanguage")
                    Toggle(isOn: $model.settings.autoCopy) {
                        settingsLabel(L10n.text("Salin otomatis"), detail: L10n.text("Salin hasil saat rekaman selesai."), symbol: "doc.on.doc")
                    }
                    Toggle(isOn: $model.settings.learnCorrections) {
                        settingsLabel(L10n.text("Pelajari koreksi"), detail: L10n.text("Tambahkan koreksi kata ke kamus."), symbol: "sparkle")
                    }
                    Toggle(isOn: $model.settings.haptics) {
                        settingsLabel(L10n.text("Getaran halus"), detail: L10n.text("Umpan balik saat mulai dan selesai."), symbol: "hand.tap")
                    }
                    Toggle(isOn: $model.settings.saveHistory) {
                        settingsLabel(L10n.text("Simpan riwayat"), detail: L10n.text("Simpan tulisan di iPhone ini."), symbol: "clock")
                    }
                    Picker(selection: $model.settings.language) {
                        Text(L10n.text("Bahasa Indonesia")).tag("id-ID")
                        Text("English").tag("en-US")
                        Text(L10n.text("Bahasa Melayu")).tag("ms-MY")
                        Text("日本語").tag("ja-JP")
                        Text("한국어").tag("ko-KR")
                        Text("中文").tag("zh-CN")
                        Text("Español").tag("es-ES")
                    } label: {
                        Label(L10n.text("Bahasa ucapan"), systemImage: "globe")
                    }
                    .font(BisikTheme.font(14))
                    .accessibilityIdentifier("settings.speechLanguage")
                } header: { sectionTitle(L10n.text("PREFERENSI")) }

                Section {
                    Button { model.showPaywall = true } label: {
                        HStack {
                            settingsLabel(L10n.text("Bisik Pro"), detail: L10n.text("Paket langganan transkripsi."), symbol: "sparkles")
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(BisikTheme.secondary)
                        }
                    }
                    Button(L10n.text("Pulihkan pembelian")) { Task { await model.restorePurchases() } }
                        .disabled(model.isPurchasing)
                    Button(L10n.text("Kelola langganan App Store")) { manageSubscriptions = true }
                } header: { sectionTitle(L10n.text("LANGGANAN")) }

                Section {
                    if model.isSignedIn {
                        Label(L10n.text("Terhubung dengan Apple"), systemImage: "checkmark.circle")
                            .foregroundStyle(BisikTheme.accent)
                        Button(L10n.text("Keluar dari akun")) {
                            if model.hasPendingRecording { signOutAlert = true } else { model.signOut() }
                        }
                        Button(role: .destructive) { deleteAccountAlert = true } label: {
                            HStack {
                                Text(L10n.text("Hapus akun & data"))
                                Spacer()
                                if deletingAccount { ProgressView() }
                            }
                        }.disabled(deletingAccount)
                    } else {
                        Button { model.needsSignIn = true } label: {
                            settingsLabel(L10n.text("Masuk dengan Apple"), detail: L10n.text("Untuk kuota dan pembelianmu."), symbol: "apple.logo")
                        }
                    }
                    if let message = model.errorMessage {
                        Text(message).font(BisikTheme.font(12, relativeTo: .caption)).foregroundStyle(BisikTheme.danger)
                    }
                } header: { sectionTitle(L10n.text("AKUN")) }

                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(model.settings.consentGranted ? L10n.text("Pemrosesan suara disetujui") : L10n.text("Pemrosesan suara belum disetujui"), systemImage: "lock.shield")
                            .font(BisikTheme.font(14))
                        Text(AppConfiguration.aiProviderDisclosure)
                            .font(BisikTheme.font(12, relativeTo: .caption))
                            .foregroundStyle(BisikTheme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }.padding(.vertical, 8)
                    if model.settings.consentGranted {
                        Button(L10n.text("Cabut persetujuan pemrosesan")) { revokeConsentAlert = true }
                    } else {
                        Button(L10n.text("Tinjau persetujuan pemrosesan")) { model.needsConsent = true }
                    }
                    if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                        Link(L10n.text("Izin mikrofon & pengenalan suara"), destination: settingsURL)
                    }
                    Button(role: .destructive) { clearHistoryAlert = true } label: {
                        Text(L10n.text("Hapus seluruh riwayat"))
                    }.disabled(model.history.isEmpty)
                    if let privacy = AppConfiguration.privacyURL { Link(L10n.text("Kebijakan privasi"), destination: privacy) }
                    if let terms = AppConfiguration.termsURL { Link(L10n.text("Ketentuan penggunaan"), destination: terms) }
                } header: { sectionTitle(L10n.text("PRIVASI & DATA")) } footer: {
                    Text(L10n.text("Riwayat dan kamus tersimpan di perangkat ini. Rekaman dikirim untuk pemrosesan hanya setelah kamu memberi persetujuan."))
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
        .alert(L10n.text("Hapus seluruh riwayat?"), isPresented: $clearHistoryAlert) {
            Button(L10n.text("Batal"), role: .cancel) { }
            Button(L10n.text("Hapus riwayat"), role: .destructive) { model.clearHistory() }
        } message: {
            Text(L10n.text("Semua tulisan tersimpan akan dihapus dari iPhone ini. Kamusmu tetap tersedia."))
        }
        .alert(L10n.text("Cabut persetujuan?"), isPresented: $revokeConsentAlert) {
            Button(L10n.text("Batal"), role: .cancel) { }
            Button(L10n.text("Cabut persetujuan"), role: .destructive) { model.revokeConsent() }
        } message: {
            Text(L10n.text("Bisik berhenti mengirim rekaman untuk pemrosesan. Rekaman yang sedang berlangsung akan dibatalkan. Kamu dapat menyetujui kembali saat ingin merekam."))
        }
        .alert(L10n.text("Keluar dari akun?"), isPresented: $signOutAlert) {
            Button(L10n.text("Batal"), role: .cancel) { }
            Button(L10n.text("Hapus rekaman & keluar"), role: .destructive) { model.signOut() }
        } message: {
            Text(L10n.text("Rekaman yang belum berhasil diproses akan dihapus saat kamu keluar dari akun."))
        }
        .alert(L10n.text("Hapus akun & data?"), isPresented: $deleteAccountAlert) {
            Button(L10n.text("Batal"), role: .cancel) { }
            Button(L10n.text("Hapus akun"), role: .destructive) {
                deletingAccount = true
                Task {
                    await model.deleteAccount()
                    deletingAccount = false
                }
            }
        } message: {
            Text(L10n.text("Akun, riwayat, dan kamusmu akan dihapus. Tindakan ini tidak dapat dibatalkan. Langganan App Store tetap aktif sampai kamu membatalkannya melalui Kelola langganan."))
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

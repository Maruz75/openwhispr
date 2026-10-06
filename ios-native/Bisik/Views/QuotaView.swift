import SwiftUI

struct QuotaView: View {
    @EnvironmentObject private var model: AppModel
    @State private var refreshing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageTitle(title: "Paket & kuota", subtitle: "Penggunaan transkripsi bulanan.")
                if let quota = model.quota {
                    usageCard(quota)
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(model.isSignedIn ? "Kuota belum tersedia" : "Paket Free")
                            .font(BisikTheme.font(20, semibold: true, relativeTo: .title2))
                        Text(model.isSignedIn ? "Perbarui untuk melihat paket dan sisa kuotamu." : "\(AppConfiguration.freeMinutes) menit gratis setiap bulan. Masuk untuk melihat penggunaan dan sisa kuota.")
                            .font(BisikTheme.font(14))
                            .foregroundStyle(BisikTheme.secondary)
                            .lineSpacing(4)
                        if !model.isSignedIn {
                            Button("Masuk dengan Apple") { model.needsSignIn = true }
                                .buttonStyle(BisikButtonStyle(primary: false))
                                .accessibilityIdentifier("quota.signIn")
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 22))
                }

                if model.isSignedIn {
                    Button {
                        Task { await refresh() }
                    } label: {
                        HStack(spacing: 12) {
                            if refreshing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                            Text(refreshing ? "Memperbarui…" : "Perbarui kuota")
                        }
                    }
                    .buttonStyle(BisikButtonStyle(primary: false))
                    .disabled(refreshing)
                    .opacity(refreshing ? 0.5 : 1)
                    .accessibilityIdentifier("quota.refresh")
                }
                if let message = model.errorMessage {
                    Label(message, systemImage: "exclamationmark.circle")
                        .font(BisikTheme.font(13))
                        .foregroundStyle(BisikTheme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 16) {
                    Text(model.quota?.plan == "pro" ? "Bisik Pro" : "Butuh lebih banyak menit?")
                        .font(BisikTheme.font(20, semibold: true, relativeTo: .title2))
                    Text("Bisik Pro menyediakan \(AppConfiguration.proMinutes) menit transkripsi per bulan. Riwayat, kamus, dan fitur edit tersedia pada semua paket.")
                        .font(BisikTheme.font(14))
                        .foregroundStyle(BisikTheme.secondary)
                        .lineSpacing(4)
                    Button(model.quota?.plan == "pro" ? "Kelola langganan" : "Lihat langganan") {
                        model.showPaywall = true
                    }
                    .buttonStyle(BisikButtonStyle())
                    .accessibilityIdentifier("quota.openPaywall")
                }
                Text("Kuota diperbarui setiap bulan dan tidak diakumulasi. Paket Free mendapat \(AppConfiguration.freeMinutes) menit gratis per bulan.")
                    .font(BisikTheme.font(12, relativeTo: .caption))
                    .foregroundStyle(BisikTheme.secondary)
                    .lineSpacing(4)
            }
            .padding(24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .foregroundStyle(BisikTheme.ink)
        .background(Color.white)
        .refreshable { await refresh() }
        .task { if model.isSignedIn { await refresh() } }
    }

    private func usageCard(_ quota: UsageQuota) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(quota.plan == "pro" ? "Bisik Pro" : "Paket Free")
                        .font(BisikTheme.font(20, semibold: true, relativeTo: .title2))
                    Text("\(BisikTheme.minutes(quota.limitSeconds)) per bulan")
                        .font(BisikTheme.font(13))
                        .foregroundStyle(BisikTheme.secondary)
                }
                Spacer()
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Sisa kuota").font(BisikTheme.font(12, relativeTo: .caption)).foregroundStyle(BisikTheme.secondary)
                Text(BisikTheme.minutes(quota.remainingSeconds))
                    .font(BisikTheme.font(24, semibold: true, relativeTo: .title))
                    .monospacedDigit()
            }
            VStack(alignment: .leading, spacing: 12) {
                ProgressView(value: quota.progress)
                    .tint(BisikTheme.accent)
                    .accessibilityLabel("Kuota terpakai")
                    .accessibilityValue("\(BisikTheme.minutes(quota.usedSeconds)) dari \(BisikTheme.minutes(quota.limitSeconds))")
                HStack {
                    Text("Terpakai")
                    Spacer()
                    Text("\(BisikTheme.minutes(quota.usedSeconds)) / \(BisikTheme.minutes(quota.limitSeconds))").monospacedDigit()
                }
                .font(BisikTheme.font(12, relativeTo: .caption))
                .foregroundStyle(BisikTheme.secondary)
            }
            Divider().overlay(BisikTheme.line)
            HStack(alignment: .top) {
                Text("Diperbarui")
                Spacer()
                Text(quota.resetAt.formatted(.dateTime.day().month(.wide).year().locale(Locale(identifier: "id_ID"))))
                    .multilineTextAlignment(.trailing)
            }
            .font(BisikTheme.font(12, relativeTo: .caption))
            .foregroundStyle(BisikTheme.secondary)
        }
        .padding(20)
        .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 22))
    }

    private func refresh() async {
        guard model.isSignedIn, !refreshing else { return }
        refreshing = true
        await model.refreshQuota()
        refreshing = false
    }
}

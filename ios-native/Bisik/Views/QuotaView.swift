import SwiftUI

struct QuotaView: View {
    @EnvironmentObject private var model: AppModel
    @State private var refreshing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageTitle(title: L10n.text("Paket & kuota"), subtitle: L10n.text("Penggunaan transkripsi bulanan."))
                if let quota = model.quota {
                    usageCard(quota)
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(model.isSignedIn ? L10n.text("Kuota belum tersedia") : L10n.text("Paket Free"))
                            .font(BisikTheme.font(20, semibold: true, relativeTo: .title2))
                        Text(model.isSignedIn ? L10n.text("Perbarui untuk melihat paket dan sisa kuotamu.") : L10n.format("%@ menit gratis setiap bulan. Masuk untuk melihat penggunaan dan sisa kuota.", AppConfiguration.freeMinutes))
                            .font(BisikTheme.font(14))
                            .foregroundStyle(BisikTheme.secondary)
                            .lineSpacing(4)
                        if !model.isSignedIn {
                            Button(L10n.text("Masuk dengan Apple")) { model.needsSignIn = true }
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
                            Text(refreshing ? L10n.text("Memperbarui…") : L10n.text("Perbarui kuota"))
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
                    Text(model.quota?.plan == "pro" ? L10n.text("Bisik Pro") : L10n.text("Butuh lebih banyak menit?"))
                        .font(BisikTheme.font(20, semibold: true, relativeTo: .title2))
                    Text(L10n.format("Bisik Pro menyediakan %@ menit transkripsi per bulan. Riwayat, kamus, dan fitur edit tersedia pada semua paket.", AppConfiguration.proMinutes))
                        .font(BisikTheme.font(14))
                        .foregroundStyle(BisikTheme.secondary)
                        .lineSpacing(4)
                    Button(model.quota?.plan == "pro" ? L10n.text("Kelola langganan") : L10n.text("Lihat langganan")) {
                        model.showPaywall = true
                    }
                    .buttonStyle(BisikButtonStyle())
                    .accessibilityIdentifier("quota.openPaywall")
                }
                Text(L10n.format("Kuota diperbarui setiap bulan dan tidak diakumulasi. Paket Free mendapat %@ menit gratis per bulan.", AppConfiguration.freeMinutes))
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
                    Text(quota.plan == "pro" ? L10n.text("Bisik Pro") : L10n.text("Paket Free"))
                        .font(BisikTheme.font(20, semibold: true, relativeTo: .title2))
                    Text(L10n.format("%@ per bulan", BisikTheme.minutes(quota.limitSeconds)))
                        .font(BisikTheme.font(13))
                        .foregroundStyle(BisikTheme.secondary)
                }
                Spacer()
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.text("Sisa kuota")).font(BisikTheme.font(12, relativeTo: .caption)).foregroundStyle(BisikTheme.secondary)
                Text(BisikTheme.minutes(quota.remainingSeconds))
                    .font(BisikTheme.font(24, semibold: true, relativeTo: .title))
                    .monospacedDigit()
            }
            VStack(alignment: .leading, spacing: 12) {
                ProgressView(value: quota.progress)
                    .tint(BisikTheme.accent)
                    .accessibilityLabel(L10n.text("Kuota terpakai"))
                    .accessibilityValue(L10n.format("%@ dari %@", BisikTheme.minutes(quota.usedSeconds), BisikTheme.minutes(quota.limitSeconds)))
                HStack {
                    Text(L10n.text("Terpakai"))
                    Spacer()
                    Text("\(BisikTheme.minutes(quota.usedSeconds)) / \(BisikTheme.minutes(quota.limitSeconds))").monospacedDigit()
                }
                .font(BisikTheme.font(12, relativeTo: .caption))
                .foregroundStyle(BisikTheme.secondary)
            }
            Divider().overlay(BisikTheme.line)
            HStack(alignment: .top) {
                Text(L10n.text("Diperbarui"))
                Spacer()
                Text(quota.resetAt.formatted(.dateTime.day().month(.wide).year().locale(L10n.locale)))
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

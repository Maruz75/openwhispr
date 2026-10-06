import SwiftUI

struct HistoryView: View {
    @EnvironmentObject private var model: AppModel
    let onOpen: () -> Void
    @State private var search = ""
    @State private var deleting: TranscriptRecord?
    @State private var pendingOpen: TranscriptRecord?

    private var filtered: [TranscriptRecord] {
        model.history.filter { search.isEmpty || $0.text.localizedCaseInsensitiveContains(search) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: L10n.text("Riwayat"), subtitle: L10n.text("Tulisan yang tersimpan."))
                .padding(24)
            if model.history.isEmpty {
                EmptyState(symbol: "clock", title: L10n.text("Belum ada riwayat"), message: model.settings.saveHistory ? L10n.text("Hasil transkripsi tersimpan di sini.") : L10n.text("Penyimpanan riwayat sedang nonaktif. Aktifkan di Pengaturan untuk menyimpan hasil baru."))
            } else if filtered.isEmpty {
                EmptyState(symbol: "magnifyingglass", title: L10n.text("Belum ditemukan"), message: L10n.text("Coba cari dengan kata lain."))
            } else {
                List {
                    Section {
                        ForEach(filtered) { record in
                            Button {
                                open(record)
                            } label: {
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack {
                                        Text(record.createdAt.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(L10n.locale)))
                                        Spacer()
                                        Text(BisikTheme.duration(record.durationSeconds)).monospacedDigit()
                                    }
                                    .font(BisikTheme.font(11, relativeTo: .caption2))
                                    .foregroundStyle(BisikTheme.secondary)
                                    Text(record.text)
                                        .font(BisikTheme.font(15))
                                        .foregroundStyle(BisikTheme.ink)
                                        .lineLimit(4)
                                        .lineSpacing(4)
                                    HStack(spacing: 4) {
                                        Text(L10n.text("Buka & edit"))
                                        Image(systemName: "arrow.up.right")
                                    }
                                    .font(BisikTheme.font(11, semibold: true, relativeTo: .caption2))
                                    .foregroundStyle(BisikTheme.accent)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 12)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint(L10n.text("Membuka tulisan di halaman Rekam untuk diedit atau disalin."))
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) { deleting = record } label: {
                                    Label(L10n.text("Hapus"), systemImage: "trash")
                                }
                            }
                            .contextMenu {
                                Button {
                                    open(record)
                                } label: { Label(L10n.text("Buka & edit"), systemImage: "square.and.pencil") }
                                Button(role: .destructive) { deleting = record } label: {
                                    Label(L10n.text("Hapus"), systemImage: "trash")
                                }
                            }
                            .listRowBackground(Color.white)
                            .listRowSeparatorTint(BisikTheme.line)
                        }
                    } header: {
                        Text(filtered.count == 1 ? L10n.text("1 tulisan") : L10n.format("%@ tulisan", filtered.count))
                            .font(BisikTheme.font(11, semibold: true, relativeTo: .caption2))
                            .textCase(nil)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color.white)
        .searchable(text: $search, prompt: L10n.text("Cari dalam riwayat"))
        .alert(L10n.text("Hapus tulisan ini?"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button(L10n.text("Batal"), role: .cancel) { deleting = nil }
            Button(L10n.text("Hapus"), role: .destructive) {
                if let deleting { model.deleteHistory(deleting.id) }
                deleting = nil
            }
        } message: {
            Text(L10n.text("Tulisan akan dihapus dari riwayat di iPhone ini."))
        }
        .alert(L10n.text("Buka tulisan lain?"), isPresented: Binding(get: { pendingOpen != nil }, set: { if !$0 { pendingOpen = nil } })) {
            Button(L10n.text("Batal"), role: .cancel) { pendingOpen = nil }
            Button(L10n.text("Hapus rekaman & buka"), role: .destructive) {
                if let record = pendingOpen {
                    model.openHistory(record)
                    onOpen()
                }
                pendingOpen = nil
            }
        } message: {
            Text(L10n.text("Rekaman yang belum berhasil diproses akan dihapus saat membuka tulisan lain."))
        }
    }

    private func open(_ record: TranscriptRecord) {
        guard model.phase == .idle else { return }
        if model.hasPendingRecording {
            pendingOpen = record
        } else {
            model.commitEdits()
            model.openHistory(record)
            onOpen()
        }
    }
}

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
            PageTitle(title: "Riwayat", subtitle: "Tulisan yang tersimpan.")
                .padding(24)
            if model.history.isEmpty {
                EmptyState(symbol: "clock", title: "Belum ada riwayat", message: model.settings.saveHistory ? "Hasil transkripsi tersimpan di sini." : "Penyimpanan riwayat sedang nonaktif. Aktifkan di Pengaturan untuk menyimpan hasil baru.")
            } else if filtered.isEmpty {
                EmptyState(symbol: "magnifyingglass", title: "Belum ditemukan", message: "Coba cari dengan kata lain.")
            } else {
                List {
                    Section {
                        ForEach(filtered) { record in
                            Button {
                                open(record)
                            } label: {
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack {
                                        Text(record.createdAt.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(Locale(identifier: "id_ID"))))
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
                                        Text("Buka & edit")
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
                            .accessibilityHint("Membuka tulisan di halaman Rekam untuk diedit atau disalin.")
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) { deleting = record } label: {
                                    Label("Hapus", systemImage: "trash")
                                }
                            }
                            .contextMenu {
                                Button {
                                    open(record)
                                } label: { Label("Buka & edit", systemImage: "square.and.pencil") }
                                Button(role: .destructive) { deleting = record } label: {
                                    Label("Hapus", systemImage: "trash")
                                }
                            }
                            .listRowBackground(Color.white)
                            .listRowSeparatorTint(BisikTheme.line)
                        }
                    } header: {
                        Text("\(filtered.count) tulisan")
                            .font(BisikTheme.font(11, semibold: true, relativeTo: .caption2))
                            .textCase(nil)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color.white)
        .searchable(text: $search, prompt: "Cari dalam riwayat")
        .alert("Hapus tulisan ini?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Batal", role: .cancel) { deleting = nil }
            Button("Hapus", role: .destructive) {
                if let deleting { model.deleteHistory(deleting.id) }
                deleting = nil
            }
        } message: {
            Text("Tulisan akan dihapus dari riwayat di iPhone ini.")
        }
        .alert("Buka tulisan lain?", isPresented: Binding(get: { pendingOpen != nil }, set: { if !$0 { pendingOpen = nil } })) {
            Button("Batal", role: .cancel) { pendingOpen = nil }
            Button("Hapus rekaman & buka", role: .destructive) {
                if let record = pendingOpen {
                    model.openHistory(record)
                    onOpen()
                }
                pendingOpen = nil
            }
        } message: {
            Text("Rekaman yang belum berhasil diproses akan dihapus saat membuka tulisan lain.")
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

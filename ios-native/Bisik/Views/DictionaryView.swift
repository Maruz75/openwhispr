import SwiftUI

struct DictionaryView: View {
    @EnvironmentObject private var model: AppModel
    @State private var search = ""
    @State private var showEditor = false
    @State private var editingEntry: DictionaryEntry?
    @State private var deleting: DictionaryEntry?

    private var entries: [DictionaryEntry] {
        model.dictionary.filter {
            search.isEmpty || $0.source.localizedCaseInsensitiveContains(search) || $0.replacement.localizedCaseInsensitiveContains(search)
        }.sorted { $0.replacement.localizedCaseInsensitiveCompare($1.replacement) == .orderedAscending }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 16) {
                PageTitle(title: "Kamus", subtitle: "Koreksi ejaan.")
                IconControl(symbol: "plus", label: "Tambah kata ke kamus", highlighted: true) {
                    editingEntry = nil
                    showEditor = true
                }
            }.padding(24)
            VStack(alignment: .leading, spacing: 8) {
                Label("Belajar dari koreksimu", systemImage: "sparkle")
                    .font(BisikTheme.font(13, semibold: true))
                    .foregroundStyle(BisikTheme.ink)
                Text(model.settings.learnCorrections ? "Koreksi kata di tulisanmu akan dipelajari otomatis. Kamu tetap bisa mengedit atau menghapusnya." : "Pembelajaran otomatis sedang nonaktif. Kamu bisa menambahkan kata secara manual.")
                    .font(BisikTheme.font(12, relativeTo: .caption))
                    .foregroundStyle(BisikTheme.secondary)
                    .lineSpacing(4)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 18))
            .padding(.horizontal, 24)
            .padding(.bottom, 16)

            if model.dictionary.isEmpty {
                EmptyState(symbol: "character.book.closed", title: "Kamus masih kosong", message: "Tambahkan ejaan atau edit hasil transkripsi untuk mempelajari koreksi.")
            } else if entries.isEmpty {
                EmptyState(symbol: "magnifyingglass", title: "Kata belum ditemukan", message: "Cari ejaan awal atau ejaan yang benar.")
            } else {
                List(entries) { entry in
                    Button {
                        editingEntry = entry
                        showEditor = true
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 8) {
                                Text(entry.source)
                                    .foregroundStyle(BisikTheme.secondary)
                                Image(systemName: "arrow.right")
                                    .font(.system(size: 11))
                                    .foregroundStyle(BisikTheme.secondary)
                                Text(entry.replacement)
                                    .foregroundStyle(BisikTheme.ink)
                                    .font(BisikTheme.font(15, semibold: true))
                            }
                            .font(BisikTheme.font(15))
                            .fixedSize(horizontal: false, vertical: true)
                            Label(entry.learned ? "Dipelajari dari koreksi" : "Ditambahkan olehmu", systemImage: entry.learned ? "sparkle" : "pencil")
                                .font(BisikTheme.font(11, relativeTo: .caption2))
                                .foregroundStyle(entry.learned ? BisikTheme.accent : BisikTheme.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(entry.source), menjadi \(entry.replacement)")
                    .accessibilityHint("Ketuk untuk mengedit.")
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) { deleting = entry } label: {
                            Label("Hapus", systemImage: "trash")
                        }
                    }
                    .listRowBackground(Color.white)
                    .listRowSeparatorTint(BisikTheme.line)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color.white)
        .searchable(text: $search, prompt: "Cari kata di kamus")
        .sheet(isPresented: $showEditor) {
            DictionaryEditor(entry: editingEntry).environmentObject(model)
        }
        .alert("Hapus kata ini?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Batal", role: .cancel) { deleting = nil }
            Button("Hapus", role: .destructive) {
                if let deleting { model.deleteDictionary(deleting.id) }
                deleting = nil
            }
        } message: {
            Text("Koreksi ini tidak lagi digunakan pada rekaman berikutnya.")
        }
    }
}

private struct DictionaryEditor: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let entry: DictionaryEntry?
    @State private var source: String
    @State private var replacement: String
    private enum Field: Hashable { case source, replacement }
    @FocusState private var focusedField: Field?

    init(entry: DictionaryEntry?) {
        self.entry = entry
        _source = State(initialValue: entry?.source ?? "")
        _replacement = State(initialValue: entry?.replacement ?? "")
    }

    private var valid: Bool {
        let first = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let second = replacement.trimmingCharacters(in: .whitespacesAndNewlines)
        return !first.isEmpty && !second.isEmpty && first != second && first.count <= 80 && second.count <= 80
            && first.rangeOfCharacter(from: .controlCharacters) == nil && second.rangeOfCharacter(from: .controlCharacters) == nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    PageTitle(title: entry == nil ? "Tambah kata" : "Edit kata", subtitle: "Masukkan ejaan awal dan penggantinya.")
                    VStack(alignment: .leading, spacing: 12) {
                        Text("YANG BIASA TERDENGAR").font(BisikTheme.font(11, semibold: true, relativeTo: .caption2)).foregroundStyle(BisikTheme.secondary)
                        TextField("Ejaan yang kurang tepat", text: $source)
                            .focused($focusedField, equals: .source)
                            .font(BisikTheme.font(16))
                            .padding(16)
                            .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 18))
                            .overlay(RoundedRectangle(cornerRadius: 18).stroke(focusedField == .source ? BisikTheme.focus : BisikTheme.line, lineWidth: focusedField == .source ? 2 : 1))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .accessibilityLabel("Ejaan awal")
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("GANTI MENJADI").font(BisikTheme.font(11, semibold: true, relativeTo: .caption2)).foregroundStyle(BisikTheme.secondary)
                        TextField("Ejaan yang benar", text: $replacement)
                            .focused($focusedField, equals: .replacement)
                            .font(BisikTheme.font(16))
                            .padding(16)
                            .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 18))
                            .overlay(RoundedRectangle(cornerRadius: 18).stroke(focusedField == .replacement ? BisikTheme.focus : BisikTheme.line, lineWidth: focusedField == .replacement ? 2 : 1))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .accessibilityLabel("Ejaan pengganti")
                    }
                    Text("Kata ini akan digunakan pada hasil transkripsi berikutnya. Maksimal 80 karakter untuk setiap ejaan.")
                        .font(BisikTheme.font(12, relativeTo: .caption))
                        .foregroundStyle(BisikTheme.secondary)
                        .lineSpacing(4)
                    Button("Simpan kata") {
                        if let entry { model.deleteDictionary(entry.id) }
                        model.addDictionary(source: source.trimmingCharacters(in: .whitespacesAndNewlines), replacement: replacement.trimmingCharacters(in: .whitespacesAndNewlines))
                        dismiss()
                    }
                    .buttonStyle(BisikButtonStyle())
                    .disabled(!valid)
                    .opacity(valid ? 1 : 0.5)
                }
                .padding(24)
            }
            .background(Color.white)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Batal") { dismiss() }.foregroundStyle(BisikTheme.secondary)
                }
            }
            .task { if entry == nil { focusedField = .source } }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

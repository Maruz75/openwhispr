import SwiftUI

struct RecorderView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var editing: Bool
    @State private var holding = false
    @State private var discardPendingAlert = false
    @State private var discardAndStartNew = false

    private var idle: Bool { model.phase == .idle }
    private var editable: Bool { idle && !model.hasPendingRecording }
    private var recording: Bool { model.phase == .recording }
    private var busy: Bool { model.phase == .preparing || model.phase == .processing }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header
                        transcriptCard(editorHeight: min(220, max(160, geometry.size.height * 0.30)))
                        if model.learnedCount > 0 {
                            Label("\(model.learnedCount) koreksi dipelajari di Kamus", systemImage: "sparkle")
                                .font(BisikTheme.font(12, relativeTo: .caption))
                                .foregroundStyle(BisikTheme.accent)
                                .transition(.opacity)
                        }
                        if let message = model.errorMessage {
                            errorCard(message)
                        }
                        quotaCard
                    }
                    .padding(24)
                    .frame(maxWidth: 640)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .background(Color.white)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                // Recording remains reachable when the editor or an error grows.
                // Hiding the footer during editing leaves room for the keyboard.
                if !editing {
                    recordingArea
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .frame(maxWidth: .infinity)
                        .background(Color.white)
                        .overlay(alignment: .top) {
                            Rectangle().fill(BisikTheme.line.opacity(0.6)).frame(height: 1)
                        }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Selesai") {
                        model.commitEdits()
                        editing = false
                    }.font(BisikTheme.font(14, semibold: true))
                }
            }
            .onChange(of: editing) { wasEditing, isEditing in
                if wasEditing && !isEditing { model.commitEdits() }
            }
            .onChange(of: model.phase) { _, phase in
                if phase == .processing || phase == .idle { holding = false }
            }
            .onChange(of: model.needsConsent) { _, presented in if presented { holding = false } }
            .onChange(of: model.needsSignIn) { _, presented in if presented { holding = false } }
            .onChange(of: model.showPaywall) { _, presented in if presented { holding = false } }
            .onChange(of: model.errorMessage) { _, message in
                if message != nil && idle { holding = false }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active && (holding || model.phase == .recording || model.phase == .preparing) {
                    holding = false
                    model.cancelRecording()
                }
            }
            .onDisappear {
                if holding || model.phase == .recording || model.phase == .preparing {
                    holding = false
                    model.cancelRecording()
                }
                if editing { model.commitEdits() }
            }
            .alert("Hapus rekaman ini?", isPresented: $discardPendingAlert) {
                Button("Batal", role: .cancel) { discardAndStartNew = false }
                Button("Hapus rekaman", role: .destructive) {
                    model.cancelRecording()
                    if discardAndStartNew { model.newDraft() }
                    discardAndStartNew = false
                }
            } message: {
                Text("Rekaman yang belum berhasil diproses akan dihapus. Kamu perlu merekam ulang untuk mencoba kembali.")
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "waveform")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(BisikTheme.accent)
                    Text("bisik").font(BisikTheme.font(24, semibold: true, relativeTo: .title))
                }
                Text("Pikiranmu, menjadi tulisan.")
                    .font(BisikTheme.font())
                    .foregroundStyle(BisikTheme.secondary)
            }
            Spacer()
            Button {
                editing = false
                model.commitEdits()
                if model.hasPendingRecording {
                    discardAndStartNew = true
                    discardPendingAlert = true
                } else {
                    model.newDraft()
                }
            } label: {
                Label("Baru", systemImage: "plus")
                    .font(BisikTheme.font(12, semibold: true, relativeTo: .caption))
                    .frame(minHeight: 44)
                    .padding(.horizontal, 12)
                    .background(BisikTheme.panel, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!idle)
            .opacity(idle ? 1 : 0.5)
            .accessibilityLabel("Buat tulisan baru")
        }
        .foregroundStyle(BisikTheme.ink)
    }

    private func transcriptCard(editorHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                HStack(spacing: 8) {
                    Circle().fill(recording ? BisikTheme.accent : BisikTheme.secondary.opacity(0.35))
                        .frame(width: 6, height: 6)
                    Text(recording ? "MENDENGARKAN" : model.hasPendingRecording ? "PRATINJAU" : "TULISANMU")
                        .font(BisikTheme.font(11, semibold: true, relativeTo: .caption2))
                        .foregroundStyle(BisikTheme.secondary)
                }
                Spacer()
                IconControl(symbol: editing ? "keyboard.chevron.compact.down" : "keyboard", label: editing ? "Tutup keyboard" : "Edit tulisan dengan keyboard", highlighted: editing, disabled: !editable) {
                    editing.toggle()
                }
                IconControl(symbol: model.copied ? "checkmark" : "doc.on.doc", label: model.copied ? "Tulisan tersalin" : "Salin tulisan", highlighted: model.copied, disabled: model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !editable) {
                    model.commitEdits()
                    model.copyText()
                }
            }
            ZStack(alignment: .topLeading) {
                if model.text.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Mulai dari satu kata.")
                            .font(BisikTheme.font(24, semibold: true, relativeTo: .title))
                            .foregroundStyle(BisikTheme.ink)
                        Text("Tahan mikrofon dan bicaralah.\nTulisan akan muncul di sini.")
                            .font(BisikTheme.font(16))
                            .foregroundStyle(BisikTheme.secondary)
                            .lineSpacing(6)
                    }
                    .padding(.top, 8)
                    .padding(.leading, 4)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
                TextEditor(text: $model.text)
                    .font(BisikTheme.font(18))
                    .lineSpacing(6)
                    .foregroundStyle(BisikTheme.ink)
                    .scrollContentBackground(.hidden)
                    .focused($editing)
                    .disabled(!editable)
                    .frame(height: editorHeight)
                    .accessibilityLabel("Hasil transkripsi, dapat diedit")
                    .accessibilityHint("Gunakan tombol keyboard untuk mengoreksi tulisan.")
            }
            HStack(spacing: 8) {
                Image(systemName: model.settings.autoCopy ? "checkmark.circle" : "doc.on.doc")
                Text(model.hasPendingRecording ? "Pratinjau belum final. Coba proses kembali." : model.settings.autoCopy ? "Tersalin otomatis setelah selesai" : "Ketuk ikon salin untuk menyalin")
            }
            .font(BisikTheme.font(11, relativeTo: .caption2))
            .foregroundStyle(BisikTheme.secondary)
            .padding(.top, 8)
        }
        .padding(16)
        .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(editing ? BisikTheme.focus : BisikTheme.line, lineWidth: editing ? 2 : 1))
    }

    private var recordingArea: some View {
        VStack(spacing: 8) {
            LiveWaveform(levels: model.levels, active: recording)
                .frame(height: 24)
                .accessibilityHidden(true)
            VStack(spacing: 4) {
                Text(statusTitle)
                    .font(BisikTheme.font(14, semibold: true))
                    .foregroundStyle(BisikTheme.ink)
                    .accessibilityAddTraits(.updatesFrequently)
                Text(recording ? BisikTheme.duration(model.elapsedSeconds) : statusDetail)
                    .font(BisikTheme.font(12, relativeTo: .caption))
                    .monospacedDigit()
                    .foregroundStyle(BisikTheme.secondary)
            }
            .multilineTextAlignment(.center)
            Group {
                if voiceOver {
                    Button {
                        toggleAccessibleRecording()
                    } label: { microphone }
                        .buttonStyle(.plain)
                        .disabled(model.phase == .processing || model.hasPendingRecording)
                } else {
                    microphone
                        .contentShape(Circle())
                        .gesture(DragGesture(minimumDistance: 0)
                            .onChanged { _ in
                                guard !holding, model.phase != .processing, !model.hasPendingRecording else { return }
                                holding = true
                                editing = false
                                model.commitEdits()
                                Task {
                                    guard holding else { return }
                                    await model.beginHold()
                                }
                            }
                            .onEnded { _ in
                                guard holding else { return }
                                holding = false
                                Task { await model.endHold() }
                            })
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { toggleAccessibleRecording() }
                }
            }
            .accessibilityLabel(recording ? "Hentikan rekaman" : "Mulai rekaman")
            .accessibilityHint(voiceOver ? "Ketuk dua kali untuk mulai atau berhenti." : "Tahan untuk berbicara, lepaskan untuk selesai.")
            if recording || model.phase == .preparing {
                Button("Batalkan rekaman") {
                    holding = false
                    model.cancelRecording()
                }
                .font(BisikTheme.font(12, relativeTo: .caption))
                .foregroundStyle(BisikTheme.secondary)
                .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var microphone: some View {
        ZStack {
            Circle().fill(BisikTheme.accent.opacity(0.08))
                .frame(width: 92, height: 92)
                .scaleEffect(recording && !reduceMotion ? 1.08 : 1)
                .opacity(recording ? 1 : 0)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: recording)
            Circle().fill(recording ? BisikTheme.accent : BisikTheme.ink)
                .frame(width: 76, height: 76)
            if busy {
                ProgressView().tint(.white).accessibilityLabel("Memproses")
            } else {
                Image(systemName: recording && voiceOver ? "stop.fill" : "mic.fill")
                    .font(.system(size: 28, weight: .regular))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 100, height: 100)
        .scaleEffect(holding && !reduceMotion ? 0.96 : 1)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: holding)
        .opacity(model.phase == .processing ? 0.7 : 1)
    }

    private var quotaCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.quota?.plan == "pro" ? "Bisik Pro" : "Ruang untuk bicara")
                        .font(BisikTheme.font(12, semibold: true, relativeTo: .caption))
                        .foregroundStyle(BisikTheme.ink)
                    if let quota = model.quota {
                        Text("\(BisikTheme.minutes(quota.remainingSeconds)) tersisa bulan ini")
                            .font(BisikTheme.font(11, relativeTo: .caption2))
                            .foregroundStyle(BisikTheme.secondary)
                    } else {
                        Text("\(AppConfiguration.freeMinutes) menit gratis setiap bulan")
                            .font(BisikTheme.font(11, relativeTo: .caption2))
                            .foregroundStyle(BisikTheme.secondary)
                    }
                }
                Spacer()
                Button {
                    model.showPaywall = true
                } label: {
                    Text(model.quota?.plan == "pro" ? "Langganan" : "Lihat Pro")
                        .font(BisikTheme.font(12, semibold: true, relativeTo: .caption))
                        .foregroundStyle(BisikTheme.accent)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
            if let quota = model.quota {
                ProgressView(value: min(max(quota.progress, 0), 1))
                    .tint(BisikTheme.accent)
                    .accessibilityLabel("Kuota terpakai")
                    .accessibilityValue("\(BisikTheme.minutes(quota.usedSeconds)) dari \(BisikTheme.minutes(quota.limitSeconds))")
            }
        }
        .padding(16)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(BisikTheme.line, lineWidth: 1))
    }

    private func errorCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(message, systemImage: "exclamationmark.circle")
                .font(BisikTheme.font(13))
                .foregroundStyle(BisikTheme.danger)
                .fixedSize(horizontal: false, vertical: true)
            if model.hasPendingRecording {
                HStack {
                    Button("Coba lagi") { Task { await model.retryTranscription() } }
                        .font(BisikTheme.font(13, semibold: true))
                        .foregroundStyle(BisikTheme.ink)
                        .frame(minHeight: 44)
                        .disabled(!idle)
                    Spacer()
                    Button("Hapus rekaman") {
                        discardAndStartNew = false
                        discardPendingAlert = true
                    }
                        .font(BisikTheme.font(13))
                        .foregroundStyle(BisikTheme.secondary)
                        .frame(minHeight: 44)
                }
            }
        }
        .padding(16)
        .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .contain)
    }

    private var statusTitle: String {
        switch model.phase {
        case .idle: return model.hasPendingRecording ? "Rekaman perlu diproses kembali" : "Tahan untuk berbicara"
        case .preparing: return "Menyiapkan mikrofon…"
        case .recording: return "Lepaskan untuk selesai"
        case .processing: return "Merapikan tulisanmu…"
        }
    }

    private var statusDetail: String {
        switch model.phase {
        case .idle: return "Maksimal 5 menit per rekaman."
        case .preparing: return "Rekaman dimulai saat mikrofon siap."
        case .recording: return ""
        case .processing: return "Hasil akan siap untuk ditempel."
        }
    }

    private func toggleAccessibleRecording() {
        editing = false
        if model.phase == .recording || model.phase == .preparing {
            Task { await model.endHold() }
        } else if editable {
            model.commitEdits()
            Task { await model.beginHold() }
        }
    }
}

private struct LiveWaveform: View {
    let levels: [CGFloat]
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<32, id: \.self) { index in
                Capsule()
                    .fill(BisikTheme.accent)
                    .opacity(active ? 1 : 0.25)
                    .frame(width: 4, height: 24)
                    .scaleEffect(x: 1, y: barScale(index), anchor: .center)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: levels)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: active)
            }
        }
    }

    private func barScale(_ index: Int) -> CGFloat {
        guard active else { return 0.12 }
        let sample = levels.indices.contains(index) ? levels[index] : 0
        return min(1, max(0.12, sample))
    }
}

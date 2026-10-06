import SwiftUI

struct RecorderView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var editing: Bool
    @State private var holding = false
    @State private var discardPendingAlert = false

    private var idle: Bool { model.phase == .idle }
    private var editable: Bool { idle && !model.hasPendingRecording }
    private var recording: Bool { model.phase == .recording }

    var body: some View {
        VStack(spacing: 16) {
            transcriptCard
            if let message = model.errorMessage {
                errorCard(message)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // Recording remains reachable when the editor or an error grows.
            // Hiding the footer during editing leaves room for the keyboard.
            if !editing {
                recordingArea
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 20)
                    .frame(maxWidth: .infinity)
                    .background(Color.white)
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button {
                    editing = false
                } label: {
                    Image(systemName: "checkmark")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(L10n.text("Selesai mengedit"))
                .accessibilityIdentifier("transcript.done")
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
            model.commitEdits()
        }
        .alert(L10n.text("Hapus rekaman ini?"), isPresented: $discardPendingAlert) {
            Button(L10n.text("Batal"), role: .cancel) { }
            Button(L10n.text("Hapus rekaman"), role: .destructive) {
                model.cancelRecording()
            }
        } message: {
            Text(L10n.text("Rekaman yang belum berhasil diproses akan dihapus."))
        }
    }

    private var transcriptCard: some View {
        VStack(spacing: 0) {
            // Native selection places the caret at the tapped word. No gesture
            // overlay interferes with scrolling, selection, or keyboard focus.
            TextEditor(text: $model.text)
                .font(BisikTheme.font(18))
                .lineSpacing(6)
                .foregroundStyle(BisikTheme.ink)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.interactively)
                .focused($editing)
                .disabled(!editable)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(L10n.text("Hasil transkripsi"))
                .accessibilityHint(L10n.text("Ketuk tulisan untuk menempatkan kursor dan mengedit."))
                .accessibilityIdentifier("transcript.editor")
            HStack {
                Spacer()
                IconControl(symbol: model.copied ? "checkmark" : "doc.on.doc.fill", label: model.copied ? L10n.text("Tulisan tersalin") : L10n.text("Salin tulisan"), highlighted: model.copied, prominent: true, disabled: model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !editable) {
                    model.commitEdits()
                    model.copyText()
                }
                .accessibilityIdentifier("transcript.copy")
            }
        }
        .padding(12)
        .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(editing ? BisikTheme.focus : BisikTheme.line, lineWidth: editing ? 2 : 1))
    }

    private var recordingArea: some View {
        VStack(spacing: 20) {
            ZStack(alignment: .trailing) {
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
                .frame(maxWidth: .infinity)
                .accessibilityLabel(recording ? L10n.text("Hentikan rekaman") : L10n.text("Mulai rekaman"))
                .accessibilityHint(voiceOver ? L10n.text("Ketuk dua kali untuk mulai atau berhenti.") : L10n.text("Tahan untuk berbicara, lepaskan untuk selesai."))
                .accessibilityIdentifier("recorder.microphone")
                if recording || model.phase == .preparing {
                    IconControl(symbol: "xmark", label: L10n.text("Batalkan rekaman")) {
                        holding = false
                        model.cancelRecording()
                    }
                }
            }
        }
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
    }

    private var microphone: some View {
        VoiceOrbView(levels: model.levels, phase: model.phase, pressed: holding)
            .accessibilityElement(children: .ignore)
    }

    private func errorCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(message, systemImage: "exclamationmark.circle")
                .font(BisikTheme.font(13))
                .foregroundStyle(BisikTheme.danger)
                .fixedSize(horizontal: false, vertical: true)
            if model.hasPendingRecording {
                HStack {
                    Button(L10n.text("Coba lagi")) { Task { await model.retryTranscription() } }
                        .font(BisikTheme.font(13, semibold: true))
                        .foregroundStyle(BisikTheme.ink)
                        .frame(minHeight: 44)
                        .disabled(!idle)
                    Spacer()
                    Button(L10n.text("Hapus rekaman")) {
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

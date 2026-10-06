import SwiftUI
import UIKit

enum BisikScreen: String, Hashable {
    case recorder, history, dictionary, quota, settings

    var title: String {
        switch self {
        case .recorder: return L10n.text("Rekam")
        case .history: return L10n.text("Riwayat")
        case .dictionary: return L10n.text("Kamus")
        case .quota: return L10n.text("Paket & kuota")
        case .settings: return L10n.text("Pengaturan")
        }
    }

    var symbol: String {
        switch self {
        case .recorder: return "waveform"
        case .history: return "clock"
        case .dictionary: return "character.book.closed"
        case .quota: return "chart.bar"
        case .settings: return "slider.horizontal.3"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var model: AppModel
    @State private var screen: BisikScreen = .recorder
    @State private var menuPresented = false
    @State private var discardPendingAlert = false

    private var menuDisabled: Bool {
        model.phase == .preparing || model.phase == .recording
    }

    // Menu, consent, sign-in and purchase share a single modal presenter.
    private var modalPresented: Binding<Bool> {
        Binding(get: { menuPresented || model.needsConsent || model.needsSignIn || model.showPaywall }, set: { presented in
            if !presented {
                menuPresented = false
                model.needsConsent = false
                model.needsSignIn = false
                model.showPaywall = false
            }
        })
    }

    var body: some View {
        NavigationStack {
            destination
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(Color.white, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        IconControl(symbol: "line.3.horizontal", label: L10n.text("Buka menu"), disabled: menuDisabled) {
                            openMenu()
                        }
                        .accessibilityIdentifier("navigation.menu")
                    }
                    if screen == .recorder {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button {
                                endEditing()
                                if model.hasPendingRecording { discardPendingAlert = true } else { newDraft() }
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 20, weight: .medium))
                                    .frame(width: 44, height: 44)
                                    .background(BisikTheme.panel, in: Circle())
                            }
                            .buttonStyle(.plain)
                            .disabled(model.phase != .idle)
                            .opacity(model.phase == .idle ? 1 : 0.5)
                            .accessibilityLabel(L10n.text("Buat tulisan baru"))
                            .accessibilityIdentifier("navigation.newDraft")
                        }
                    }
                }
        }
        .overlay(alignment: .leading) {
            // Reserve only the outer margin, so native editor scrolling/selection
            // remains intact. VoiceOver users keep the equivalent menu button.
            Color.clear.frame(width: 20)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 24).onEnded { value in
                    guard value.translation.width > 64,
                          abs(value.translation.height) < value.translation.width * 0.6 else { return }
                    openMenu()
                })
                .accessibilityHidden(true)
        }
        .alert(L10n.text("Hapus rekaman yang belum selesai?"), isPresented: $discardPendingAlert) {
            Button(L10n.text("Batal"), role: .cancel) { }
            Button(L10n.text("Hapus & buat baru"), role: .destructive) { newDraft() }
        } message: {
            Text(L10n.text("Rekaman yang belum berhasil diproses akan dihapus saat membuat tulisan baru."))
        }
        .tint(BisikTheme.ink)
        .font(BisikTheme.font())
        .preferredColorScheme(.light)
        .sheet(isPresented: modalPresented) {
            Group {
                if model.needsConsent {
                    CloudConsentView()
                } else if model.needsSignIn {
                    AppleSignInView()
                } else if menuPresented {
                    NavigationMenuView(selection: screen, onSelect: navigate, onNewDraft: newDraft, onSubscription: {
                        menuPresented = false
                        model.showPaywall = true
                    }, onClose: { menuPresented = false })
                } else {
                    PaywallView()
                }
            }
            .environmentObject(model)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .interactiveDismissDisabled(model.needsConsent || model.isPurchasing)
        }
        .task { await model.bootstrap() }
    }

    @ViewBuilder
    private var destination: some View {
        switch screen {
        case .recorder:
            RecorderView()
        case .history:
            HistoryView { screen = .recorder }
        case .dictionary:
            DictionaryView()
        case .quota:
            QuotaView()
        case .settings:
            SettingsView()
        }
    }

    private func navigate(_ destination: BisikScreen) {
        model.commitEdits()
        screen = destination
        menuPresented = false
    }

    private func endEditing() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        model.commitEdits()
    }

    private func openMenu() {
        guard !menuDisabled, !modalPresented.wrappedValue else { return }
        endEditing()
        menuPresented = true
    }

    private func newDraft() {
        guard model.phase == .idle else { return }
        model.newDraft()
        screen = .recorder
        menuPresented = false
    }
}

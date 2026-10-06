import SwiftUI
import UIKit

enum BisikScreen: String, Hashable {
    case recorder, history, dictionary, quota, settings

    var title: String {
        switch self {
        case .recorder: return "Rekam"
        case .history: return "Riwayat"
        case .dictionary: return "Kamus"
        case .quota: return "Paket & kuota"
        case .settings: return "Pengaturan"
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
                        IconControl(symbol: "line.3.horizontal", label: "Buka menu", disabled: menuDisabled) {
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                            model.commitEdits()
                            menuPresented = true
                        }
                        .accessibilityIdentifier("navigation.menu")
                    }
                }
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

    private func newDraft() {
        guard model.phase == .idle else { return }
        model.newDraft()
        screen = .recorder
        menuPresented = false
    }
}

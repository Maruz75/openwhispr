import SwiftUI

private enum BisikTab: Hashable {
    case recorder, history, dictionary, settings
}

struct ContentView: View {
    @EnvironmentObject var model: AppModel
    @State private var tab: BisikTab = .recorder

    // One modal host lets sign-in appear during a purchase without competing sheets.
    private var modalPresented: Binding<Bool> {
        Binding(get: { model.needsConsent || model.needsSignIn || model.showPaywall }, set: { presented in
            if !presented {
                model.needsConsent = false
                model.needsSignIn = false
                model.showPaywall = false
            }
        })
    }

    var body: some View {
        TabView(selection: $tab) {
            RecorderView()
                .tabItem { Label("Rekam", systemImage: "waveform") }
                .tag(BisikTab.recorder)
            HistoryView { tab = .recorder }
                .tabItem { Label("Riwayat", systemImage: "clock") }
                .tag(BisikTab.history)
            DictionaryView()
                .tabItem { Label("Kamus", systemImage: "character.book.closed") }
                .tag(BisikTab.dictionary)
            SettingsView()
                .tabItem { Label("Pengaturan", systemImage: "slider.horizontal.3") }
                .tag(BisikTab.settings)
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
                } else {
                    PaywallView()
                }
            }
            .environmentObject(model)
            .interactiveDismissDisabled(model.needsConsent || model.isPurchasing)
        }
        .task { await model.bootstrap() }
    }
}

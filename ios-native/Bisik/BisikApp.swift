import SwiftUI

@main
struct BisikApp: App {
    @StateObject private var model = AppModel()
    @State private var showingSplash = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some Scene {
        WindowGroup {
            ZStack {
                ContentView()
                    .environmentObject(model)
                    .allowsHitTesting(!showingSplash)
                    .accessibilityHidden(showingSplash)
                if showingSplash { SplashView().transition(.opacity) }
            }
            .preferredColorScheme(.light)
            .environment(\.locale, Locale(identifier: L10n.resolveLanguage(preference: model.interfaceLanguage, preferredLanguages: Locale.preferredLanguages)))
            .task {
                try? await Task.sleep(for: .seconds(1))
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { showingSplash = false }
            }
        }
    }
}

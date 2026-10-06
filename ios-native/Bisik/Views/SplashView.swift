import SwiftUI

struct SplashView: View {
    var body: some View {
        VStack(spacing: 20) {
            VoiceOrbView()
                .accessibilityHidden(true)
            Text("Bisik")
                .font(BisikTheme.font(24, semibold: true, relativeTo: .title))
                .foregroundStyle(BisikTheme.ink)
                .accessibilityIdentifier("launch.splash")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white.ignoresSafeArea())
    }
}

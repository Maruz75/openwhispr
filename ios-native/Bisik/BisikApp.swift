import SwiftUI

@main
struct BisikApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.light)
                .task { await model.bootstrap() }
        }
    }
}

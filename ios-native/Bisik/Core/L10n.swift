import Foundation

enum L10n {
    static let preferenceKey = "BisikInterfaceLanguage"

    static var language: String {
        resolveLanguage(preference: UserDefaults.standard.string(forKey: preferenceKey) ?? "system", preferredLanguages: Locale.preferredLanguages)
    }

    static var locale: Locale { Locale(identifier: language == "id" ? "id_ID" : "en_US") }

    static func resolveLanguage(preference: String, preferredLanguages: [String]) -> String {
        if preference == "en" || preference == "id" { return preference }
        return preferredLanguages.first?.lowercased().hasPrefix("id") == true ? "id" : "en"
    }

    static func text(_ key: String, language: String? = nil) -> String {
        let selected = language ?? self.language
        guard let path = Bundle.main.path(forResource: selected, ofType: "lproj"), let bundle = Bundle(path: path) else { return key }
        return bundle.localizedString(forKey: key, value: key, table: "Localizable")
    }

    static func format(_ key: String, _ arguments: Any...) -> String {
        String(format: text(key), locale: locale, arguments: arguments.map { String(describing: $0) as CVarArg })
    }
}

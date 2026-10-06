import Foundation

/// These values are set by the developer in Info.plist, never exposed as model choices.
enum AppConfiguration {
    static let apiBaseURL = secureURL("BisikAPIBaseURL")
    static let privacyURL = secureURL("BisikPrivacyURL")
    static let termsURL = secureURL("BisikTermsURL")
    static var aiProviderDisclosure: String {
        let key = L10n.language == "en" ? "BisikAIProviderDisclosureEnglish" : "BisikAIProviderDisclosure"
        if let disclosure = Bundle.main.object(forInfoDictionaryKey: key) as? String,
           !disclosure.isEmpty, !disclosure.contains("$(") { return disclosure }
        return L10n.text("Audio dan teks dikirim ke server Bisik serta penyedia AI yang dikelola pengembang untuk menghasilkan transkripsi.")
    }
    static let productIDs = Bundle.main.object(forInfoDictionaryKey: "BisikProductIDs") as? [String] ?? []
    static let freeMinutes = Bundle.main.object(forInfoDictionaryKey: "BisikFreeMinutes") as? Int ?? 15
    static let proMinutes = Bundle.main.object(forInfoDictionaryKey: "BisikProMinutes") as? Int ?? 300

    private static func secureURL(_ key: String) -> URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.contains("$("), let url = URL(string: value),
              url.scheme?.lowercased() == "https", let host = url.host,
              !host.isEmpty, host != "example.com", !host.hasSuffix(".example.com") else { return nil }
        return url
    }
}

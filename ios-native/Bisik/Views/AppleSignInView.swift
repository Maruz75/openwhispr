import SwiftUI
import AuthenticationServices
import CryptoKit
import Security

struct AppleSignInView: View {
    @EnvironmentObject private var model: AppModel
    @State private var rawNonce: String?
    @State private var localError: String?
    @State private var authorizing = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 32, weight: .light))
                        .foregroundStyle(BisikTheme.ink)
                        .frame(width: 72, height: 72)
                        .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 22))
                        .accessibilityHidden(true)
                    PageTitle(title: "Satu akun untuk suaramu", subtitle: "Masuk untuk menggunakan kuota gratis dan menghubungkan langgananmu.")
                    Text("Bisik menggunakan identitas Apple untuk akunmu. Riwayat dan kamus tetap tersimpan di iPhone ini.")
                        .font(BisikTheme.font(14))
                        .foregroundStyle(BisikTheme.secondary)
                        .lineSpacing(4)
                    SignInWithAppleButton(.signIn, onRequest: configure, onCompletion: complete)
                        .signInWithAppleButtonStyle(.black)
                        .frame(height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                        .disabled(authorizing || !model.isConfigured)
                        .opacity(authorizing || !model.isConfigured ? 0.5 : 1)
                        .accessibilityLabel("Masuk dengan Apple")
                    if authorizing {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Menghubungkan akun…").font(BisikTheme.font(13)).foregroundStyle(BisikTheme.secondary)
                        }
                    }
                    if let error = localError ?? model.errorMessage {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(BisikTheme.font(13))
                            .foregroundStyle(BisikTheme.danger)
                    }
                    if !model.isConfigured {
                        Text("Layanan akun belum tersedia. Coba kembali nanti.")
                            .font(BisikTheme.font(13))
                            .foregroundStyle(BisikTheme.danger)
                    }
                    Button("Nanti saja") { model.needsSignIn = false }
                        .font(BisikTheme.font(14))
                        .foregroundStyle(BisikTheme.secondary)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .disabled(authorizing)
                    LegalLinks()
                }
                .padding(24)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(Color.white)
            .toolbar(.hidden, for: .navigationBar)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(authorizing)
    }

    private func configure(_ request: ASAuthorizationAppleIDRequest) {
        localError = nil
        // Hex encoding preserves all 256 random bits; no modulo-biased alphabet.
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            rawNonce = nil
            localError = "Verifikasi keamanan belum siap. Coba masuk kembali."
            return
        }
        let nonce = bytes.map { String(format: "%02x", $0) }.joined()
        rawNonce = nonce
        request.requestedScopes = []
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func complete(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8),
                  let nonce = rawNonce else {
                localError = "Apple belum mengirim identitas yang valid. Coba masuk kembali."
                return
            }
            let code = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
            rawNonce = nil
            authorizing = true
            Task {
                await model.signIn(identityToken: token, nonce: nonce, authorizationCode: code)
                authorizing = false
            }
        case .failure(let error):
            rawNonce = nil
            if let appleError = error as? ASAuthorizationError, appleError.code == .canceled {
                localError = nil
            } else {
                localError = "Belum bisa masuk dengan Apple. Coba lagi sebentar."
            }
        }
    }
}

import Foundation

enum APIError: LocalizedError {
    case unconfigured
    case server(code: String, message: String, status: Int)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unconfigured: return "Layanan Bisik belum dikonfigurasi oleh pengembang."
        case .server(_, let message, _): return message
        case .invalidResponse: return "Jawaban server tidak valid. Coba lagi."
        }
    }

    var isUnauthorized: Bool {
        if case .server(_, _, let status) = self { return status == 401 }
        return false
    }

    var isQuotaExceeded: Bool {
        if case .server(let code, _, let status) = self { return code == "quota_exceeded" || status == 402 }
        return false
    }
}

final class APIClient {
    private let baseURL: URL?
    private let session: URLSession

    init(baseURL: URL? = AppConfiguration.apiBaseURL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 90
        configuration.timeoutIntervalForResource = 180
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    func signIn(identityToken: String, nonce: String, authorizationCode: String?) async throws -> AuthResponse {
        var payload = ["identityToken": identityToken, "nonce": nonce]
        if let authorizationCode { payload["authorizationCode"] = authorizationCode }
        return try await json("v1/auth/apple", method: "POST", token: nil, body: payload)
    }

    func quota(token: String) async throws -> UsageQuota { try await json("v1/quota", token: token) }

    func verifySubscription(signedTransaction: String, token: String) async throws -> SubscriptionResponse {
        try await json("v1/subscriptions/verify", method: "POST", token: token, body: ["signedTransaction": signedTransaction])
    }

    func logout(token: String) async throws { try await empty("v1/auth/logout", method: "POST", token: token) }
    func deleteAccount(token: String) async throws { try await empty("v1/account", method: "DELETE", token: token) }

    func transcribe(_ recording: PendingRecording, token: String) async throws -> TranscriptionResponse {
        let boundary = "Bisik-" + UUID().uuidString
        var request = try makeRequest("v1/transcriptions", method: "POST", token: token)
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let bodyURL = FileManager.default.temporaryDirectory.appendingPathComponent("bisik-upload-" + UUID().uuidString + ".multipart")
        FileManager.default.createFile(atPath: bodyURL.path, contents: nil,
                                      attributes: [.protectionKey: FileProtectionType.complete])
        defer { try? FileManager.default.removeItem(at: bodyURL) }
        let handle = try FileHandle(forWritingTo: bodyURL)
        do {
            let entries = recording.dictionary.map { ["source": $0.source, "replacement": $0.replacement] }
            let dictionary = try JSONSerialization.data(withJSONObject: entries)
            let fields = [("requestID", recording.requestID.uuidString),
                          ("language", recording.language),
                          ("dictionary", String(data: dictionary, encoding: .utf8) ?? "[]")]
            for (name, value) in fields {
                try handle.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
            }
            try handle.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.wav\"\r\nContent-Type: audio/wav\r\n\r\n".utf8))
            let audio = try FileHandle(forReadingFrom: recording.url)
            defer { try? audio.close() }
            while let chunk = try audio.read(upToCount: 64 * 1024), !chunk.isEmpty {
                try Task.checkCancellation()
                try handle.write(contentsOf: chunk)
            }
            try handle.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))
            try handle.close()
        } catch {
            try? handle.close()
            throw error
        }
        let (data, response) = try await session.upload(for: request, fromFile: bodyURL)
        try check(response, data: data)
        return try Self.decoder().decode(TranscriptionResponse.self, from: data)
    }

    private func json<T: Decodable>(_ path: String, method: String = "GET", token: String?, body: [String: String]? = nil) async throws -> T {
        var request = try makeRequest(path, method: method, token: token)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        try check(response, data: data)
        return try Self.decoder().decode(T.self, from: data)
    }

    private func empty(_ path: String, method: String, token: String) async throws {
        let request = try makeRequest(path, method: method, token: token)
        let (data, response) = try await session.data(for: request)
        try check(response, data: data)
    }

    private func makeRequest(_ path: String, method: String, token: String?) throws -> URLRequest {
        guard let baseURL, baseURL.scheme == "https" else { throw APIError.unconfigured }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        return request
    }

    private func check(_ response: URLResponse, data: Data) throws {
        guard let response = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            struct ServerFailure: Decodable { let code: String; let message: String }
            let error = try? JSONDecoder().decode(ServerFailure.self, from: data)
            throw APIError.server(code: error?.code ?? "request_failed",
                                  message: error?.message ?? "Layanan tidak dapat dihubungi. Coba lagi.", status: response.statusCode)
        }
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO 8601 date")
        }
        return decoder
    }
}

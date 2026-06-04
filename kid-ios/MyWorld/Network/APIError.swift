import Foundation

enum APIError: Error, LocalizedError {
    case badStatus(Int, String)
    case invalidResponse
    case decoding(Error)
    case transport(Error)
    case notAuthenticated

    var errorDescription: String? {
        switch self {
        case .badStatus(let code, let body):
            // Trim large bodies — these surface to the user via banner.
            let trimmed = body.count > 200 ? String(body.prefix(200)) + "…" : body
            return "Server returned \(code): \(trimmed)"
        case .invalidResponse:    return "Server returned an invalid response."
        case .decoding(let err):  return "Couldn't read server response: \(err.localizedDescription)"
        case .transport(let err): return "Network problem: \(err.localizedDescription)"
        case .notAuthenticated:   return "Please sign in again."
        }
    }
}

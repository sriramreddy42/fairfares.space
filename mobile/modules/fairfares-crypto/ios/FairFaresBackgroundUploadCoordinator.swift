import ExpoModulesCore
import Foundation
import UIKit

private struct FairFaresBackgroundUploadTask: Codable {
  let uploadId: String
  let partNumber: Int
  let filePath: String
  let expectedSize: Int64
}

final class FairFaresBackgroundUploadCoordinator: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
  static let shared = FairFaresBackgroundUploadCoordinator()
  static let identifier = "com.fairfares.mobile.chitthi.multipart.v1"

  private let lock = NSLock()
  private var continuations: [Int: CheckedContinuation<[String: Any], Error>] = [:]
  private var appCompletionHandler: (() -> Void)?
  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.background(withIdentifier: Self.identifier)
    configuration.sessionSendsLaunchEvents = true
    configuration.isDiscretionary = false
    configuration.waitsForConnectivity = true
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()

  private override init() {
    super.init()
  }

  func reconnect() {
    session.getAllTasks { _ in }
  }

  func activePartNumbers(uploadId: String) async -> [Int] {
    guard !uploadId.isEmpty else { return [] }
    return await withCheckedContinuation { continuation in
      session.getAllTasks { tasks in
        let parts = tasks.compactMap { task -> Int? in
          // getAllTasks normally excludes completed tasks. Treat a cancelling
          // task as active too because URLSession may still have the file open
          // until its completion delegate runs.
          guard task.state != .completed,
                let description = task.taskDescription,
                let data = description.data(using: .utf8),
                let metadata = try? JSONDecoder().decode(FairFaresBackgroundUploadTask.self, from: data),
                metadata.uploadId == uploadId else { return nil }
          return metadata.partNumber
        }
        continuation.resume(returning: Array(Set(parts)).sorted())
      }
    }
  }

  func handleBackgroundEvents(identifier: String, completionHandler: @escaping () -> Void) {
    lock.lock()
    appCompletionHandler = completionHandler
    lock.unlock()
    reconnect()
  }

  func uploadPart(uploadId: String, partNumber: Int, uploadUrl: String, headers: [String: String], fileUri: String, expectedSize: Int64) async throws -> [String: Any] {
    guard !uploadId.isEmpty, partNumber > 0, expectedSize > 0,
          let destination = URL(string: uploadUrl), destination.scheme == "https",
          let file = URL(string: fileUri), file.isFileURL else {
      throw NSError(domain: "FairFaresBackgroundUpload", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid background upload parameters."])
    }
    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    guard (attributes[.size] as? NSNumber)?.int64Value == expectedSize else {
      throw NSError(domain: "FairFaresBackgroundUpload", code: 2, userInfo: [NSLocalizedDescriptionKey: "The staged upload part is incomplete."])
    }
    var request = URLRequest(url: destination)
    request.httpMethod = "PUT"
    request.cachePolicy = .reloadIgnoringLocalCacheData
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    let metadata = FairFaresBackgroundUploadTask(uploadId: uploadId, partNumber: partNumber, filePath: file.path, expectedSize: expectedSize)
    let taskDescription = String(data: try JSONEncoder().encode(metadata), encoding: .utf8)

    return try await withCheckedThrowingContinuation { continuation in
      let task = session.uploadTask(with: request, fromFile: file)
      task.taskDescription = taskDescription
      lock.lock()
      continuations[task.taskIdentifier] = continuation
      lock.unlock()
      task.resume()
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let response = task.response as? HTTPURLResponse
    let status = response?.statusCode ?? 0
    let etag = response?.allHeaderFields.first(where: { String(describing: $0.key).lowercased() == "etag" }).map { String(describing: $0.value) } ?? ""
    let succeeded = error == nil && (200..<300).contains(status) && !etag.isEmpty
    if succeeded, let description = task.taskDescription,
       let data = description.data(using: .utf8),
       let metadata = try? JSONDecoder().decode(FairFaresBackgroundUploadTask.self, from: data) {
      try? FileManager.default.removeItem(atPath: metadata.filePath)
    }
    lock.lock()
    let continuation = continuations.removeValue(forKey: task.taskIdentifier)
    lock.unlock()
    if succeeded {
      continuation?.resume(returning: ["status": status, "etag": etag])
    } else {
      let message = error?.localizedDescription ?? "Background upload failed (\(status))."
      continuation?.resume(throwing: NSError(domain: "FairFaresBackgroundUpload", code: status, userInfo: [NSLocalizedDescriptionKey: message]))
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    lock.lock()
    let completionHandler = appCompletionHandler
    appCompletionHandler = nil
    lock.unlock()
    DispatchQueue.main.async { completionHandler?() }
  }
}

public final class FairFaresBackgroundUploadAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
    guard identifier == FairFaresBackgroundUploadCoordinator.identifier else {
      completionHandler()
      return
    }
    FairFaresBackgroundUploadCoordinator.shared.handleBackgroundEvents(identifier: identifier, completionHandler: completionHandler)
  }
}

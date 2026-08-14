import CryptoKit
import CommonCrypto
import Dispatch
import ExpoModulesCore
import Foundation
import AVFoundation
import UIKit

public final class FairFaresCryptoModule: Module {
  private let cancellationLock = NSLock()
  private var cancelledOperations = Set<String>()
  private var activeOperations = Set<String>()
  private let cryptoQueue = DispatchQueue(label: "com.fairfares.crypto.work", qos: .userInitiated, attributes: .concurrent)
  private let cancellationQueue = DispatchQueue(label: "com.fairfares.crypto.cancel", qos: .userInteractive)

  public func definition() -> ModuleDefinition {
    Name("FairFaresCrypto")
    Events("onCryptoProgress")

    Function("prepare") { (operationId: String) in
      self.begin(operationId)
    }

    Function("release") { (operationId: String) in
      self.finish(operationId)
    }

    AsyncFunction("encryptFile") { (operationId: String, sourceUri: String, destinationUri: String, keyBase64: String, noncePrefixBase64: String, chunkSize: Int) in
      try self.encryptFile(operationId, sourceUri, destinationUri, keyBase64, noncePrefixBase64, chunkSize)
    }.runOnQueue(cryptoQueue)

    AsyncFunction("decryptFile") { (operationId: String, sourceUri: String, destinationUri: String, keyBase64: String, noncePrefixBase64: String, chunkSize: Int, plaintextSize: Double, chunkCount: Int) in
      try self.decryptFile(operationId, sourceUri, destinationUri, keyBase64, noncePrefixBase64, chunkSize, Int64(plaintextSize), chunkCount)
    }.runOnQueue(cryptoQueue)

    AsyncFunction("protectFile") { (fileUri: String) in
      let file = try self.url(fileUri)
      guard FileManager.default.fileExists(atPath: file.path) else {
        throw NSError(domain: "FairFaresCrypto", code: 11, userInfo: [NSLocalizedDescriptionKey: "Chitthi media is unavailable for protection."])
      }
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file.path)
    }.runOnQueue(cryptoQueue)

    AsyncFunction("commitProtectedFile") { (sourceUri: String, destinationUri: String) in
      let source = try self.url(sourceUri)
      let destination = try self.url(destinationUri)
      guard FileManager.default.fileExists(atPath: source.path) else {
        throw NSError(domain: "FairFaresCrypto", code: 12, userInfo: [NSLocalizedDescriptionKey: "Chitthi temporary media is unavailable."])
      }
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: source.path)
      try self.commit(source, to: destination)
    }.runOnQueue(cryptoQueue)

    AsyncFunction("uploadMultipartPart") { (uploadId: String, partNumber: Int, uploadUrl: String, headers: [String: String], fileUri: String, expectedSize: Double) in
      try await FairFaresBackgroundUploadCoordinator.shared.uploadPart(
        uploadId: uploadId,
        partNumber: partNumber,
        uploadUrl: uploadUrl,
        headers: headers,
        fileUri: fileUri,
        expectedSize: Int64(expectedSize)
      )
    }

    AsyncFunction("activeMultipartPartNumbers") { (uploadId: String) in
      await FairFaresBackgroundUploadCoordinator.shared.activePartNumbers(uploadId: uploadId)
    }

    AsyncFunction("generateVideoThumbnail") { (fileUri: String, maximumBytes: Int) in
      try self.generateVideoThumbnail(fileUri, maximumBytes)
    }.runOnQueue(cryptoQueue)

    AsyncFunction("stageMultipartPart") { (sourceUri: String, destinationUri: String, offset: Double, size: Double) in
      try self.stageMultipartPart(sourceUri, destinationUri, Int64(offset), Int64(size))
    }.runOnQueue(cryptoQueue)

    AsyncFunction("appendFile") { (sourceUri: String, destinationUri: String, expectedOffset: Double, expectedSize: Double) in
      try self.appendFile(sourceUri, destinationUri, Int64(expectedOffset), Int64(expectedSize))
    }.runOnQueue(cryptoQueue)

    AsyncFunction("sha256File") { (fileUri: String, expectedSize: Double) in
      try self.sha256File(fileUri, Int64(expectedSize))
    }.runOnQueue(cryptoQueue)

    AsyncFunction("optimizeVideo") { (operationId: String, sourceUri: String, destinationUri: String) in
      try await self.optimizeVideo(operationId, sourceUri, destinationUri)
    }

    AsyncFunction("deriveRecoveryKey") { (passphraseBase64: String, saltBase64: String, iterations: Int, outputBytes: Int) in
      guard var passphrase = Data(base64Encoded: passphraseBase64), var salt = Data(base64Encoded: saltBase64),
            !passphrase.isEmpty, salt.count == 16, iterations == 210_000, outputBytes == 32 else {
        throw NSError(domain: "FairFaresCrypto", code: 13, userInfo: [NSLocalizedDescriptionKey: "Invalid recovery derivation parameters."])
      }
      defer {
        passphrase.resetBytes(in: 0..<passphrase.count)
        salt.resetBytes(in: 0..<salt.count)
      }
      var derived = Data(count: outputBytes)
      let status = passphrase.withUnsafeBytes { passphraseBytes in
        salt.withUnsafeBytes { saltBytes in
          derived.withUnsafeMutableBytes { derivedBytes in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), passphraseBytes.bindMemory(to: Int8.self).baseAddress,
              passphrase.count, saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
              CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations),
              derivedBytes.bindMemory(to: UInt8.self).baseAddress, outputBytes)
          }
        }
      }
      guard status == kCCSuccess else {
        derived.resetBytes(in: 0..<derived.count)
        throw NSError(domain: "FairFaresCrypto", code: 14, userInfo: [NSLocalizedDescriptionKey: "Recovery key derivation failed."])
      }
      defer { derived.resetBytes(in: 0..<derived.count) }
      return derived.base64EncodedString()
    }.runOnQueue(cryptoQueue)

    AsyncFunction("cancel") { (operationId: String) in
      self.cancellationLock.lock()
      if self.activeOperations.contains(operationId) {
        self.cancelledOperations.insert(operationId)
      }
      self.cancellationLock.unlock()
    }.runOnQueue(cancellationQueue)
  }

  private func isCancelled(_ operationId: String) -> Bool {
    cancellationLock.lock()
    defer { cancellationLock.unlock() }
    return cancelledOperations.contains(operationId)
  }

  private func finish(_ operationId: String) {
    cancellationLock.lock()
    cancelledOperations.remove(operationId)
    activeOperations.remove(operationId)
    cancellationLock.unlock()
  }

  private func begin(_ operationId: String) {
    cancellationLock.lock()
    activeOperations.insert(operationId)
    cancellationLock.unlock()
  }

  private func checkCancellation(_ operationId: String) throws {
    if isCancelled(operationId) {
      throw NSError(domain: "FairFaresCrypto", code: 9, userInfo: [NSLocalizedDescriptionKey: "Attachment processing was cancelled."])
    }
  }

  private func generateVideoThumbnail(_ fileUri: String, _ maximumBytes: Int) throws -> String {
    let source = try url(fileUri)
    guard maximumBytes >= 1_000 && maximumBytes <= 12_000,
          FileManager.default.fileExists(atPath: source.path) else {
      throw NSError(domain: "FairFaresCrypto", code: 15, userInfo: [NSLocalizedDescriptionKey: "The selected video is unavailable for thumbnail generation."])
    }
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: source))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 240, height: 240)
    generator.requestedTimeToleranceBefore = .positiveInfinity
    generator.requestedTimeToleranceAfter = .positiveInfinity
    let requestedTime = CMTime(seconds: 0.1, preferredTimescale: 600)
    let image: CGImage
    do {
      image = try generator.copyCGImage(at: requestedTime, actualTime: nil)
    } catch {
      image = try generator.copyCGImage(at: .zero, actualTime: nil)
    }
    var uiImage = UIImage(cgImage: image)
    var quality: CGFloat = 0.52
    var width: CGFloat = min(240, uiImage.size.width)
    for _ in 0..<7 {
      let scale = width / max(1, uiImage.size.width)
      let size = CGSize(width: width, height: max(1, uiImage.size.height * scale))
      let renderer = UIGraphicsImageRenderer(size: size)
      let resized = renderer.image { _ in uiImage.draw(in: CGRect(origin: .zero, size: size)) }
      if let jpeg = resized.jpegData(compressionQuality: quality), jpeg.count <= maximumBytes {
        return jpeg.base64EncodedString()
      }
      uiImage = resized
      width = max(64, width * 0.78)
      quality = max(0.14, quality - 0.07)
    }
    throw NSError(domain: "FairFaresCrypto", code: 16, userInfo: [NSLocalizedDescriptionKey: "The video thumbnail could not be reduced safely."])
  }

  private func optimizeVideo(_ operationId: String, _ sourceValue: String, _ destinationValue: String) async throws -> [String: Any] {
    defer { finish(operationId) }
    let source = try url(sourceValue), destination = try url(destinationValue)
    guard FileManager.default.fileExists(atPath: source.path) else {
      throw NSError(domain: "FairFaresCrypto", code: 20, userInfo: [NSLocalizedDescriptionKey: "The selected video is unavailable."])
    }
    let cacheRoot = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true).standardizedFileURL
    let preparedRoot = cacheRoot.appendingPathComponent("chitthi-prepared", isDirectory: true).standardizedFileURL
    guard destination.standardizedFileURL.path.hasPrefix(preparedRoot.path + "/"), source.standardizedFileURL != destination.standardizedFileURL else {
      throw NSError(domain: "FairFaresCrypto", code: 25, userInfo: [NSLocalizedDescriptionKey: "Invalid protected video destination."])
    }
    try FileManager.default.createDirectory(at: preparedRoot, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    try? FileManager.default.removeItem(at: destination)
    let asset = AVURLAsset(url: source)
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else {
      throw NSError(domain: "FairFaresCrypto", code: 21, userInfo: [NSLocalizedDescriptionKey: "This video format cannot be optimized."])
    }
    session.outputURL = destination
    guard session.supportedFileTypes.contains(.mp4) else {
      throw NSError(domain: "FairFaresCrypto", code: 22, userInfo: [NSLocalizedDescriptionKey: "This video cannot be exported as MP4."])
    }
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    session.directoryForTemporaryFiles = preparedRoot
    session.fileLengthLimit = 100_000_000
    let monitor = Task {
      while !Task.isCancelled {
        if self.isCancelled(operationId) { session.cancelExport() }
        self.sendEvent("onCryptoProgress", ["operationId": operationId, "progress": Double(session.progress)])
        try? await Task.sleep(nanoseconds: 120_000_000)
        if session.status != .waiting && session.status != .exporting { break }
      }
    }
    await withCheckedContinuation { continuation in
      session.exportAsynchronously { continuation.resume() }
    }
    monitor.cancel()
    if isCancelled(operationId) || session.status == .cancelled {
      try? FileManager.default.removeItem(at: destination)
      throw NSError(domain: "FairFaresCrypto", code: 9, userInfo: [NSLocalizedDescriptionKey: "Video preparation was cancelled."])
    }
    guard session.status == .completed else {
      try? FileManager.default.removeItem(at: destination)
      throw session.error ?? NSError(domain: "FairFaresCrypto", code: 23, userInfo: [NSLocalizedDescriptionKey: "The video could not be optimized."])
    }
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
    let outputSize = ((try FileManager.default.attributesOfItem(atPath: destination.path))[.size] as? NSNumber)?.int64Value ?? 0
    guard outputSize > 0 else {
      try? FileManager.default.removeItem(at: destination)
      throw NSError(domain: "FairFaresCrypto", code: 24, userInfo: [NSLocalizedDescriptionKey: "The optimized video is empty."])
    }
    sendEvent("onCryptoProgress", ["operationId": operationId, "progress": 1.0])
    return ["outputSize": Double(outputSize), "mimeType": "video/mp4"]
  }

  private func progress(_ operationId: String, _ completed: Int64, _ total: Int64) {
    sendEvent("onCryptoProgress", ["operationId": operationId, "progress": total > 0 ? Double(completed) / Double(total) : 0])
  }

  private func stageMultipartPart(_ sourceValue: String, _ destinationValue: String, _ offset: Int64, _ size: Int64) throws -> [String: Any] {
    let source = try url(sourceValue), destination = try url(destinationValue)
    guard offset >= 0, size > 0, size <= 16 * 1024 * 1024 else {
      throw NSError(domain: "FairFaresCrypto", code: 17, userInfo: [NSLocalizedDescriptionKey: "Invalid multipart staging range."])
    }
    let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
    let sourceSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0
    guard sourceSize >= offset + size else {
      throw NSError(domain: "FairFaresCrypto", code: 18, userInfo: [NSLocalizedDescriptionKey: "The encrypted upload part is incomplete."])
    }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    let partial = URL(fileURLWithPath: destination.path + ".partial")
    try? FileManager.default.removeItem(at: partial)
    FileManager.default.createFile(atPath: partial.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    let input = try FileHandle(forReadingFrom: source)
    let output = try FileHandle(forWritingTo: partial)
    defer {
      try? input.close()
      try? output.close()
    }
    try input.seek(toOffset: UInt64(offset))
    var remaining = size
    var hasher = Insecure.MD5()
    while remaining > 0 {
      let requested = Int(min(1_048_576, remaining))
      guard let chunk = try input.read(upToCount: requested), chunk.count == requested else {
        try? FileManager.default.removeItem(at: partial)
        throw NSError(domain: "FairFaresCrypto", code: 19, userInfo: [NSLocalizedDescriptionKey: "The encrypted upload part ended early."])
      }
      hasher.update(data: chunk)
      try output.write(contentsOf: chunk)
      remaining -= Int64(chunk.count)
    }
    try output.synchronize()
    if FileManager.default.fileExists(atPath: destination.path) {
      _ = try FileManager.default.replaceItemAt(destination, withItemAt: partial)
    } else {
      try FileManager.default.moveItem(at: partial, to: destination)
    }
    return ["size": Double(size), "md5Base64": Data(hasher.finalize()).base64EncodedString()]
  }

  private func appendFile(_ sourceValue: String, _ destinationValue: String, _ expectedOffset: Int64, _ expectedSize: Int64) throws -> [String: Any] {
    let source = try url(sourceValue), destination = try url(destinationValue)
    guard source.standardizedFileURL != destination.standardizedFileURL,
          expectedOffset >= 0, expectedSize > 0, expectedSize <= 16 * 1024 * 1024,
          expectedOffset <= 120_000_000 - expectedSize else {
      throw NSError(domain: "FairFaresCrypto", code: 26, userInfo: [NSLocalizedDescriptionKey: "Invalid downloaded media range."])
    }
    let sourceSize = ((try FileManager.default.attributesOfItem(atPath: source.path))[.size] as? NSNumber)?.int64Value ?? 0
    let destinationAttributes = try? FileManager.default.attributesOfItem(atPath: destination.path)
    let destinationSize = (destinationAttributes?[.size] as? NSNumber)?.int64Value ?? 0
    guard sourceSize == expectedSize, destinationSize == expectedOffset else {
      throw NSError(domain: "FairFaresCrypto", code: 27, userInfo: [NSLocalizedDescriptionKey: "Downloaded media ranges are out of sequence."])
    }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: destination.path) {
      guard FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
        throw NSError(domain: "FairFaresCrypto", code: 28, userInfo: [NSLocalizedDescriptionKey: "Could not create encrypted download storage."])
      }
    }
    let input = try FileHandle(forReadingFrom: source)
    let output = try FileHandle(forWritingTo: destination)
    defer { try? input.close(); try? output.close() }
    do {
      try output.seekToEnd()
      var copied: Int64 = 0
      while copied < expectedSize {
        let requested = Int(min(1_048_576, expectedSize - copied))
        guard let chunk = try input.read(upToCount: requested), chunk.count == requested else {
          throw NSError(domain: "FairFaresCrypto", code: 29, userInfo: [NSLocalizedDescriptionKey: "Downloaded media range ended early."])
        }
        try output.write(contentsOf: chunk)
        copied += Int64(chunk.count)
      }
      try output.synchronize()
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
      return ["outputSize": Double(expectedOffset + copied)]
    } catch {
      try? output.truncate(atOffset: UInt64(expectedOffset))
      try? output.synchronize()
      throw error
    }
  }

  private func sha256File(_ fileValue: String, _ expectedSize: Int64) throws -> [String: Any] {
    let source = try url(fileValue)
    let size = ((try FileManager.default.attributesOfItem(atPath: source.path))[.size] as? NSNumber)?.int64Value ?? 0
    guard expectedSize > 0, expectedSize <= 120_000_000, size == expectedSize else {
      throw NSError(domain: "FairFaresCrypto", code: 30, userInfo: [NSLocalizedDescriptionKey: "Encrypted download size verification failed."])
    }
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }
    var hasher = SHA256()
    var read: Int64 = 0
    while read < size {
      let requested = Int(min(1_048_576, size - read))
      guard let chunk = try input.read(upToCount: requested), chunk.count == requested else {
        throw NSError(domain: "FairFaresCrypto", code: 31, userInfo: [NSLocalizedDescriptionKey: "Encrypted download ended during verification."])
      }
      hasher.update(data: chunk)
      read += Int64(chunk.count)
    }
    return ["size": Double(size), "sha256Base64": Data(hasher.finalize()).base64EncodedString()]
  }

  private func commit(_ partial: URL, to destination: URL) throws {
    if FileManager.default.fileExists(atPath: destination.path) {
      _ = try FileManager.default.replaceItemAt(destination, withItemAt: partial)
    } else {
      try FileManager.default.moveItem(at: partial, to: destination)
    }
  }

  private func url(_ value: String) throws -> URL {
    guard let url = URL(string: value), url.isFileURL else { throw NSError(domain: "FairFaresCrypto", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid file URI."]) }
    return url
  }

  private func inputs(_ keyBase64: String, _ prefixBase64: String, _ chunkSize: Int) throws -> (Data, Data) {
    guard let key = Data(base64Encoded: keyBase64), key.count == 32,
          let prefix = Data(base64Encoded: prefixBase64), prefix.count == 4,
          chunkSize >= 65_536 && chunkSize <= 4_194_304 else {
      throw NSError(domain: "FairFaresCrypto", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid native crypto parameters."])
    }
    return (key, prefix)
  }

  private func nonce(_ prefix: Data, _ index: Int) throws -> AES.GCM.Nonce {
    var value = UInt64(index).bigEndian
    var data = prefix
    withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
    return try AES.GCM.Nonce(data: data)
  }

  private func encryptFile(_ operationId: String, _ sourceValue: String, _ destinationValue: String, _ keyBase64: String, _ prefixBase64: String, _ chunkSize: Int) throws -> [String: Any] {
    defer { finish(operationId) }
    let source = try url(sourceValue), destination = try url(destinationValue)
    let partial = URL(fileURLWithPath: destination.path + ".part")
    var (keyData, prefix) = try inputs(keyBase64, prefixBase64, chunkSize)
    defer {
      keyData.resetBytes(in: 0..<keyData.count)
      prefix.resetBytes(in: 0..<prefix.count)
    }
    let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
    guard let size = attributes[.size] as? NSNumber, size.int64Value > 0, size.int64Value <= 100_000_000 else { throw NSError(domain: "FairFaresCrypto", code: 3, userInfo: [NSLocalizedDescriptionKey: "The selected attachment size is invalid."]) }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: partial)
    guard FileManager.default.createFile(atPath: partial.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
      throw NSError(domain: "FairFaresCrypto", code: 10, userInfo: [NSLocalizedDescriptionKey: "Could not create protected encrypted storage."])
    }
    let input = try FileHandle(forReadingFrom: source)
    let output: FileHandle
    do {
      output = try FileHandle(forWritingTo: partial)
    } catch {
      try? input.close()
      try? FileManager.default.removeItem(at: partial)
      throw error
    }
    var hasher = SHA256()
    var outputSize = 0
    do {
      let key = SymmetricKey(data: keyData)
      var index = 0
      progress(operationId, 0, size.int64Value)
      while var clear = try input.read(upToCount: chunkSize), !clear.isEmpty {
        try checkCancellation(operationId)
        let sealed: AES.GCM.SealedBox
        do {
          defer { clear.resetBytes(in: 0..<clear.count) }
          sealed = try AES.GCM.seal(clear, using: key, nonce: try nonce(prefix, index))
        }
        let combined = sealed.ciphertext + sealed.tag
        try output.write(contentsOf: combined)
        hasher.update(data: combined)
        outputSize += combined.count
        progress(operationId, min(Int64(index + 1) * Int64(chunkSize), size.int64Value), size.int64Value)
        index += 1
      }
      try checkCancellation(operationId)
      try output.synchronize()
      try input.close()
      try output.close()
      try commit(partial, to: destination)
      return ["outputSize": outputSize, "sha256Base64": Data(hasher.finalize()).base64EncodedString()]
    } catch {
      try? input.close()
      try? output.close()
      try? FileManager.default.removeItem(at: partial)
      throw error
    }
  }

  private func decryptFile(_ operationId: String, _ sourceValue: String, _ destinationValue: String, _ keyBase64: String, _ prefixBase64: String, _ chunkSize: Int, _ plaintextSize: Int64, _ chunkCount: Int) throws -> [String: Any] {
    defer { finish(operationId) }
    let source = try url(sourceValue), destination = try url(destinationValue)
    let partial = URL(fileURLWithPath: destination.path + ".part")
    var (keyData, prefix) = try inputs(keyBase64, prefixBase64, chunkSize)
    defer {
      keyData.resetBytes(in: 0..<keyData.count)
      prefix.resetBytes(in: 0..<prefix.count)
    }
    let expectedChunkCount = Int((plaintextSize + Int64(chunkSize) - 1) / Int64(chunkSize))
    guard plaintextSize > 0 && plaintextSize <= 100_000_000 && chunkCount == expectedChunkCount else { throw NSError(domain: "FairFaresCrypto", code: 5, userInfo: [NSLocalizedDescriptionKey: "Invalid encrypted attachment descriptor."]) }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: partial)
    guard FileManager.default.createFile(atPath: partial.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
      throw NSError(domain: "FairFaresCrypto", code: 10, userInfo: [NSLocalizedDescriptionKey: "Could not create protected decrypted storage."])
    }
    let input = try FileHandle(forReadingFrom: source)
    let output: FileHandle
    do {
      output = try FileHandle(forWritingTo: partial)
    } catch {
      try? input.close()
      try? FileManager.default.removeItem(at: partial)
      throw error
    }
    var written: Int64 = 0
    do {
      let key = SymmetricKey(data: keyData)
      progress(operationId, 0, plaintextSize)
      for index in 0..<chunkCount {
        try checkCancellation(operationId)
        let clearSize = Int(min(Int64(chunkSize), plaintextSize - Int64(index * chunkSize)))
        guard clearSize > 0, let encrypted = try input.read(upToCount: clearSize + 16), encrypted.count == clearSize + 16 else { throw NSError(domain: "FairFaresCrypto", code: 6, userInfo: [NSLocalizedDescriptionKey: "Encrypted attachment ended early."]) }
        let ciphertext = encrypted.prefix(clearSize), tag = encrypted.suffix(16)
        let box = try AES.GCM.SealedBox(nonce: try nonce(prefix, index), ciphertext: ciphertext, tag: tag)
        var clear = try AES.GCM.open(box, using: key)
        do {
          defer { clear.resetBytes(in: 0..<clear.count) }
          guard clear.count == clearSize else { throw NSError(domain: "FairFaresCrypto", code: 7, userInfo: [NSLocalizedDescriptionKey: "Attachment authentication failed."]) }
          try output.write(contentsOf: clear)
          written += Int64(clear.count)
        }
        progress(operationId, written, plaintextSize)
      }
      let currentOffset = try input.offset()
      let endOffset = try input.seekToEnd()
      guard currentOffset == endOffset, written == plaintextSize else { throw NSError(domain: "FairFaresCrypto", code: 8, userInfo: [NSLocalizedDescriptionKey: "Encrypted attachment size is invalid."]) }
      try checkCancellation(operationId)
      try output.synchronize()
      try input.close()
      try output.close()
      try commit(partial, to: destination)
      return ["outputSize": written, "sha256Base64": ""]
    } catch {
      try? input.close()
      try? output.close()
      try? FileManager.default.removeItem(at: partial)
      throw error
    }
  }
}

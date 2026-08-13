import CryptoKit
import CommonCrypto
import Dispatch
import ExpoModulesCore
import Foundation

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

  private func progress(_ operationId: String, _ completed: Int64, _ total: Int64) {
    sendEvent("onCryptoProgress", ["operationId": operationId, "progress": total > 0 ? Double(completed) / Double(total) : 0])
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

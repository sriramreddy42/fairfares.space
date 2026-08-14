package com.fairfares.crypto

import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.crypto.Mac
import java.util.concurrent.ConcurrentHashMap

class FairFaresCryptoModule : Module() {
  private val cancelledOperations = ConcurrentHashMap.newKeySet<String>()
  private val activeOperations = ConcurrentHashMap.newKeySet<String>()

  override fun definition() = ModuleDefinition {
    Name("FairFaresCrypto")
    Events("onCryptoProgress")

    Function("prepare") { operationId: String -> activeOperations.add(operationId); Unit }
    Function("release") { operationId: String -> cancelledOperations.remove(operationId); activeOperations.remove(operationId); Unit }

    AsyncFunction("encryptFile") { operationId: String, sourceUri: String, destinationUri: String, keyBase64: String, noncePrefixBase64: String, chunkSize: Int ->
      encryptFile(operationId, sourceUri, destinationUri, keyBase64, noncePrefixBase64, chunkSize)
    }

    AsyncFunction("decryptFile") { operationId: String, sourceUri: String, destinationUri: String, keyBase64: String, noncePrefixBase64: String, chunkSize: Int, plaintextSize: Double, chunkCount: Int ->
      decryptFile(operationId, sourceUri, destinationUri, keyBase64, noncePrefixBase64, chunkSize, plaintextSize.toLong(), chunkCount)
    }

    // Android app-private files inherit platform sandbox/data-at-rest
    // protection. Keep API parity with iOS and fail if the durable file was
    // not actually committed.
    AsyncFunction("protectFile") { fileUri: String -> require(file(fileUri).isFile) { "Chitthi media is unavailable for protection." }; Unit }

    AsyncFunction("commitProtectedFile") { sourceUri: String, destinationUri: String ->
      val source = file(sourceUri)
      val destination = file(destinationUri)
      require(source.isFile) { "Chitthi temporary media is unavailable." }
      destination.parentFile?.mkdirs()
      if (destination.exists()) require(destination.delete()) { "Could not replace existing Chitthi media." }
      require(source.renameTo(destination)) { "Could not commit Chitthi media." }
      Unit
    }

    AsyncFunction("appendFile") { sourceUri: String, destinationUri: String, expectedOffset: Double, expectedSize: Double ->
      appendFile(sourceUri, destinationUri, expectedOffset.toLong(), expectedSize.toLong())
    }

    AsyncFunction("sha256File") { fileUri: String, expectedSize: Double ->
      sha256File(fileUri, expectedSize.toLong())
    }

    AsyncFunction("deriveRecoveryKey") { passphraseBase64: String, saltBase64: String, iterations: Int, outputBytes: Int ->
      val passphraseBytes = Base64.decode(passphraseBase64, Base64.DEFAULT)
      val salt = Base64.decode(saltBase64, Base64.DEFAULT)
      require(passphraseBytes.isNotEmpty() && salt.size == 16 && iterations == 210_000 && outputBytes == 32) { "Invalid recovery derivation parameters." }
      try {
        // PBKDF2 block 1 is sufficient for the fixed 32-byte SHA-256 output.
        // Using raw bytes exactly matches noble/CommonCrypto for Unicode input.
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(passphraseBytes, "HmacSHA256"))
        val initial = ByteBuffer.allocate(salt.size + 4).put(salt).putInt(1).array()
        var u = mac.doFinal(initial)
        val derived = u.copyOf()
        initial.fill(0)
        for (index in 1 until iterations) {
          val next = mac.doFinal(u)
          u.fill(0)
          u = next
          for (position in derived.indices) derived[position] = (derived[position].toInt() xor u[position].toInt()).toByte()
        }
        u.fill(0)
        try { Base64.encodeToString(derived, Base64.NO_WRAP) } finally { derived.fill(0) }
      } finally {
        passphraseBytes.fill(0)
        salt.fill(0)
      }
    }

    AsyncFunction("cancel") { operationId: String -> if (activeOperations.contains(operationId)) cancelledOperations.add(operationId); Unit }
  }

  private fun checkCancellation(operationId: String) {
    if (cancelledOperations.contains(operationId)) throw IllegalStateException("Attachment processing was cancelled.")
  }

  private fun progress(operationId: String, completed: Long, total: Long) {
    sendEvent("onCryptoProgress", mapOf("operationId" to operationId, "progress" to if (total > 0) completed.toDouble() / total else 0.0))
  }

  private fun file(uri: String) = File(Uri.parse(uri).path ?: throw IllegalArgumentException("Invalid file URI."))

  private fun inputs(keyBase64: String, noncePrefixBase64: String, chunkSize: Int): Pair<ByteArray, ByteArray> {
    val key = Base64.decode(keyBase64, Base64.DEFAULT)
    val prefix = Base64.decode(noncePrefixBase64, Base64.DEFAULT)
    require(key.size == 32) { "AES-256 requires a 32-byte key." }
    require(prefix.size == 4) { "The native nonce prefix must be 4 bytes." }
    require(chunkSize in 65_536..4_194_304) { "Invalid native crypto chunk size." }
    return Pair(key, prefix)
  }

  private fun nonce(prefix: ByteArray, index: Int): ByteArray = ByteBuffer.allocate(12).put(prefix).putLong(index.toLong()).array()

  private fun readChunk(input: InputStream, requested: Int): ByteArray {
    val buffer = ByteArray(requested)
    var offset = 0
    while (offset < requested) {
      val count = input.read(buffer, offset, requested - offset)
      if (count < 0) break
      if (count == 0) continue
      offset += count
    }
    return if (offset == requested) buffer else buffer.copyOf(offset).also { buffer.fill(0) }
  }

  private fun appendFile(sourceUri: String, destinationUri: String, expectedOffset: Long, expectedSize: Long): Map<String, Any> {
    require(expectedOffset >= 0 && expectedSize in 1..(16L * 1024 * 1024) && expectedOffset <= 120_000_000 - expectedSize) { "Invalid downloaded media range." }
    val source = file(sourceUri)
    val destination = file(destinationUri)
    require(source.canonicalPath != destination.canonicalPath) { "Downloaded media source and destination must be different files." }
    require(source.isFile && source.length() == expectedSize) { "Downloaded media range is incomplete." }
    val destinationSize = if (destination.exists()) destination.length() else 0L
    require(destinationSize == expectedOffset) { "Downloaded media ranges are out of sequence." }
    destination.parentFile?.mkdirs()
    try {
      FileInputStream(source).use { input ->
        FileOutputStream(destination, true).use { output ->
          val buffer = ByteArray(1024 * 1024)
          try {
            var copied = 0L
            while (copied < expectedSize) {
              val count = input.read(buffer, 0, minOf(buffer.size.toLong(), expectedSize - copied).toInt())
              require(count > 0) { "Downloaded media range ended early." }
              output.write(buffer, 0, count)
              copied += count
            }
            output.fd.sync()
          } finally {
            buffer.fill(0)
          }
        }
      }
    } catch (error: Throwable) {
      java.io.RandomAccessFile(destination, "rw").use { it.setLength(expectedOffset) }
      throw error
    }
    return mapOf("outputSize" to destination.length().toDouble())
  }

  private fun sha256File(fileUri: String, expectedSize: Long): Map<String, Any> {
    val source = file(fileUri)
    require(expectedSize in 1..120_000_000 && source.isFile && source.length() == expectedSize) { "Encrypted download size verification failed." }
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(source).use { input ->
      val buffer = ByteArray(1024 * 1024)
      try {
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          if (count > 0) digest.update(buffer, 0, count)
        }
      } finally {
        buffer.fill(0)
      }
    }
    return mapOf("size" to source.length().toDouble(), "sha256Base64" to Base64.encodeToString(digest.digest(), Base64.NO_WRAP))
  }

  private fun encryptFile(operationId: String, sourceUri: String, destinationUri: String, keyBase64: String, noncePrefixBase64: String, chunkSize: Int): Map<String, Any> {
    val (key, prefix) = inputs(keyBase64, noncePrefixBase64, chunkSize)
    val source = file(sourceUri)
    val destination = file(destinationUri)
    val partial = File(destination.path + ".part")
    require(source.isFile && source.length() in 1..100_000_000) { "The selected attachment size is invalid." }
    destination.parentFile?.mkdirs()
    partial.delete()
    val digest = MessageDigest.getInstance("SHA-256")
    try {
      FileInputStream(source).use { input ->
        FileOutputStream(partial, false).use { output ->
          var index = 0
          progress(operationId, 0, source.length())
          while (true) {
            checkCancellation(operationId)
            val buffer = readChunk(input, chunkSize)
            if (buffer.isEmpty()) break
            try {
              val cipher = Cipher.getInstance("AES/GCM/NoPadding")
              cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce(prefix, index)))
              val encrypted = cipher.doFinal(buffer)
              try {
                output.write(encrypted)
                digest.update(encrypted)
                progress(operationId, minOf((index + 1L) * chunkSize.toLong(), source.length()), source.length())
              } finally {
                encrypted.fill(0)
              }
            } finally {
              buffer.fill(0)
            }
            index += 1
          }
          output.fd.sync()
        }
      }
      if (destination.exists()) destination.delete()
      require(partial.renameTo(destination)) { "Could not finalize the encrypted attachment." }
      return mapOf("outputSize" to destination.length().toDouble(), "sha256Base64" to Base64.encodeToString(digest.digest(), Base64.NO_WRAP))
    } catch (error: Throwable) {
      partial.delete()
      throw error
    } finally {
      cancelledOperations.remove(operationId)
      activeOperations.remove(operationId)
      key.fill(0)
      prefix.fill(0)
    }
  }

  private fun decryptFile(operationId: String, sourceUri: String, destinationUri: String, keyBase64: String, noncePrefixBase64: String, chunkSize: Int, plaintextSize: Long, chunkCount: Int): Map<String, Any> {
    val (key, prefix) = inputs(keyBase64, noncePrefixBase64, chunkSize)
    val expectedChunkCount = ((plaintextSize + chunkSize - 1) / chunkSize).toInt()
    require(plaintextSize in 1..100_000_000 && chunkCount == expectedChunkCount) { "Invalid encrypted attachment descriptor." }
    val source = file(sourceUri)
    val destination = file(destinationUri)
    val partial = File(destination.path + ".part")
    require(source.isFile) { "Encrypted attachment is unavailable." }
    destination.parentFile?.mkdirs()
    var written = 0L
    try {
      partial.delete()
      FileInputStream(source).use { input ->
        FileOutputStream(partial, false).use { output ->
          progress(operationId, 0, plaintextSize)
          for (index in 0 until chunkCount) {
            checkCancellation(operationId)
            val clearSize = minOf(chunkSize.toLong(), plaintextSize - index.toLong() * chunkSize).toInt()
            require(clearSize > 0) { "Invalid encrypted attachment chunk." }
            val encrypted = readChunk(input, clearSize + 16)
            require(encrypted.size == clearSize + 16) { "Encrypted attachment ended early." }
            try {
              val cipher = Cipher.getInstance("AES/GCM/NoPadding")
              cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce(prefix, index)))
              val clear = cipher.doFinal(encrypted)
              try {
                require(clear.size == clearSize) { "Attachment authentication failed." }
                output.write(clear)
                written += clear.size
                progress(operationId, written, plaintextSize)
              } finally {
                clear.fill(0)
              }
            } finally {
              encrypted.fill(0)
            }
          }
          require(input.read() == -1 && written == plaintextSize) { "Encrypted attachment size is invalid." }
          output.fd.sync()
        }
      }
      if (destination.exists()) destination.delete()
      require(partial.renameTo(destination)) { "Could not finalize the decrypted attachment." }
      return mapOf("outputSize" to written.toDouble(), "sha256Base64" to "")
    } catch (error: Throwable) {
      partial.delete()
      throw error
    } finally {
      cancelledOperations.remove(operationId)
      activeOperations.remove(operationId)
      key.fill(0)
      prefix.fill(0)
    }
  }
}

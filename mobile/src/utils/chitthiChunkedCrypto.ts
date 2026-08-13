import { File, Paths } from "expo-file-system";
import nacl from "tweetnacl";
import * as util from "tweetnacl-util";
import { sha256 } from "@noble/hashes/sha256";
import { ConversationDeviceKey, DeviceIdentity, encryptForDevices } from "./chatCrypto";

export const CHITTHI_CHUNK_SIZE = 256 * 1024;
export const CHITTHI_CHUNK_FORMAT = "CHUNKED_SECRETBOX_V2";

type AttachmentMetadata = {
  fileName: string;
  mimeType: string;
  caption: string;
  kind: "IMAGE" | "VIDEO" | "FILE";
  [key: string]: unknown;
};

export type ChunkedAttachmentDescriptor = AttachmentMetadata & {
  v: 2;
  type: "ATTACHMENT";
  format: typeof CHITTHI_CHUNK_FORMAT;
  key: string;
  noncePrefix: string;
  chunkSize: number;
  chunkCount: number;
  plaintextSize: number;
};

function chunkNonce(prefix: Uint8Array, index: number) {
  if (prefix.byteLength !== 16 || !Number.isSafeInteger(index) || index < 0) throw new Error("Invalid Chitthi chunk nonce.");
  const nonce = new Uint8Array(nacl.secretbox.nonceLength);
  nonce.set(prefix, 0);
  let value = index;
  for (let position = 23; position >= 16; position -= 1) {
    nonce[position] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return nonce;
}

export function parseChunkedAttachmentDescriptor(value: string): ChunkedAttachmentDescriptor | null {
  try {
    const descriptor = JSON.parse(value) as ChunkedAttachmentDescriptor;
    if (descriptor.v !== 2 || descriptor.type !== "ATTACHMENT" || descriptor.format !== CHITTHI_CHUNK_FORMAT) return null;
    if (!Number.isSafeInteger(descriptor.chunkSize) || descriptor.chunkSize <= 0 || descriptor.chunkSize > 4 * 1024 * 1024) return null;
    if (!Number.isSafeInteger(descriptor.chunkCount) || descriptor.chunkCount <= 0) return null;
    if (!Number.isSafeInteger(descriptor.plaintextSize) || descriptor.plaintextSize <= 0) return null;
    if (util.decodeBase64(descriptor.key).byteLength !== nacl.secretbox.keyLength || util.decodeBase64(descriptor.noncePrefix).byteLength !== 16) return null;
    return descriptor;
  } catch {
    return null;
  }
}

export function expectedChunkedCiphertextSize(descriptor: Pick<ChunkedAttachmentDescriptor, "plaintextSize" | "chunkCount">) {
  return descriptor.plaintextSize + descriptor.chunkCount * nacl.secretbox.overheadLength;
}

export function deleteChunkedTemporaryFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best-effort after the upload completes or fails.
  }
}

function yieldToUiThread(throttleMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, Math.min(100, throttleMs))));
}

export async function encryptAttachmentFileForDevices(
  sourceUri: string,
  metadata: AttachmentMetadata,
  identity: DeviceIdentity,
  keys: ConversationDeviceKey[],
  onProgress?: (progress: number) => void,
  throttleMs = 10
) {
  const source = new File(sourceUri);
  if (!source.exists || source.size <= 0) throw new Error("The selected attachment is empty.");
  const output = new File(Paths.cache, `chitthi-${Date.now()}-${Math.random().toString(36).slice(2)}.ffenc2`);
  output.create({ overwrite: true, intermediates: true });
  const fileKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const noncePrefix = nacl.randomBytes(16);
  const chunkCount = Math.ceil(source.size / CHITTHI_CHUNK_SIZE);
  const digest = sha256.create();
  let lastReportedPercent = -1;
  const reader = source.open();
  const writer = output.open();
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const clearChunk = reader.readBytes(Math.min(CHITTHI_CHUNK_SIZE, source.size - index * CHITTHI_CHUNK_SIZE));
      if (!clearChunk.byteLength) throw new Error("The attachment ended before encryption completed.");
      const encryptedChunk = nacl.secretbox(clearChunk, chunkNonce(noncePrefix, index), fileKey);
      writer.writeBytes(encryptedChunk);
      digest.update(encryptedChunk);
      clearChunk.fill(0);
      encryptedChunk.fill(0);
      const percent = Math.floor(((index + 1) / chunkCount) * 100);
      if (percent === 100 || percent >= lastReportedPercent + 5) {
        lastReportedPercent = percent;
        onProgress?.(percent / 100);
      }
      // File reads and NaCl are synchronous HostFunctions. Yield after each
      // bounded chunk so React Native can draw, process touches, and satisfy
      // the iOS main-thread watchdog during large attachment encryption.
      if (index + 1 < chunkCount) await yieldToUiThread(throttleMs);
    }
  } catch (error) {
    deleteChunkedTemporaryFile(output.uri);
    throw error;
  } finally {
    reader.close();
    writer.close();
  }
  const descriptor: ChunkedAttachmentDescriptor = {
    ...metadata,
    v: 2,
    type: "ATTACHMENT",
    format: CHITTHI_CHUNK_FORMAT,
    key: util.encodeBase64(fileKey),
    noncePrefix: util.encodeBase64(noncePrefix),
    chunkSize: CHITTHI_CHUNK_SIZE,
    chunkCount,
    plaintextSize: source.size,
  };
  fileKey.fill(0);
  const preview = metadata.caption.trim() || (metadata.kind === "IMAGE" ? "Sent a photo" : metadata.kind === "VIDEO" ? "Sent a video" : `Sent a file: ${metadata.fileName}`);
  return {
    encryptedUri: output.uri,
    encryptedSize: output.size,
    ciphertextSha256: util.encodeBase64(digest.digest()),
    envelopes: encryptForDevices(JSON.stringify(descriptor), identity, keys, preview),
  };
}

export async function decryptChunkedAttachmentFile(
  encryptedUri: string,
  destinationUri: string,
  descriptorValue: string,
  onProgress?: (progress: number) => void
) {
  const descriptor = parseChunkedAttachmentDescriptor(descriptorValue);
  if (!descriptor) throw new Error("The chunked attachment descriptor is invalid.");
  const encrypted = new File(encryptedUri);
  if (!encrypted.exists || encrypted.size !== expectedChunkedCiphertextSize(descriptor)) throw new Error("The encrypted attachment size is invalid.");
  const destination = new File(destinationUri);
  destination.parentDirectory.create({ idempotent: true, intermediates: true });
  const partial = new File(`${destinationUri}.part`);
  partial.create({ overwrite: true, intermediates: true });
  const reader = encrypted.open();
  const writer = partial.open();
  const fileKey = util.decodeBase64(descriptor.key);
  const noncePrefix = util.decodeBase64(descriptor.noncePrefix);
  try {
    for (let index = 0; index < descriptor.chunkCount; index += 1) {
      const clearSize = Math.min(descriptor.chunkSize, descriptor.plaintextSize - index * descriptor.chunkSize);
      const encryptedChunk = reader.readBytes(clearSize + nacl.secretbox.overheadLength);
      const clearChunk = nacl.secretbox.open(encryptedChunk, chunkNonce(noncePrefix, index), fileKey);
      if (!clearChunk || clearChunk.byteLength !== clearSize) throw new Error(`Attachment authentication failed at chunk ${index + 1}.`);
      writer.writeBytes(clearChunk);
      clearChunk.fill(0);
      onProgress?.((index + 1) / descriptor.chunkCount);
      // Authentication is synchronous in TweetNaCl. Yield between bounded
      // chunks so taps, progress, and animations are never frozen by decrypt.
      if (index + 1 < descriptor.chunkCount) await yieldToUiThread(0);
    }
  } catch (error) {
    try { partial.delete(); } catch { /* best effort */ }
    throw error;
  } finally {
    fileKey.fill(0);
    reader.close();
    writer.close();
  }
  if (destination.exists) destination.delete();
  partial.move(destination);
  if (!destination.exists || destination.size !== descriptor.plaintextSize) throw new Error("The decrypted attachment was not stored completely.");
  return destination.uri;
}

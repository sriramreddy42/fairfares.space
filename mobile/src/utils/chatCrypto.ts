import "react-native-get-random-values";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import nacl from "tweetnacl";
import * as util from "tweetnacl-util";
import { FairFaresCrypto } from "../../modules/fairfares-crypto/src";
import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { gcm } from "@noble/ciphers/aes";

export type DeviceIdentity = { deviceId: string; publicKey: string; secretKey: string; signingPublicKey: string; signingSecretKey: string };
export type ConversationDeviceKey = { userId: number; deviceId: string; publicKey: string };

const keyName = (userId: number) => `fairfares.chitthi.e2ee.${userId}`;
const legacyKeyName = (userId: number) => `fairfares.fchat.e2ee.${userId}`;
const notificationAccessGroup = "9RVTF77D2S.com.fairfares.mobile.shared";
const notificationKeychainService = "fairfares-chitthi-notification";
const legacyNotificationKeychainService = "fairfares-fchat-notification";
const secureOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } as const;
const sharedSecureOptions = { ...secureOptions, accessGroup: notificationAccessGroup, keychainService: notificationKeychainService } as const;
const legacySharedSecureOptions = { ...secureOptions, accessGroup: notificationAccessGroup, keychainService: legacyNotificationKeychainService } as const;

type SecureReadResult = { value: string | null; error: unknown };

async function tryReadSecureIdentity(name: string, options: typeof secureOptions | typeof sharedSecureOptions): Promise<SecureReadResult> {
  try {
    return { value: await SecureStore.getItemAsync(name, options), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

async function readSecureIdentity(userId: number): Promise<string | null> {
  const name = keyName(userId);
  const legacyName = legacyKeyName(userId);
  if (Platform.OS === "ios") {
    // Older FairFares builds stored this identity in the app's default
    // Keychain group. New builds also mirror it into the notification
    // extension's shared group. Read each independently because iOS throws
    // errSecMissingEntitlement when a currently installed provisioning
    // profile does not contain one of those groups.
    const shared = await tryReadSecureIdentity(name, sharedSecureOptions);
    if (shared.value) return shared.value;

    const app = await tryReadSecureIdentity(name, secureOptions);
    if (app.value) return app.value;
    const legacyShared = await tryReadSecureIdentity(legacyName, legacySharedSecureOptions);
    if (legacyShared.value) return legacyShared.value;

    const legacyApp = await tryReadSecureIdentity(legacyName, secureOptions);
    if (legacyApp.value) return legacyApp.value;
    if (shared.error && app.error && legacyShared.error && legacyApp.error) {
      throw new Error("Secure Chitthi storage is unavailable. Install the latest FairFares build and try again.");
    }
    return null;
  }
  const app = await tryReadSecureIdentity(name, secureOptions);
  if (app.error) throw app.error;
  if (app.value) return app.value;
  const legacyApp = await tryReadSecureIdentity(legacyName, secureOptions);
  if (legacyApp.error) throw legacyApp.error;
  return legacyApp.value;
}

async function writeSecureIdentity(userId: number, serialized: string): Promise<void> {
  const name = keyName(userId);
  let appStored = false;
  let sharedStored = false;
  try {
    await SecureStore.setItemAsync(name, serialized, secureOptions);
    appStored = true;
  } catch {
    // A shared-group write below can still safely persist the key on iOS.
  }
  if (Platform.OS === "ios") {
    try {
      await SecureStore.setItemAsync(name, serialized, sharedSecureOptions);
      sharedStored = true;
    } catch {
      // Do not fall back to unencrypted AsyncStorage for private keys.
    }
  }
  if (!appStored && !(Platform.OS === "ios" && sharedStored)) {
    throw new Error("Secure Chitthi storage is unavailable. Install the latest FairFares build and try again.");
  }
}

async function persistIdentity(userId: number, identity: DeviceIdentity) {
  if (Platform.OS === "web") return AsyncStorage.setItem(keyName(userId), JSON.stringify(identity));
  await writeSecureIdentity(userId, JSON.stringify(identity));
}

function isDeviceIdentity(value: unknown): value is DeviceIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<DeviceIdentity>;
  if (typeof identity.deviceId !== "string" || !identity.deviceId || identity.deviceId.length > 200) return false;
  try {
    if (typeof identity.publicKey !== "string" || util.decodeBase64(identity.publicKey).byteLength !== nacl.box.publicKeyLength) return false;
    if (typeof identity.secretKey !== "string" || util.decodeBase64(identity.secretKey).byteLength !== nacl.box.secretKeyLength) return false;
    const hasSigningPublicKey = typeof identity.signingPublicKey === "string" && identity.signingPublicKey.length > 0;
    const hasSigningSecretKey = typeof identity.signingSecretKey === "string" && identity.signingSecretKey.length > 0;
    if (hasSigningPublicKey !== hasSigningSecretKey) return false;
    if (hasSigningPublicKey) {
      if (util.decodeBase64(identity.signingPublicKey!).byteLength !== nacl.sign.publicKeyLength) return false;
      if (util.decodeBase64(identity.signingSecretKey!).byteLength !== nacl.sign.secretKeyLength) return false;
      const derivedSigningPublicKey = util.encodeBase64(nacl.sign.keyPair.fromSecretKey(util.decodeBase64(identity.signingSecretKey!)).publicKey);
      if (derivedSigningPublicKey !== identity.signingPublicKey) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function getStoredDeviceIdentity(userId: number): Promise<DeviceIdentity | null> {
  const existing = Platform.OS === "web"
    ? (await AsyncStorage.getItem(keyName(userId))) || (await AsyncStorage.getItem(legacyKeyName(userId)))
    : await readSecureIdentity(userId);
  if (!existing) return null;
  let identity: DeviceIdentity;
  try {
    const parsed: unknown = JSON.parse(existing);
    if (!isDeviceIdentity(parsed)) throw new Error("invalid identity shape");
    identity = parsed;
  } catch {
    throw new Error("The secure Chitthi identity on this device is invalid. Recover your key backup before sending messages.");
  }
  if (identity.signingPublicKey && identity.signingSecretKey) {
    // Migrates identities created by older builds into the notification
    // extension's shared Keychain group on first launch after upgrading.
    await persistIdentity(userId, identity);
    return identity;
  }
  const signingPair = nacl.sign.keyPair();
  const upgraded = { ...identity, signingPublicKey: util.encodeBase64(signingPair.publicKey), signingSecretKey: util.encodeBase64(signingPair.secretKey) };
  await persistIdentity(userId, upgraded);
  return upgraded;
}

export function contactDiscoveryHash(phone: string) {
  const normalized = phone.replace(/\D/g, "");
  return Array.from(sha256(util.decodeUTF8(normalized)), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function contactDiscoveryVariants(phone: string) {
  const normalized = phone.replace(/\D/g, "");
  if (normalized.length < 8 || normalized.length > 15) return [];
  // Contact books and FairFares profiles do not always store country codes in
  // the same form. Include plausible 8-10 digit national suffixes without
  // assuming a particular country.
  const variants = new Set([normalized]);
  for (let length = 8; length <= Math.min(10, normalized.length); length += 1) {
    variants.add(normalized.slice(-length));
  }
  return Array.from(variants);
}

export async function getOrCreateDeviceIdentity(userId: number): Promise<DeviceIdentity> {
  const existing = await getStoredDeviceIdentity(userId);
  if (existing) return existing;
  const pair = nacl.box.keyPair();
  const signingPair = nacl.sign.keyPair();
  const identity = {
    deviceId: `${Date.now().toString(36)}-${util.encodeBase64(nacl.randomBytes(12)).replace(/[^A-Za-z0-9]/g, "")}`,
    publicKey: util.encodeBase64(pair.publicKey),
    secretKey: util.encodeBase64(pair.secretKey),
    signingPublicKey: util.encodeBase64(signingPair.publicKey),
    signingSecretKey: util.encodeBase64(signingPair.secretKey)
  };
  await persistIdentity(userId, identity);
  return identity;
}

async function deriveRecoveryKey(passphrase: string, salt: Uint8Array) {
  const passphraseBytes = util.decodeUTF8(passphrase);
  try {
    return FairFaresCrypto.available
      ? util.decodeBase64(await FairFaresCrypto.deriveRecoveryKey(util.encodeBase64(passphraseBytes), util.encodeBase64(salt), 210_000, nacl.secretbox.keyLength))
      : await deriveRecoveryKeyWithFrameYields(passphraseBytes, salt);
  } finally {
    passphraseBytes.fill(0);
  }
}

async function deriveRecoveryKeyWithFrameYields(password: Uint8Array, salt: Uint8Array) {
  // RFC 8018 PBKDF2-HMAC-SHA256. The 32-byte output is exactly one SHA-256
  // block. Noble's pbkdf2Async yields only to the Promise microtask queue,
  // which still starves React Native/Hermes rendering. A native timer yield
  // gives UI events and frames a genuine scheduling opportunity in Expo Go.
  const iterations = 210_000;
  const saltBlock = new Uint8Array(salt.byteLength + 4);
  saltBlock.set(salt);
  saltBlock.set([0, 0, 0, 1], salt.byteLength);
  const prf = hmac.create(sha256, password);
  let working: ReturnType<typeof hmac.create> | undefined;
  const u = new Uint8Array(sha256.outputLen);
  const derived = new Uint8Array(sha256.outputLen);
  try {
    (working = prf._cloneInto(working)).update(saltBlock).digestInto(u);
    derived.set(u);
    let frameStartedAt = Date.now();
    for (let index = 1; index < iterations; index += 1) {
      (working = prf._cloneInto(working)).update(u).digestInto(u);
      for (let byte = 0; byte < derived.byteLength; byte += 1) derived[byte] ^= u[byte];
      if (Date.now() - frameStartedAt >= 4) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        frameStartedAt = Date.now();
      }
    }
    return derived;
  } catch (error) {
    derived.fill(0);
    throw error;
  } finally {
    prf.destroy();
    working?.destroy();
    saltBlock.fill(0);
    u.fill(0);
  }
}

export async function createEncryptedIdentityBackup(identity: DeviceIdentity, passphrase: string) {
  if (passphrase.length < 10) throw new Error("Use a recovery passphrase with at least 10 characters.");
  const salt = nacl.randomBytes(16);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = await deriveRecoveryKey(passphrase, salt);
  const plaintext = util.decodeUTF8(JSON.stringify(identity));
  try {
    const ciphertext = nacl.secretbox(plaintext, nonce, key);
    return JSON.stringify({ v: 1, salt: util.encodeBase64(salt), nonce: util.encodeBase64(nonce), ciphertext: util.encodeBase64(ciphertext) });
  } finally {
    plaintext.fill(0);
    key.fill(0);
  }
}

export async function restoreEncryptedIdentityBackup(userId: number, encryptedPayload: string, passphrase: string, persist = true) {
  const payload = JSON.parse(encryptedPayload) as { v?: number; salt: string; nonce: string; ciphertext: string };
  if (payload.v !== 1) throw new Error("This Chitthi recovery backup version is unsupported.");
  const salt = util.decodeBase64(payload.salt);
  const nonce = util.decodeBase64(payload.nonce);
  if (salt.byteLength !== 16 || nonce.byteLength !== nacl.secretbox.nonceLength) throw new Error("The Chitthi recovery backup is malformed.");
  const key = await deriveRecoveryKey(passphrase, salt);
  let opened: Uint8Array | null = null;
  try {
    opened = nacl.secretbox.open(util.decodeBase64(payload.ciphertext), nonce, key);
    if (!opened) throw new Error("The recovery passphrase is incorrect.");
    let identity = JSON.parse(util.encodeUTF8(opened)) as DeviceIdentity;
    if (!isDeviceIdentity(identity)) throw new Error("The recovery backup failed identity validation.");
    const derivedPublicKey = util.encodeBase64(nacl.box.keyPair.fromSecretKey(util.decodeBase64(identity.secretKey)).publicKey);
    if (derivedPublicKey !== identity.publicKey) throw new Error("The recovery backup failed integrity verification.");
    if (!identity.signingPublicKey || !identity.signingSecretKey) {
      const signingPair = nacl.sign.keyPair();
      identity = { ...identity, signingPublicKey: util.encodeBase64(signingPair.publicKey), signingSecretKey: util.encodeBase64(signingPair.secretKey) };
    }
    if (persist) await persistIdentity(userId, identity);
    return identity;
  } finally {
    opened?.fill(0);
    key.fill(0);
  }
}

export function encryptionFingerprint(keys: ConversationDeviceKey[]) {
  const canonical = keys.map((key) => `${key.userId}:${key.deviceId}:${key.publicKey}`).sort().join("|");
  const digest = sha256(util.decodeUTF8(canonical));
  return Array.from(digest.slice(0, 15)).map((byte) => byte.toString(16).padStart(2, "0")).join("").match(/.{1,5}/g)?.join(" ") || "";
}

export function encryptForDevices(text: string, identity: DeviceIdentity, keys: ConversationDeviceKey[], notificationText = text) {
  const secretKey = util.decodeBase64(identity.secretKey);
  return keys.map((key) => {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ciphertext = nacl.box(util.decodeUTF8(text), nonce, util.decodeBase64(key.publicKey), secretKey);
    const previewNonce = nacl.randomBytes(12);
    // Use raw X25519 here (not nacl.box.before, which additionally applies
    // HSalsa20) so Apple's CryptoKit extension derives the identical secret.
    const shared = nacl.scalarMult(secretKey, util.decodeBase64(key.publicKey));
    const previewKey = sha256(new Uint8Array([...util.decodeUTF8("FairFares Chitthi notification preview v1"), ...shared]));
    const previewCiphertext = chacha20poly1305(previewKey, previewNonce).encrypt(util.decodeUTF8(notificationText.slice(0, 240)));
    return {
      recipientUserId: key.userId,
      recipientDeviceId: key.deviceId,
      senderPublicKey: identity.publicKey,
      nonce: util.encodeBase64(nonce),
      ciphertext: util.encodeBase64(ciphertext),
      previewNonce: util.encodeBase64(previewNonce),
      previewCiphertext: util.encodeBase64(previewCiphertext)
    };
  });
}

export function decryptEnvelope(envelope: { senderPublicKey: string; nonce: string; ciphertext: string }, identity: DeviceIdentity) {
  const ciphertext = util.decodeBase64(envelope.ciphertext);
  const nonce = util.decodeBase64(envelope.nonce);
  const senderPublicKey = util.decodeBase64(envelope.senderPublicKey);
  const secretKey = util.decodeBase64(identity.secretKey);
  let opened: Uint8Array | null = null;
  try {
    opened = nacl.box.open(ciphertext, nonce, senderPublicKey, secretKey);
    return opened ? util.encodeUTF8(opened) : "";
  } finally {
    // Pagination can authenticate many historical envelopes in one session.
    // Do not wait for Hermes GC to reclaim duplicate ciphertext/key buffers.
    ciphertext.fill(0);
    nonce.fill(0);
    senderPublicKey.fill(0);
    secretKey.fill(0);
    opened?.fill(0);
  }
}

export function encryptAttachmentForDevices(
  fileBase64: string,
  metadata: { fileName: string; mimeType: string; caption: string; kind: "IMAGE" | "VIDEO" | "FILE"; forwarded?: boolean },
  identity: DeviceIdentity,
  keys: ConversationDeviceKey[]
) {
  const fileKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const fileNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(util.decodeBase64(fileBase64), fileNonce, fileKey);
  const keyPayload = JSON.stringify({
    v: 1, type: "ATTACHMENT", key: util.encodeBase64(fileKey), nonce: util.encodeBase64(fileNonce), ...metadata
  });
  const preview = metadata.caption.trim() || (metadata.kind === "IMAGE" ? "Sent a photo" : metadata.kind === "VIDEO" ? "Sent a video" : `Sent a file: ${metadata.fileName}`);
  return {
    ciphertextBase64: util.encodeBase64(ciphertext),
    ciphertextSha256: util.encodeBase64(sha256(ciphertext)),
    encryptedSize: ciphertext.byteLength,
    envelopes: encryptForDevices(keyPayload, identity, keys, preview)
  };
}

export function decryptAttachmentBase64(ciphertextBase64: string, keyPayload: string) {
  const payload = JSON.parse(keyPayload) as { v?: number; format?: string; key: string; nonce: string; noncePrefix?: string; chunkSize?: number; chunkCount?: number; plaintextSize?: number; fileName: string; mimeType: string; caption: string; kind: "IMAGE" | "VIDEO" | "FILE" };
  if (payload.v === 3 && payload.format === "CHUNKED_AES_GCM_V3") {
    const key = util.decodeBase64(payload.key);
    const prefix = util.decodeBase64(payload.noncePrefix || "");
    const ciphertext = util.decodeBase64(ciphertextBase64);
    const chunkSize = Number(payload.chunkSize || 0);
    const chunkCount = Number(payload.chunkCount || 0);
    const plaintextSize = Number(payload.plaintextSize || 0);
    if (key.byteLength !== 32 || prefix.byteLength !== 4 || !Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > 4 * 1024 * 1024 || !Number.isSafeInteger(chunkCount) || chunkCount <= 0 || !Number.isSafeInteger(plaintextSize) || plaintextSize <= 0 || plaintextSize > 100_000_000 || chunkCount !== Math.ceil(plaintextSize / chunkSize) || ciphertext.byteLength !== plaintextSize + chunkCount * 16) {
      throw new Error("The encrypted attachment descriptor is invalid.");
    }
    const plaintext = new Uint8Array(plaintextSize);
    let encryptedOffset = 0;
    let clearOffset = 0;
    try {
      for (let index = 0; index < chunkCount; index += 1) {
        const clearSize = Math.min(chunkSize, plaintextSize - clearOffset);
        const nonce = new Uint8Array(12);
        nonce.set(prefix);
        let counter = index;
        for (let position = 11; position >= 4; position -= 1) {
          nonce[position] = counter & 0xff;
          counter = Math.floor(counter / 256);
        }
        const encryptedChunk = ciphertext.subarray(encryptedOffset, encryptedOffset + clearSize + 16);
        const clearChunk = gcm(key, nonce).decrypt(encryptedChunk);
        if (clearChunk.byteLength !== clearSize) throw new Error("Attachment authentication failed.");
        plaintext.set(clearChunk, clearOffset);
        clearChunk.fill(0);
        encryptedOffset += clearSize + 16;
        clearOffset += clearSize;
      }
      return { ...payload, base64: util.encodeBase64(plaintext) };
    } finally {
      key.fill(0);
      ciphertext.fill(0);
      plaintext.fill(0);
    }
  }
  const opened = nacl.secretbox.open(util.decodeBase64(ciphertextBase64), util.decodeBase64(payload.nonce), util.decodeBase64(payload.key));
  if (!opened) throw new Error("Attachment authentication failed.");
  return { ...payload, base64: util.encodeBase64(opened) };
}

import "react-native-get-random-values";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import nacl from "tweetnacl";
import * as util from "tweetnacl-util";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";

export type DeviceIdentity = { deviceId: string; publicKey: string; secretKey: string; signingPublicKey: string; signingSecretKey: string };
export type ConversationDeviceKey = { userId: number; deviceId: string; publicKey: string };

const keyName = (userId: number) => `fairfares.fchat.e2ee.${userId}`;
const notificationAccessGroup = "9RVTF77D2S.com.fairfares.mobile.shared";
const notificationKeychainService = "fairfares-fchat-notification";
const secureOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } as const;
const sharedSecureOptions = { ...secureOptions, accessGroup: notificationAccessGroup, keychainService: notificationKeychainService } as const;

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
    if (shared.error && app.error) {
      throw new Error("Secure FChat storage is unavailable. Install the latest FairFares build and try again.");
    }
    return null;
  }
  const app = await tryReadSecureIdentity(name, secureOptions);
  if (app.error) throw app.error;
  return app.value;
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
    throw new Error("Secure FChat storage is unavailable. Install the latest FairFares build and try again.");
  }
}

async function persistIdentity(userId: number, identity: DeviceIdentity) {
  if (Platform.OS === "web") return AsyncStorage.setItem(keyName(userId), JSON.stringify(identity));
  await writeSecureIdentity(userId, JSON.stringify(identity));
}

function isDeviceIdentity(value: unknown): value is DeviceIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<DeviceIdentity>;
  return [identity.deviceId, identity.publicKey, identity.secretKey]
    .every((part) => typeof part === "string" && part.length > 0);
}

export async function getStoredDeviceIdentity(userId: number): Promise<DeviceIdentity | null> {
  const existing = Platform.OS === "web"
    ? await AsyncStorage.getItem(keyName(userId))
    : await readSecureIdentity(userId);
  if (!existing) return null;
  let identity: DeviceIdentity;
  try {
    const parsed: unknown = JSON.parse(existing);
    if (!isDeviceIdentity(parsed)) throw new Error("invalid identity shape");
    identity = parsed;
  } catch {
    throw new Error("The secure FChat identity on this device is invalid. Recover your key backup before sending messages.");
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
  if (normalized.length < 10 || normalized.length > 15) return [];
  // Contact books and FairFares profiles do not always store country codes in
  // the same form. Include the national-number suffix without assuming +1.
  return Array.from(new Set([normalized, normalized.slice(-10)]));
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

export async function createEncryptedIdentityBackup(identity: DeviceIdentity, passphrase: string) {
  if (passphrase.length < 10) throw new Error("Use a recovery passphrase with at least 10 characters.");
  const salt = nacl.randomBytes(16);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = pbkdf2(sha256, util.decodeUTF8(passphrase), salt, { c: 210_000, dkLen: nacl.secretbox.keyLength });
  const ciphertext = nacl.secretbox(util.decodeUTF8(JSON.stringify(identity)), nonce, key);
  return JSON.stringify({ v: 1, salt: util.encodeBase64(salt), nonce: util.encodeBase64(nonce), ciphertext: util.encodeBase64(ciphertext) });
}

export async function restoreEncryptedIdentityBackup(userId: number, encryptedPayload: string, passphrase: string) {
  const payload = JSON.parse(encryptedPayload) as { salt: string; nonce: string; ciphertext: string };
  const key = pbkdf2(sha256, util.decodeUTF8(passphrase), util.decodeBase64(payload.salt), { c: 210_000, dkLen: nacl.secretbox.keyLength });
  const opened = nacl.secretbox.open(util.decodeBase64(payload.ciphertext), util.decodeBase64(payload.nonce), key);
  if (!opened) throw new Error("The recovery passphrase is incorrect.");
  let identity = JSON.parse(util.encodeUTF8(opened)) as DeviceIdentity;
  const derivedPublicKey = util.encodeBase64(nacl.box.keyPair.fromSecretKey(util.decodeBase64(identity.secretKey)).publicKey);
  if (derivedPublicKey !== identity.publicKey) throw new Error("The recovery backup failed integrity verification.");
  if (!identity.signingPublicKey || !identity.signingSecretKey) {
    const signingPair = nacl.sign.keyPair();
    identity = { ...identity, signingPublicKey: util.encodeBase64(signingPair.publicKey), signingSecretKey: util.encodeBase64(signingPair.secretKey) };
  }
  await persistIdentity(userId, identity);
  return identity;
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
    const previewKey = sha256(new Uint8Array([...util.decodeUTF8("FairFares FChat notification preview v1"), ...shared]));
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
  const opened = nacl.box.open(
    util.decodeBase64(envelope.ciphertext), util.decodeBase64(envelope.nonce),
    util.decodeBase64(envelope.senderPublicKey), util.decodeBase64(identity.secretKey)
  );
  return opened ? util.encodeUTF8(opened) : "";
}

export function encryptAttachmentForDevices(
  fileBase64: string,
  metadata: { fileName: string; mimeType: string; caption: string; kind: "IMAGE" | "VIDEO" | "FILE" },
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
  return { ciphertextBase64: util.encodeBase64(ciphertext), envelopes: encryptForDevices(keyPayload, identity, keys, preview) };
}

export function decryptAttachmentBase64(ciphertextBase64: string, keyPayload: string) {
  const payload = JSON.parse(keyPayload) as { key: string; nonce: string; fileName: string; mimeType: string; caption: string; kind: "IMAGE" | "VIDEO" | "FILE" };
  const opened = nacl.secretbox.open(util.decodeBase64(ciphertextBase64), util.decodeBase64(payload.nonce), util.decodeBase64(payload.key));
  if (!opened) throw new Error("Attachment authentication failed.");
  return { ...payload, base64: util.encodeBase64(opened) };
}

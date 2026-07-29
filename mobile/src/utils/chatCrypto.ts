import * as SecureStore from "expo-secure-store";
import nacl from "tweetnacl";
import * as util from "tweetnacl-util";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";

export type DeviceIdentity = { deviceId: string; publicKey: string; secretKey: string };
export type ConversationDeviceKey = { userId: number; deviceId: string; publicKey: string };

const keyName = (userId: number) => `fairfares.fchat.e2ee.${userId}`;

export async function getStoredDeviceIdentity(userId: number): Promise<DeviceIdentity | null> {
  const existing = await SecureStore.getItemAsync(keyName(userId));
  return existing ? JSON.parse(existing) as DeviceIdentity : null;
}

export function contactDiscoveryHash(phone: string) {
  const normalized = phone.replace(/\D/g, "");
  return Array.from(sha256(util.decodeUTF8(normalized)), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function getOrCreateDeviceIdentity(userId: number): Promise<DeviceIdentity> {
  const existing = await getStoredDeviceIdentity(userId);
  if (existing) return existing;
  const pair = nacl.box.keyPair();
  const identity = {
    deviceId: `${Date.now().toString(36)}-${util.encodeBase64(nacl.randomBytes(12)).replace(/[^A-Za-z0-9]/g, "")}`,
    publicKey: util.encodeBase64(pair.publicKey),
    secretKey: util.encodeBase64(pair.secretKey)
  };
  await SecureStore.setItemAsync(keyName(userId), JSON.stringify(identity), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
  });
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
  const identity = JSON.parse(util.encodeUTF8(opened)) as DeviceIdentity;
  const derivedPublicKey = util.encodeBase64(nacl.box.keyPair.fromSecretKey(util.decodeBase64(identity.secretKey)).publicKey);
  if (derivedPublicKey !== identity.publicKey) throw new Error("The recovery backup failed integrity verification.");
  await SecureStore.setItemAsync(keyName(userId), JSON.stringify(identity), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return identity;
}

export function encryptionFingerprint(keys: ConversationDeviceKey[]) {
  const canonical = keys.map((key) => `${key.userId}:${key.deviceId}:${key.publicKey}`).sort().join("|");
  const digest = sha256(util.decodeUTF8(canonical));
  return Array.from(digest.slice(0, 15)).map((byte) => byte.toString(16).padStart(2, "0")).join("").match(/.{1,5}/g)?.join(" ") || "";
}

export function encryptForDevices(text: string, identity: DeviceIdentity, keys: ConversationDeviceKey[]) {
  const secretKey = util.decodeBase64(identity.secretKey);
  return keys.map((key) => {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ciphertext = nacl.box(util.decodeUTF8(text), nonce, util.decodeBase64(key.publicKey), secretKey);
    return {
      recipientUserId: key.userId,
      recipientDeviceId: key.deviceId,
      senderPublicKey: identity.publicKey,
      nonce: util.encodeBase64(nonce),
      ciphertext: util.encodeBase64(ciphertext)
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
  return { ciphertextBase64: util.encodeBase64(ciphertext), envelopes: encryptForDevices(keyPayload, identity, keys) };
}

export function decryptAttachmentBase64(ciphertextBase64: string, keyPayload: string) {
  const payload = JSON.parse(keyPayload) as { key: string; nonce: string; fileName: string; mimeType: string; caption: string; kind: "IMAGE" | "VIDEO" | "FILE" };
  const opened = nacl.secretbox.open(util.decodeBase64(ciphertextBase64), util.decodeBase64(payload.nonce), util.decodeBase64(payload.key));
  if (!opened) throw new Error("Attachment authentication failed.");
  return { ...payload, base64: util.encodeBase64(opened) };
}

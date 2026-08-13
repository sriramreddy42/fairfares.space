import { Platform } from "react-native";
import { getChatKeyBackup, registerChatDeviceKey, saveChatKeyBackup } from "../api/client";
import { createEncryptedIdentityBackup, getOrCreateDeviceIdentity, getStoredDeviceIdentity, restoreEncryptedIdentityBackup } from "./chatCrypto";

const pendingRecoveryByUser = new Map<number, Promise<void>>();
const recoveryErrorByUser = new Map<number, string>();

function accountRecoveryPassphrase(password: string) {
  return `FairFares account recovery:${password}`;
}

/**
 * Keeps the native Chitthi identity recoverable with the user's account password.
 * The password and unencrypted key never leave the device.
 */
export async function syncChatIdentityRecovery(userId: number, password: string) {
  if (Platform.OS === "web" || !userId || !password) return;
  const wrappingPassphrase = accountRecoveryPassphrase(password);
  const backup = await getChatKeyBackup();
  // The authenticated account backup is authoritative. A fresh installation
  // can briefly create a local identity while login recovery is starting; if
  // that temporary key wins, historical envelopes cannot be decrypted.
  const identity = backup.encryptedPayload
    ? await restoreEncryptedIdentityBackup(userId, backup.encryptedPayload, wrappingPassphrase)
    : (await getStoredDeviceIdentity(userId)) || await getOrCreateDeviceIdentity(userId);
  await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
  // PBKDF2 is deliberately expensive and runs on the JavaScript thread. Do
  // not repeat it on every login when this account already has a recoverable
  // key backup; that previously made the newly authenticated UI appear hung.
  if (!backup.encryptedPayload) {
    const encryptedPayload = await createEncryptedIdentityBackup(identity, wrappingPassphrase);
    await saveChatKeyBackup(encryptedPayload);
  }
}

export function beginChatIdentityRecovery(userId: number, password: string) {
  if (Platform.OS === "web" || !userId || !password) return Promise.resolve();
  const existing = pendingRecoveryByUser.get(userId);
  if (existing) return existing;
  recoveryErrorByUser.delete(userId);
  const pending = syncChatIdentityRecovery(userId, password)
    .catch((error) => {
      recoveryErrorByUser.set(userId, error instanceof Error ? error.message : "Chitthi history recovery failed.");
      // A failed historical-key restore must not prevent this device from
      // registering a fresh key for all messages sent from now on.
    })
    .finally(() => pendingRecoveryByUser.delete(userId));
  pendingRecoveryByUser.set(userId, pending);
  return pending;
}

export async function awaitChatIdentityRecovery(userId: number) {
  const pending = pendingRecoveryByUser.get(userId);
  if (pending) await pending;
}

export function chatIdentityRecoveryError(userId: number) {
  return recoveryErrorByUser.get(userId) || "";
}

import { Platform } from "react-native";
import { getChatKeyBackup, registerChatDeviceKey, saveChatKeyBackup } from "../api/client";
import { createEncryptedIdentityBackup, getOrCreateDeviceIdentity, getStoredDeviceIdentity, restoreEncryptedIdentityBackup } from "./chatCrypto";

function accountRecoveryPassphrase(password: string) {
  return `FairFares account recovery:${password}`;
}

/**
 * Keeps the native FChat identity recoverable with the user's account password.
 * The password and unencrypted key never leave the device.
 */
export async function syncChatIdentityRecovery(userId: number, password: string) {
  if (Platform.OS === "web" || !userId || !password) return;
  const wrappingPassphrase = accountRecoveryPassphrase(password);
  const localIdentity = await getStoredDeviceIdentity(userId);
  const backup = await getChatKeyBackup();
  const identity = localIdentity || (backup.encryptedPayload
    ? await restoreEncryptedIdentityBackup(userId, backup.encryptedPayload, wrappingPassphrase)
    : await getOrCreateDeviceIdentity(userId));
  await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
  // PBKDF2 is deliberately expensive and runs on the JavaScript thread. Do
  // not repeat it on every login when this account already has a recoverable
  // key backup; that previously made the newly authenticated UI appear hung.
  if (!backup.encryptedPayload) {
    const encryptedPayload = await createEncryptedIdentityBackup(identity, wrappingPassphrase);
    await saveChatKeyBackup(encryptedPayload);
  }
}

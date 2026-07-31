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
  let identity = localIdentity;
  if (!identity) {
    const backup = await getChatKeyBackup();
    identity = backup.encryptedPayload
      ? await restoreEncryptedIdentityBackup(userId, backup.encryptedPayload, wrappingPassphrase)
      : await getOrCreateDeviceIdentity(userId);
  }
  await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
  const encryptedPayload = await createEncryptedIdentityBackup(identity, wrappingPassphrase);
  await saveChatKeyBackup(encryptedPayload);
}

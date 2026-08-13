import { Platform } from "react-native";
import { getChatKeyBackup, registerChatDeviceKey, saveChatKeyBackup } from "../api/client";
import { createEncryptedIdentityBackup, DeviceIdentity, getOrCreateDeviceIdentity, getStoredDeviceIdentity, restoreEncryptedIdentityBackup } from "./chatCrypto";

const pendingRecoveryByUser = new Map<number, Promise<void>>();
const recoveryErrorByUser = new Map<number, string>();
const recoveredIdentityKeyringByUser = new Map<number, DeviceIdentity[]>();
let recoveryGeneration = 0;

function recoveryDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  if (__DEV__) console.info("[Chitthi recovery]", { stage, generation: recoveryGeneration, ...details });
}

function safeDeviceLabel(identity?: DeviceIdentity | null) {
  return identity?.deviceId ? `…${identity.deviceId.slice(-6)}` : "none";
}

export async function markChatIdentityValidated(userId: number, identity: DeviceIdentity) {
  if (!userId || !identity.deviceId || !identity.publicKey) return;
  recoveryDiagnostic("validated-by-envelope-authentication", { userId, device: safeDeviceLabel(identity) });
}

function assertCurrentRecovery(generation: number) {
  if (generation !== recoveryGeneration) throw new Error("CHITTHI_RECOVERY_CANCELLED");
}

function accountRecoveryPassphrase(password: string) {
  return `FairFares account recovery:${password}`;
}

/**
 * Keeps the native Chitthi identity recoverable with the user's account password.
 * The password and unencrypted key never leave the device.
 */
export async function syncChatIdentityRecovery(userId: number, password: string, generation = recoveryGeneration) {
  if (Platform.OS === "web" || !userId || !password) return;
  recoveryDiagnostic("start", { userId, requestedGeneration: generation });
  assertCurrentRecovery(generation);
  // Account switching within one app process must not repeat password KDF
  // work. A populated keyring means this exact account already completed
  // backup validation in this session; only refresh its idempotent server
  // registration. Maps are keyed by user ID, so accounts cannot cross-load.
  const cachedKeyring = recoveredIdentityKeyringByUser.get(userId);
  if (cachedKeyring?.length) {
    recoveryDiagnostic("session-keyring-hit", { userId, identities: cachedKeyring.length });
    const localIdentity = await getStoredDeviceIdentity(userId);
    assertCurrentRecovery(generation);
    const identity = localIdentity || cachedKeyring[0];
    await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
    assertCurrentRecovery(generation);
    recoveryDiagnostic("registered-cached-identity", { userId, device: safeDeviceLabel(identity) });
    return;
  }
  const localIdentity = await getStoredDeviceIdentity(userId);
  assertCurrentRecovery(generation);
  if (localIdentity) {
    // SecureStore is scoped by account and installation. If its validated key
    // exists, use it immediately; a password-wrapped server backup is a
    // disaster-recovery source for a missing local key, not a login gate.
    recoveredIdentityKeyringByUser.set(userId, [localIdentity]);
    await registerChatDeviceKey(localIdentity.deviceId, localIdentity.publicKey, localIdentity.signingPublicKey);
    assertCurrentRecovery(generation);
    recoveryDiagnostic("local-identity-authoritative", { userId, device: safeDeviceLabel(localIdentity) });
    return;
  }
  const wrappingPassphrase = accountRecoveryPassphrase(password);
  const backup = await getChatKeyBackup();
  assertCurrentRecovery(generation);
  recoveryDiagnostic("sources-loaded", { userId, local: safeDeviceLabel(localIdentity), hasBackup: Boolean(backup.encryptedPayload) });
  let identity: DeviceIdentity | null = null;
  const keyring: DeviceIdentity[] = [];
  if (backup.encryptedPayload) {
    // Validate and decrypt without mutating SecureStore. An accessible local
    // identity is the authority for this installation; silently replacing it
    // would immediately strand messages encrypted for that device key.
    const recoveredIdentity = await restoreEncryptedIdentityBackup(userId, backup.encryptedPayload, wrappingPassphrase, false);
    assertCurrentRecovery(generation);
    keyring.push(recoveredIdentity);
    identity = await restoreEncryptedIdentityBackup(userId, backup.encryptedPayload, wrappingPassphrase);
  }
  identity ||= await getOrCreateDeviceIdentity(userId);
  if (!keyring.length) keyring.push(identity);
  recoveredIdentityKeyringByUser.set(userId, Array.from(new Map(keyring.map((item) => [item.deviceId, item])).values()));
  await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
  assertCurrentRecovery(generation);
  recoveryDiagnostic("registered-current-identity", { userId, device: safeDeviceLabel(identity), identities: keyring.length });
  // PBKDF2 is deliberately expensive. Native builds run it off the JS thread;
  // Expo Go uses a cooperatively-yielding fallback. Do not repeat it when the
  // account already has a recoverable key backup.
  if (!backup.encryptedPayload) {
    const encryptedPayload = await createEncryptedIdentityBackup(identity, wrappingPassphrase);
    assertCurrentRecovery(generation);
    await saveChatKeyBackup(encryptedPayload);
    assertCurrentRecovery(generation);
    recoveryDiagnostic("initial-backup-created", { userId, device: safeDeviceLabel(identity) });
  }
}

export function beginChatIdentityRecovery(userId: number, password: string, deferMs = 0) {
  if (Platform.OS === "web" || !userId || !password) return Promise.resolve();
  const existing = pendingRecoveryByUser.get(userId);
  if (existing) {
    recoveryDiagnostic("joined-existing", { userId });
    return existing;
  }
  recoveryErrorByUser.delete(userId);
  const generation = recoveryGeneration;
  // Register the barrier synchronously so Messenger cannot create a competing
  // identity, but allow login/navigation animations to commit before key
  // recovery begins (Expo Go has a yielding JS fallback).
  const start = deferMs > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, deferMs)).then(() => syncChatIdentityRecovery(userId, password, generation))
    : syncChatIdentityRecovery(userId, password, generation);
  let pending: Promise<void>;
  pending = start
    .catch((error) => {
      if (error instanceof Error && error.message === "CHITTHI_RECOVERY_CANCELLED") return;
      recoveryDiagnostic("failed", { userId, error: error instanceof Error ? error.message : String(error) });
      recoveryErrorByUser.set(userId, error instanceof Error ? error.message : "Chitthi history recovery failed.");
      // A failed historical-key restore must not prevent this device from
      // registering a fresh key for all messages sent from now on.
    })
    .finally(() => {
      // A cancelled login may finish after the same account has logged in
      // again. Never let the old promise delete the newer login's barrier.
      const ownedBarrier = pendingRecoveryByUser.get(userId) === pending;
      if (ownedBarrier) pendingRecoveryByUser.delete(userId);
      recoveryDiagnostic("settled", { userId, ownedBarrier });
    });
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

export function recoveredChatIdentities(userId: number, current?: DeviceIdentity | null) {
  const identities = [...(recoveredIdentityKeyringByUser.get(userId) || [])];
  if (current && !identities.some((item) => item.deviceId === current.deviceId)) identities.unshift(current);
  return identities.length ? identities : current ? [current] : [];
}

export function invalidateChatIdentityRecovery() {
  recoveryGeneration += 1;
  recoveryDiagnostic("invalidate-all", { pendingUsers: [...pendingRecoveryByUser.keys()] });
  pendingRecoveryByUser.clear();
  recoveryErrorByUser.clear();
  // SecureStore remains the durable authority. Do not retain private identity
  // material for signed-out accounts in the JavaScript heap.
  recoveredIdentityKeyringByUser.clear();
}

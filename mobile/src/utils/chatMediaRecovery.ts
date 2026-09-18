import { drainAttachmentOutbox, migrateAttachmentDrafts, subscribeAttachmentOutbox } from "./chatAttachmentOutbox";
import { AppState } from "react-native";
import { getChatDeviceKeys, registerChatDeviceKey, resumePendingEncryptedChatUploads } from "../api/client";
import { decryptEnvelope, encryptForDevices, getOrCreateDeviceIdentity } from "./chatCrypto";
import { awaitChatIdentityRecovery, recoveredChatIdentities } from "./chatRecovery";

type RecoveredMessages = Awaited<ReturnType<typeof resumePendingEncryptedChatUploads>>;
const listeners = new Set<(owner: number, messages: RecoveredMessages) => void>();

export function subscribeMediaRecovery(listener: (owner: number, messages: RecoveredMessages) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function refreshSavedAttachmentEnvelopes(owner: number, conversationId: string, envelopes: Array<Record<string, unknown>>, isCurrent: () => boolean) {
  const check = () => { if (!isCurrent()) throw new Error("The account changed while recovering attachments."); };
  await awaitChatIdentityRecovery(owner);
  check();
  const identity = await getOrCreateDeviceIdentity(owner);
  check();
  await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
  check();
  let descriptor = "";
  for (const candidate of recoveredChatIdentities(owner, identity)) {
    for (const envelope of envelopes) {
      if (envelope.recipientDeviceId !== candidate.deviceId) continue;
      try { descriptor = decryptEnvelope(envelope as Parameters<typeof decryptEnvelope>[0], candidate); } catch { continue; }
      if (descriptor) break;
    }
    if (descriptor) break;
  }
  if (!descriptor) throw new Error("This device cannot recover the saved attachment key.");
  const payload = await getChatDeviceKeys(conversationId);
  check();
  if (!(payload.canSend ?? payload.ready) || !payload.keys.length) throw new Error(payload.warning || "Encryption keys are not ready.");
  let kind = "TEXT";
  try { kind = JSON.parse(descriptor).kind || "TEXT"; } catch { /* Forwarded text uses a prefixed payload. */ }
  return encryptForDevices(descriptor, identity, payload.keys, kind === "IMAGE" ? "Photo" : kind === "VIDEO" ? "Video" : "File");
}

// Owned by the authenticated application, never by a conversation screen.
// Lifecycle cleanup stops new jobs; the API's session guards protect in-flight
// requests. Backgrounding is not cancellation of the user's send intent.
export function startMediaRecovery(owner: number, canRun: () => boolean) {
  let stopped = false;
  let running = false;
  let rerun = false;
  const isCurrent = () => !stopped;
  const run = async () => {
    if (stopped || running || AppState.currentState !== "active" || !canRun()) return;
    running = true;
    try {
      const eligible = () => !stopped && AppState.currentState === "active" && canRun();
      const refresh = (conversation: string, envelopes: Array<Record<string, unknown>>) => refreshSavedAttachmentEnvelopes(owner, conversation, envelopes, isCurrent);
      await migrateAttachmentDrafts(owner, eligible);
      const notify = (messages: RecoveredMessages) => {
        if (stopped) return;
        for (const listener of listeners) { try { listener(owner, messages); } catch { /* UI observers cannot fail a send. */ } }
      };
      await drainAttachmentOutbox(owner, eligible, refresh, message => notify([message]));
      const messages = await resumePendingEncryptedChatUploads(owner,
        () => !stopped && AppState.currentState === "active" && canRun(),
        (conversation, envelopes) => refreshSavedAttachmentEnvelopes(owner, conversation, envelopes, isCurrent));
      if (!stopped && messages.length) {
        notify(messages);
      }
    } catch { /* Persisted jobs remain available after connectivity/storage failures. */ }
    finally { running = false; if (rerun && !stopped) { rerun = false; void run(); } }
  };
  const unsubscribe = subscribeAttachmentOutbox(() => { if (running) rerun = true; else void run(); });
  void run();
  const timer = setInterval(() => { void run(); }, 15_000);
  const subscription = AppState.addEventListener("change", state => { if (state === "active") void run(); });
  return () => { stopped = true; unsubscribe(); clearInterval(timer); subscription.remove(); };
}

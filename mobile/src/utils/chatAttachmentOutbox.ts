import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getChatDeviceKeys, discardQueuedEncryptedChatAttachment, registerChatDeviceKey, forwardEncryptedChatAttachment, sendEncryptedChatMessage, queueEncryptedChatAttachment, sendDirectEncryptedChatAttachment } from "../api/client";
import { decryptEnvelope, getOrCreateDeviceIdentity } from "./chatCrypto";
import { awaitChatIdentityRecovery, recoveredChatIdentities } from "./chatRecovery";
import { encryptAttachmentFileForDevices, deleteChunkedTemporaryFile } from "./chitthiChunkedCrypto";
import { prepareSavedChatImage, createLightweightVideoThumbnail } from "./imageUpload";
import { FairFaresCrypto } from "../../modules/fairfares-crypto/src";
import { RecoverableMedia, readChatMediaDrafts, removeChatMediaDraft } from "./chatMediaDrafts";
import { copyPersistentChitthiMedia, persistentChitthiMediaUri } from "./chitthiMediaStorage";
import type { ChatMessage } from "../types";

type State = "saving" | "queued" | "preparing" | "uploading" | "waiting" | "failed" | "sent" | "cancelled";
type BrowserForwardUpload = { ciphertextBase64: string; ciphertextSha256: string; encryptedSize: number };
export type AttachmentJob = {
  id: string; owner: number; conversationId: string; batchId: string; index: number; count: number;
  localId: number; createdAt: number; caption: string; attachment: RecoverableMedia & {
    forwarded?: boolean; videoQuality?: "original" | "data-saver"; thumbnailBase64?: string; imageWidth?: number; imageHeight?: number;
  };
  forward?: { sourceMessageId?: number; envelopes: Array<Record<string, unknown>>; type: string; upload?: BrowserForwardUpload };
  preparedUri?: string;
  publicationPending?: boolean;
  sourceUri: string; state: State; attempts: number; nextAttemptAt?: number; error?: string;
  encrypted?: Awaited<ReturnType<typeof encryptAttachmentFileForDevices>>;
  message?: ChatMessage;
};
const prefix = "fairfares.chitthi.attachment-outbox.v1.";
const locks = new Map<string, Promise<unknown>>();
const active = new Set<string>();
const activeJobs = new Map<string, { job: AttachmentJob; controller: AbortController }>();
const listeners = new Set<() => void>();
const key = (owner: number, batch: string) => `${prefix}${owner}.${batch}`;
const itemKey = (job: AttachmentJob) => `fairfares.chitthi.attachment-item.v1.${job.owner}.${job.id}`;
export const wakeAttachmentOutbox = () => changed();
const changed = () => { for (const listener of listeners) { try { listener(); } catch { /* Observers cannot change durable send outcomes. */ } } };
export function subscribeAttachmentOutbox(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function localMessageId(id: string) {
  // A stable UI identifier, independent of timestamps shared by rapid batches.
  let high = 0x811c9dc5;
  let low = 0x9e3779b9;
  for (const character of id) {
    high = Math.imul(high ^ character.charCodeAt(0), 16777619);
    low = Math.imul(low ^ character.charCodeAt(0), 2246822519);
  }
  return -((high >>> 0) * 0x100000 + (low >>> 12)) - 1;
}

async function locked<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) || Promise.resolve();
  const result = previous.catch(() => undefined).then(work);
  locks.set(id, result);
  try { return await result; } finally { if (locks.get(id) === result) locks.delete(id); }
}

async function update(job: AttachmentJob, patch: Partial<AttachmentJob>) {
  await locked(itemKey(job), async () => {
    const raw = await AsyncStorage.getItem(itemKey(job));
    let saved = { ...job };
    if (raw) {
      try {
        const checkpoint = JSON.parse(raw) as AttachmentJob;
        if (checkpoint?.id === job.id && checkpoint.owner === job.owner && checkpoint.batchId === job.batchId) saved = checkpoint;
      } catch { /* Rebuild a damaged checkpoint from its durable manifest. */ }
    }
    if (saved.state === "sent" && patch.state !== "sent") { Object.assign(job, saved); return; }
    if (saved.state === "cancelled" && patch.state !== "sent") { Object.assign(job, saved); return; }
    Object.assign(saved, patch);
    // Keep each ciphertext/envelope checkpoint in its own record. A batch
    // manifest must not grow by the sum of every recipient envelope and preview.
    await AsyncStorage.setItem(itemKey(job), JSON.stringify(saved));
    Object.assign(job, saved);
  });
  changed();
}

export async function readAttachmentOutbox(owner: number, conversationId = "") {
  if (owner <= 0) return [] as AttachmentJob[];
  const keys = (await AsyncStorage.getAllKeys()).filter(item => item.startsWith(`${prefix}${owner}.`));
  const jobs: AttachmentJob[] = [];
  for (const [storedKey, raw] of await AsyncStorage.multiGet(keys)) {
    try {
      const batch = JSON.parse(raw || "null");
      if (!Array.isArray(batch)) continue;
      const checkpoints = new Map(await AsyncStorage.multiGet(batch.filter(job => job?.owner === owner && typeof job.id === "string").map(itemKey)));
      for (let job of batch.filter(item => item && typeof item === "object")) {
        const checkpoint = checkpoints.get(itemKey(job));
        if (checkpoint) {
          try {
            const saved = JSON.parse(checkpoint) as AttachmentJob;
            if (saved.id === job.id && saved.owner === owner && saved.batchId === job.batchId) job = saved;
          } catch { /* The manifest retains the original intent for recovery. */ }
        }
        if (job.owner === owner && storedKey === key(owner, job.batchId) && typeof job.id === "string" && /^[a-zA-Z0-9_-]+$/.test(job.id) && /^[a-zA-Z0-9_-]+$/.test(job.batchId)
          && typeof job.sourceUri === "string" && job.attachment && (!conversationId || job.conversationId === conversationId)) jobs.push(job);
      }
    } catch { /* Isolate malformed batches. */ }
  }
  return jobs.sort((a, b) => a.createdAt - b.createdAt || a.index - b.index);
}

async function commitOutboxFile(temporary: string, destination: string) {
  if (FairFaresCrypto.available) await FairFaresCrypto.commitProtectedFile(temporary, destination);
  else {
    await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.moveAsync({ from: temporary, to: destination });
  }
}

async function importSource(job: AttachmentJob) {
  const info = await FileSystem.getInfoAsync(job.sourceUri);
  if (info.exists && Number(info.size) > 0 && (!job.attachment.size || info.size === job.attachment.size)) return;
  const temporary = `${job.sourceUri}.part`;
  await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}chitthi-outbox/`, { intermediates: true });
  try {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    await FileSystem.copyAsync({ from: job.attachment.uri, to: temporary });
    const copied = await FileSystem.getInfoAsync(temporary);
    if (!copied.exists || !copied.size || (job.attachment.size > 0 && copied.size !== job.attachment.size)) throw new Error("Could not save the complete file. Select this file again.");
    await commitOutboxFile(temporary, job.sourceUri);
  } finally { await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined); }
}

// One manifest write records the entire selection before any source is copied.
// The composer waits for import; interrupted imports remain explicit jobs.
export async function enqueueAttachmentBatch(owner: number, conversationId: string, attachments: AttachmentJob["attachment"][], caption: string, recoveredBatchId?: string) {
  if (!owner || !conversationId || !attachments.length || !FileSystem.documentDirectory) throw new Error("Attachment storage is unavailable.");
  const createdAt = Date.now();
  const batchId = recoveredBatchId || `${createdAt}-${Math.random().toString(36).slice(2)}`;
  const existing = await AsyncStorage.getItem(key(owner, batchId));
  if (existing) return (await readAttachmentOutbox(owner)).filter(job => job.batchId === batchId);
  const jobs: AttachmentJob[] = attachments.map((attachment, index) => {
    const id = `${batchId}-${index}`;
    const { preparation, cancelPreparation, blob, ...serializable } = attachment as typeof attachment & { preparation?: unknown; cancelPreparation?: unknown; blob?: unknown };
    return { id, owner, conversationId, batchId, index: attachment.recoveryGroupIndex ?? index, count: attachment.recoveryGroupCount || attachments.length, localId: localMessageId(id), createdAt,
      caption: index === 0 ? caption : "", attachment: serializable, sourceUri: `${FileSystem.documentDirectory}chitthi-outbox/${owner}-${id}`,
      state: "saving", attempts: 0 };
  });
  await AsyncStorage.setItem(key(owner, batchId), JSON.stringify(jobs));
  // Hold each job against recovery while copying. A cold process can recover
  // the persisted saving state using the original picker reference.
  jobs.forEach(job => active.add(job.id));
  try {
    for (const job of jobs) {
      try { await importSource(job); await update(job, { state: "queued" }); }
      catch (error) { await update(job, { state: "failed", error: error instanceof Error ? error.message : "Could not save this attachment." }).catch(() => undefined); }
    }
  } finally { jobs.forEach(job => active.delete(job.id)); changed(); }
  return jobs;
}

export async function enqueueForwardBatch(owner: number, inputs: Array<{ conversationId: string; copySource?: boolean; sourceMessageId?: number; envelopes: Array<Record<string, unknown>>; upload?: BrowserForwardUpload; type: string; caption: string; attachment: AttachmentJob["attachment"] }>) {
  if (!owner || !inputs.length) throw new Error("Select messages and destination chats.");
  const createdAt = Date.now();
  const batchId = `forward-${createdAt}-${Math.random().toString(36).slice(2)}`;
  const jobs: AttachmentJob[] = inputs.map((input, index) => ({
    id: `${batchId}-${index}`, owner, conversationId: input.conversationId, batchId, index, count: 1,
    localId: localMessageId(`${batchId}-${index}`), createdAt, caption: input.caption, attachment: input.attachment,
    sourceUri: input.copySource ? `${FileSystem.documentDirectory}chitthi-outbox/${owner}-${batchId}-${index}` : "", state: input.copySource ? "saving" : "queued", attempts: 0,
    forward: input.copySource ? undefined : { sourceMessageId: input.sourceMessageId, envelopes: input.envelopes, type: input.type, upload: input.upload }
  }));
  // Stage per-destination envelopes first, then atomically publish the small
  // manifest. Partial staging can never start half of a forwarding operation.
  for (const job of jobs) await AsyncStorage.setItem(itemKey(job), JSON.stringify(job));
  await AsyncStorage.setItem(key(owner, batchId), JSON.stringify(jobs.map(job => ({ ...job, forward: job.forward ? { ...job.forward, envelopes: [], upload: undefined } : undefined }))));
  const sourceJobs = jobs.filter(job => !job.forward);
  sourceJobs.forEach(job => active.add(job.id));
  try {
    for (const job of sourceJobs) {
      try { await importSource(job); await update(job, { state: "queued" }); }
      catch (error) { await update(job, { state: "failed", error: error instanceof Error ? error.message : "Could not save this file." }).catch(() => undefined); }
    }
  } finally { sourceJobs.forEach(job => active.delete(job.id)); changed(); }
}

export async function retryAttachmentJob(job: AttachmentJob) {
  if (active.has(job.id) || job.state === "sent" || job.state === "cancelled") return;
  active.add(job.id);
  try { await update(job, { state: "queued", error: undefined, nextAttemptAt: 0, attempts: 0 }); }
  finally { active.delete(job.id); changed(); }
}

export async function cancelAttachmentJob(job: AttachmentJob) {
  const saved = (await readAttachmentOutbox(job.owner, job.conversationId)).find(item => item.id === job.id);
  if (!saved) return false;
  Object.assign(job, saved);
  const running = activeJobs.get(job.id);
  const current = running?.job || job;
  // Preparation can be cancelled safely. Once ciphertext is handed to the
  // publication queue, preserve ambiguous acceptance instead of promising an
  // unsend that the server may no longer be able to honor.
  if (current.state === "sent" || (active.has(job.id) && (!running || current.encrypted))) return false;
  if (current.forward && (active.has(job.id) || current.publicationPending)) return false;
  active.add(job.id);
  try {
    if (current.encrypted && !await discardQueuedEncryptedChatAttachment(job.owner, current.encrypted.ciphertextSha256, job.conversationId)) return false;
    await update(job, { state: "cancelled" });
    if (job.state !== "cancelled") return false;
    running?.controller.abort();
    if (!running && job.sourceUri) {
      for (const uri of [job.sourceUri, `${job.sourceUri}.part`, `${job.sourceUri}.prepared`, `${job.sourceUri}.prepared.part`, `${job.sourceUri}.ffenc`, `${job.sourceUri}.ffenc.part`]) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
  } finally { if (!running) active.delete(job.id); changed(); }
  return true;
}

async function cleanupCompletedBatches(jobs: AttachmentJob[]) {
  const batches = new Map<string, AttachmentJob[]>();
  for (const job of jobs) batches.set(job.batchId, [...(batches.get(job.batchId) || []), job]);
  for (const batch of batches.values()) {
    if (!batch.every(job => !active.has(job.id) && ["sent", "cancelled"].includes(job.state) && Date.now() - job.createdAt > 7 * 24 * 60 * 60 * 1000)) continue;
    // Remove the manifest first: interrupted housekeeping must not turn a
    // terminal item with a removed checkpoint back into a new send.
    await AsyncStorage.removeItem(key(batch[0].owner, batch[0].batchId));
    for (const job of batch) {
      await AsyncStorage.removeItem(itemKey(job));
      if (job.sourceUri) for (const suffix of ["", ".part", ".prepared", ".prepared.part", ".ffenc", ".ffenc.part"]) {
        await FileSystem.deleteAsync(`${job.sourceUri}${suffix}`, { idempotent: true }).catch(() => undefined);
      }
    }
  }
}

export async function migrateAttachmentDrafts(owner: number, shouldContinue: () => boolean) {
  const drafts = await readChatMediaDrafts(owner);
  const batches = new Map<string, typeof drafts>();
  for (const draft of drafts) {
    const batch = `legacy-${draft.attachment.recoveryBatchId || draft.attachment.recoveryDraftId}`;
    batches.set(batch, [...(batches.get(batch) || []), draft]);
  }
  for (const [batch, items] of batches) {
    if (!shouldContinue()) return;
    const jobs = await enqueueAttachmentBatch(owner, items[0].conversationId, items.map(item => item.attachment), items[0].caption, batch);
    for (const item of items) {
      // Earlier successful imports may already have removed their legacy
      // records. Match identity, never the shrinking legacy array position.
      const job = jobs.find(candidate => candidate.attachment.recoveryDraftId === item.attachment.recoveryDraftId);
      if (!job) continue;
      const info = await FileSystem.getInfoAsync(job.sourceUri);
      if (info.exists && Number(info.size) > 0) await removeChatMediaDraft(owner, item.attachment);
    }
  }
}

export async function drainAttachmentOutbox(owner: number, shouldContinue: () => boolean,
  refreshEnvelopes: (conversation: string, envelopes: Array<Record<string, unknown>>) => Promise<Array<Record<string, unknown>>>,
  onSent?: (message: ChatMessage & { recoveredConversationId: string }) => void) {
  const completed: Array<ChatMessage & { recoveredConversationId: string }> = [];
  const jobs = await readAttachmentOutbox(owner);
  await cleanupCompletedBatches(jobs).catch(() => undefined);
  for (const job of jobs) {
    if (!shouldContinue()) break;
    if (active.has(job.id) || ["sent", "cancelled", "failed"].includes(job.state) || (job.nextAttemptAt || 0) > Date.now()) continue;
    active.add(job.id);
    let derivative = "";
    const controller = new AbortController();
    activeJobs.set(job.id, { job, controller });
    const check = () => { if (controller.signal.aborted || job.state === "cancelled" || !shouldContinue()) throw new Error("ATTACHMENT_WORK_PAUSED"); };
    try {
      check();
      if (job.forward) {
        await update(job, { state: "uploading", publicationPending: true, error: undefined });
        const send = () => job.forward!.upload
          ? sendDirectEncryptedChatAttachment(owner, job.conversationId, { ...job.forward!.upload, envelopes: job.forward!.envelopes }, job.attachment.mimeType, false, undefined, undefined, refreshEnvelopes, job.id)
          : job.forward!.sourceMessageId
          ? forwardEncryptedChatAttachment(job.forward!.sourceMessageId, job.conversationId, job.forward!.envelopes, false, job.id)
          : sendEncryptedChatMessage(job.conversationId, job.forward!.envelopes, job.id);
        let response;
        try { check(); response = await send(); }
        catch (error) {
          if (Number((error as { fairFaresHttpStatus?: number })?.fairFaresHttpStatus) !== 409 || !/encryption keys changed/i.test(String(error))) throw error;
          const envelopes = await refreshEnvelopes(job.conversationId, job.forward.envelopes);
          check();
          await update(job, { forward: { ...job.forward, envelopes } });
          check(); response = await send();
        }
        await update(job, { state: "sent", publicationPending: false, message: response.message, error: undefined });
        completed.push({ ...response.message, localClientMessageId: job.id, recoveredConversationId: job.conversationId });
        onSent?.(completed[completed.length - 1]);
        continue;
      }
      if (!job.encrypted) {
        await importSource(job);
        await update(job, { state: "preparing", error: undefined });
        let media = { ...job.attachment, uri: job.sourceUri };
        if (media.kind === "IMAGE" && !media.imagePrepared) {
          const prepared = await prepareSavedChatImage(media);
          derivative = prepared.uri;
          media = { ...media, ...prepared };
        } else if (media.kind === "VIDEO" && Platform.OS === "ios" && media.videoQuality === "data-saver") {
          if (!FairFaresCrypto.videoPreparationAvailable && !FairFaresCrypto.videoOptimizationAvailable) throw new Error("Update the app to prepare this video, or send it in HD.");
          derivative = `${FileSystem.cacheDirectory}chitthi-outbox-${job.id}.mp4`;
          const prepared = FairFaresCrypto.videoPreparationAvailable
            ? await FairFaresCrypto.prepareVideo(media.uri, derivative, "data-saver", undefined, controller.signal)
            : await FairFaresCrypto.optimizeVideo(media.uri, derivative, undefined, controller.signal);
          media = { ...media, uri: derivative, mimeType: prepared.mimeType || "video/mp4", size: prepared.outputSize, name: media.name.replace(/\.[^.]+$/, "") + ".mp4" };
        }
        check();
        if (!FairFaresCrypto.available && media.size > 6_000_000) throw new Error("Install the latest app build to send this file.");
        if (media.size > 100_000_000) throw new Error("This attachment exceeds the 100 MB limit.");
        if (media.kind === "VIDEO" && !media.thumbnailBase64) media.thumbnailBase64 = await createLightweightVideoThumbnail(media.uri).catch(() => "");
        await awaitChatIdentityRecovery(owner);
        check();
        const identity = await getOrCreateDeviceIdentity(owner);
        check();
        await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
        check();
        const keys = await getChatDeviceKeys(job.conversationId);
        check();
        if (!(keys.canSend ?? keys.ready) || !keys.keys.length) throw Object.assign(new Error(keys.warning || "Waiting for encryption keys."), { retryable: true });
        const preparedUri = `${job.sourceUri}.prepared`;
        await FileSystem.deleteAsync(`${preparedUri}.part`, { idempotent: true });
        await FileSystem.copyAsync({ from: media.uri, to: `${preparedUri}.part` });
        await commitOutboxFile(`${preparedUri}.part`, preparedUri);
        let encrypted = await encryptAttachmentFileForDevices(preparedUri, {
          kind: media.kind, fileName: media.name, mimeType: media.mimeType, caption: job.caption, size: media.size, forwarded: media.forwarded,
          thumbnailBase64: media.thumbnailBase64, imageWidth: media.imageWidth, imageHeight: media.imageHeight,
          ...(job.count > 1 ? { mediaGroupId: job.attachment.recoveryBatchId || job.batchId, mediaGroupIndex: job.index, mediaGroupCount: job.count } : {})
        }, identity, keys.keys, undefined, 0, controller.signal);
        check();
        const durableCipher = `${job.sourceUri}.ffenc`;
        await FileSystem.deleteAsync(`${durableCipher}.part`, { idempotent: true });
        await FileSystem.copyAsync({ from: encrypted.encryptedUri, to: `${durableCipher}.part` });
        const cipherInfo = await FileSystem.getInfoAsync(`${durableCipher}.part`);
        if (!cipherInfo.exists || cipherInfo.size !== encrypted.encryptedSize) throw new Error("Could not save encrypted media.");
        await commitOutboxFile(`${durableCipher}.part`, durableCipher);
        deleteChunkedTemporaryFile(encrypted.encryptedUri);
        encrypted = { ...encrypted, encryptedUri: durableCipher };
        check();
        await update(job, { encrypted, preparedUri, state: "uploading", attachment: { ...job.attachment, mimeType: media.mimeType, name: media.name, size: media.size, thumbnailBase64: media.thumbnailBase64 } });
      }
      check();
      await queueEncryptedChatAttachment(owner, job.conversationId, job.encrypted!, job.attachment.mimeType, false, undefined, job.id);
      check();
      const response = await sendDirectEncryptedChatAttachment(owner, job.conversationId, job.encrypted!, job.attachment.mimeType, false, undefined, undefined, refreshEnvelopes);
      // Server acceptance is durable before optional sender-side decryption.
      await update(job, { state: "sent", message: response.message, error: undefined });
      let descriptor = "";
      try {
        const identity = await getOrCreateDeviceIdentity(owner);
        for (const candidate of recoveredChatIdentities(owner, identity)) {
          const envelope = job.encrypted!.envelopes.find(item => item.recipientDeviceId === candidate.deviceId);
          if (!envelope) continue;
          try { descriptor = decryptEnvelope(envelope, candidate); if (descriptor) break; } catch { /* Try recovered keys. */ }
        }
      } catch { /* The message remains sent if local identity storage is unavailable. */ }
      if (descriptor) response.message = { ...response.message, metadata: { ...response.message.metadata, encrypted: true, encryptedKeyPayload: descriptor } };
      // Persist acceptance before removing sources. A failed UI/cache cleanup
      // can never turn an accepted send back into a new send intent.
      if (descriptor) await update(job, { state: "sent", message: response.message, error: undefined }).catch(() => undefined);
      completed.push({ ...response.message, localClientMessageId: job.id, recoveredConversationId: job.conversationId });
        onSent?.(completed[completed.length - 1]);
      if (job.preparedUri) {
        const extension = job.attachment.name.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1]?.toLowerCase() || (job.attachment.mimeType === "image/jpeg" ? "jpg" : job.attachment.mimeType === "video/quicktime" ? "mov" : job.attachment.mimeType.split("/")[1]?.replace(/[^a-zA-Z0-9]/g, "") || "bin");
        const localUri = persistentChitthiMediaUri(owner, response.message.id, extension);
        await copyPersistentChitthiMedia(localUri, job.preparedUri).catch(() => undefined);
        await FileSystem.deleteAsync(job.preparedUri, { idempotent: true }).catch(() => undefined);
      }
      await FileSystem.deleteAsync(job.sourceUri, { idempotent: true }).catch(() => undefined);
      if (job.encrypted?.encryptedUri) deleteChunkedTemporaryFile(job.encrypted.encryptedUri);
    } catch (error) {
      if (job.state === "sent") continue;
      if (controller.signal.aborted || job.state === "cancelled") continue;
      if (!shouldContinue() || (error instanceof Error && error.message === "ATTACHMENT_WORK_PAUSED")) continue;
      const status = Number((error as { fairFaresHttpStatus?: number })?.fairFaresHttpStatus || 0);
      const retryable = Boolean((error as { retryable?: boolean })?.retryable || status >= 500 || status === 429 || status === 408 || (!status && /network|offline|timeout|connection|could not connect|failed to fetch|temporarily unavailable|response lost/i.test(String(error))));
      const attempts = job.attempts + 1;
      await update(job, { state: retryable ? "waiting" : "failed", attempts,
        ...(job.forward && status >= 400 && status < 500 && status !== 408 && status !== 429 ? { publicationPending: false } : {}),
        nextAttemptAt: Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(attempts, 6)),
        error: error instanceof Error ? error.message : "Could not send this attachment." }).catch(() => undefined);
    } finally {
      active.delete(job.id);
      activeJobs.delete(job.id);
      if (controller.signal.aborted || job.state === "cancelled") {
        for (const uri of [job.sourceUri, `${job.sourceUri}.part`, `${job.sourceUri}.prepared`, `${job.sourceUri}.prepared.part`, `${job.sourceUri}.ffenc`, `${job.sourceUri}.ffenc.part`]) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
      if (derivative) await FileSystem.deleteAsync(derivative, { idempotent: true }).catch(() => undefined);
    }
  }
  return completed;
}

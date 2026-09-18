import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

export type RecoverableMedia = {
  kind: "IMAGE" | "VIDEO" | "FILE";
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  imagePrepared?: boolean;
  recoveryDraftId?: string;
  recoveryBatchId?: string;
  recoveryGroupIndex?: number;
  recoveryGroupCount?: number;
};
type MediaDraft = { conversationId: string; attachment: RecoverableMedia; caption: string };
let draftSequence = 0;
const prefix = "fairfares.chitthi.media-draft.v1.";
const keyFor = (userId: number, id: string) => `${prefix}${userId}.${id}`;
const validId = (id: string) => /^[a-zA-Z0-9_-]+$/.test(id);
const sourceFor = (userId: number, id: string) => `${FileSystem.documentDirectory}chitthi-pending-media/${userId}-${id}`;

function parseDraft(raw: string | null): MediaDraft | null {
  try {
    const draft = raw ? JSON.parse(raw) : null;
    const item = draft?.attachment;
    if (!draft?.conversationId || !item || !["IMAGE", "VIDEO", "FILE"].includes(item.kind)
      || typeof item.uri !== "string" || typeof item.name !== "string" || typeof item.mimeType !== "string"
      || !Number.isFinite(item.size) || typeof item.recoveryDraftId !== "string" || !validId(item.recoveryDraftId)) return null;
    return { ...draft, caption: typeof draft.caption === "string" ? draft.caption : "" };
  } catch { return null; }
}

export async function saveChatMediaDraft<T extends RecoverableMedia>(userId: number, conversationId: string, attachment: T, caption: string, batchId?: string): Promise<T> {
  if (Platform.OS === "web") return attachment;
  if (!Number.isSafeInteger(userId) || userId <= 0 || !conversationId) throw new Error("Choose a signed-in conversation before sending files.");
  if (!FileSystem.documentDirectory) throw new Error("Storage is unavailable. Please try sending again.");
  const existingId = attachment.recoveryDraftId;
  const id = existingId && validId(existingId) ? existingId : `${Date.now()}-${String(draftSequence++).padStart(6, "0")}-${Math.random().toString(36).slice(2)}`;
  const directory = `${FileSystem.documentDirectory}chitthi-pending-media/`;
  const uri = sourceFor(userId, id);
  const existing = parseDraft(await AsyncStorage.getItem(keyFor(userId, id)));
  if (existing && existing.conversationId !== conversationId) throw new Error("This file belongs to a different conversation.");
  if (!existing || !(await FileSystem.getInfoAsync(uri)).exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const temporaryUri = `${uri}.part`;
    try {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      await FileSystem.copyAsync({ from: attachment.uri, to: temporaryUri });
      const info = await FileSystem.getInfoAsync(temporaryUri);
      if (!info.exists || (attachment.size > 0 && info.size !== attachment.size)) throw new Error("Could not save the complete file. Please try again.");
      await FileSystem.moveAsync({ from: temporaryUri, to: uri });
    } catch (error) {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
      throw error;
    }
  }
  const recoveryBatchId = attachment.recoveryBatchId || batchId || id;
  // Keep an existing raw source's type/size when the live send has already
  // compressed it. Its caption may have been edited before the next retry.
  const sourceInfo = await FileSystem.getInfoAsync(uri);
  const saved = { ...(existing?.attachment || attachment), size: sourceInfo.exists ? sourceInfo.size : attachment.size,
    uri, ownedCacheFile: false, recoveryDraftId: id, recoveryBatchId };
  const { preparation, cancelPreparation, blob, ...serializable } = saved as typeof saved & { preparation?: unknown; cancelPreparation?: unknown; blob?: unknown };
  await AsyncStorage.setItem(keyFor(userId, id), JSON.stringify({ conversationId, attachment: serializable, caption }));
  return { ...attachment, recoveryDraftId: id, recoveryBatchId };
}

export async function readChatMediaDrafts(userId: number, conversationId = "") {
  if (Platform.OS === "web" || userId <= 0) return [] as MediaDraft[];
  const allKeys = await AsyncStorage.getAllKeys();
  const keys = allKeys.filter(key => key.startsWith(`${prefix}${userId}.`)).sort();
  const queuedDraftIds = new Set<string>();
  for (const [, raw] of await AsyncStorage.multiGet(allKeys.filter(key => key.startsWith(`fairfares.chitthi.multipart.v1.${userId}.`)))) {
    try {
      if (!raw) continue;
      const pending = JSON.parse(raw);
      if (pending.ownerUserId !== userId || (conversationId && pending.conversationId !== conversationId) || !pending.recoveryDraftId) continue;
      const info = await FileSystem.getInfoAsync(pending.encryptedUri);
      if (pending.receipt || pending.cancelled || (info.exists && info.size === pending.encryptedSize)) queuedDraftIds.add(pending.recoveryDraftId);
    } catch { /* One damaged queue record must not hide every draft. */ }
  }
  const drafts: MediaDraft[] = [];
  for (const [key, raw] of await AsyncStorage.multiGet(keys)) {
    const draft = parseDraft(raw);
    if (!draft || key !== keyFor(userId, draft.attachment.recoveryDraftId!)) continue;
    if ((conversationId && draft.conversationId !== conversationId) || queuedDraftIds.has(draft.attachment.recoveryDraftId!)) continue;
    const expectedUri = sourceFor(userId, draft.attachment.recoveryDraftId!);
    const info = await FileSystem.getInfoAsync(expectedUri);
    if (info.exists) drafts.push({ ...draft, attachment: { ...draft.attachment, uri: expectedUri } });
  }
  return drafts;
}

// Restore one send at a time. Combining unrelated sends silently replaced
// captions and dropped all but the first document in the previous recovery UI.
export function firstChatMediaDraftBatch(drafts: MediaDraft[]) {
  if (!drafts.length) return [];
  const first = drafts[0].attachment;
  const batchId = first.recoveryBatchId || first.recoveryDraftId;
  return drafts.filter(({ attachment }) => (attachment.recoveryBatchId || attachment.recoveryDraftId) === batchId);
}

export async function removeChatMediaDraft(userId: number, attachment: Pick<RecoverableMedia, "recoveryDraftId">, preserveSource = false) {
  const id = attachment.recoveryDraftId;
  if (!id || !validId(id) || userId <= 0) return;
  await AsyncStorage.removeItem(keyFor(userId, id));
  if (!preserveSource && FileSystem.documentDirectory) {
    await FileSystem.deleteAsync(sourceFor(userId, id), { idempotent: true }).catch(() => undefined);
  }
}

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const LOCAL_MEDIA_DIRECTORY = "chitthi-media";
const LOCAL_MEDIA_MAX_BYTES = 500_000_000;
const LOCAL_MEDIA_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function safeSegment(value: string | number) {
  return String(value).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function mediaRootUri() {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return "";
  return `${FileSystem.documentDirectory}${LOCAL_MEDIA_DIRECTORY}/`;
}

async function ensureMediaRoot() {
  const root = mediaRootUri();
  if (!root) throw new Error("Persistent Chitthi media storage is unavailable.");
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  return root;
}

export function persistentChitthiMediaUri(userId: number, messageId: number, extension: string) {
  const root = mediaRootUri();
  if (!root || userId <= 0 || messageId <= 0) return "";
  return `${root}${safeSegment(userId)}-${safeSegment(messageId)}.${safeSegment(extension).toLowerCase()}`;
}

export async function persistentChitthiMediaExists(uri: string) {
  if (!uri) return false;
  const info = await FileSystem.getInfoAsync(uri);
  return Boolean(info.exists && Number(info.size || 0) > 0);
}

export async function writePersistentChitthiMedia(uri: string, base64: string) {
  if (!uri || !base64) throw new Error("The downloaded Chitthi media is empty.");
  await ensureMediaRoot();
  const temporaryUri = `${uri}.part`;
  await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
  try {
    await FileSystem.writeAsStringAsync(temporaryUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (!await persistentChitthiMediaExists(temporaryUri)) throw new Error("Chitthi media could not be saved on this device.");
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: temporaryUri, to: uri });
    if (!await persistentChitthiMediaExists(uri)) throw new Error("Chitthi media could not be saved on this device.");
  } catch (error) {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

export async function copyPersistentChitthiMedia(uri: string, sourceUri: string) {
  if (!uri || !sourceUri) throw new Error("The Chitthi media source is missing.");
  await ensureMediaRoot();
  const temporaryUri = `${uri}.part`;
  await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: temporaryUri });
    if (!await persistentChitthiMediaExists(temporaryUri)) throw new Error("Chitthi media could not be copied to durable storage.");
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: temporaryUri, to: uri });
  } catch (error) {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupPersistentChitthiMedia(protectedUri = "") {
  const root = mediaRootUri();
  if (!root) return { deleted: 0, retainedBytes: 0 };
  const rootInfo = await FileSystem.getInfoAsync(root);
  if (!rootInfo.exists) return { deleted: 0, retainedBytes: 0 };
  const now = Date.now();
  const names = await FileSystem.readDirectoryAsync(root);
  const files: Array<{ uri: string; size: number; modifiedAt: number }> = [];
  let deleted = 0;
  for (const name of names) {
    const uri = `${root}${name}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) continue;
    if (name.endsWith(".part")) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      deleted += 1;
      continue;
    }
    const modifiedAt = Number(info.modificationTime || 0) * 1000;
    if (uri !== protectedUri && modifiedAt > 0 && now - modifiedAt > LOCAL_MEDIA_MAX_AGE_MS) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      deleted += 1;
      continue;
    }
    files.push({ uri, size: Number(info.size || 0), modifiedAt });
  }
  let retainedBytes = files.reduce((total, file) => total + file.size, 0);
  for (const file of files.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
    if (retainedBytes <= LOCAL_MEDIA_MAX_BYTES) break;
    if (file.uri === protectedUri) continue;
    await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
    retainedBytes -= file.size;
    deleted += 1;
  }
  return { deleted, retainedBytes };
}

export const chitthiLocalMediaPolicy = {
  maxBytes: LOCAL_MEDIA_MAX_BYTES,
  maxAgeDays: Math.round(LOCAL_MEDIA_MAX_AGE_MS / (24 * 60 * 60 * 1000))
};

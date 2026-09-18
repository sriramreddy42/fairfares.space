import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

export type PickedChatFile = { uri: string; blob?: Blob; name: string; mimeType: string; size: number; ownedCacheFile: boolean };

function normalizedMimeType(name: string, provided: string) {
  if (provided && provided !== "application/octet-stream") return provided;
  const extension = name.toLowerCase().split(".").pop() || "";
  return ({ pdf: "application/pdf", txt: "text/plain", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as Record<string, string>)[extension] || provided || "application/octet-stream";
}

export async function pickChatFiles(maxBytes = 100_000_000): Promise<PickedChatFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: true
  });
  if (result.canceled || !result.assets.length) return [];
  if (result.assets.length > 20) throw new Error("Select at most 20 files at a time.");
  const files: PickedChatFile[] = [];
  for (const asset of result.assets) {
  const size = Number(asset.size || 0);
  const fileLimit = Math.max(1_000_000, Math.min(100_000_000, maxBytes));
  if (!size || size > fileLimit) {
    if (asset.uri) await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => undefined);
    throw new Error(!size ? "Could not determine the selected file size." : `Choose a file no larger than ${Math.round(fileLimit / 1_000_000)} MB.`);
  }
  const mimeType = normalizedMimeType(asset.name || "attachment", asset.mimeType || "");
  if (!asset.uri) throw new Error("Could not read the selected file.");
  files.push({ uri: asset.uri, blob: asset.file || undefined, name: asset.name || "attachment", mimeType, size, ownedCacheFile: true });
  }
  return files;
}

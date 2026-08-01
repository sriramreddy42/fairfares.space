import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

export async function pickCompressedImages(limit = 4, maxWidth = 1280, quality = 0.72) {
  const remaining = Math.max(1, Math.min(limit, 4));
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Allow photo access to upload pictures.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: remaining > 1,
    base64: false,
    mediaTypes: ["images"],
    quality,
    selectionLimit: remaining
  });
  if (result.canceled) {
    return [];
  }
  const images: string[] = [];
  for (const asset of result.assets.slice(0, remaining)) {
    const actions =
      asset.width && asset.width > maxWidth
        ? [{ resize: { width: maxWidth } }]
        : [];
    const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      base64: true,
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG
    });
    if (compressed.base64) {
      images.push(`data:image/jpeg;base64,${compressed.base64}`);
    }
  }
  return images;
}

export async function pickChatImage(maxWidth = 1600, quality = 0.76) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow photo access to upload pictures.");
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: false,
    base64: false,
    mediaTypes: ["images", "videos"],
    quality,
    selectionLimit: 1
  });
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  const isVideo = asset.type === "video" || String(asset.mimeType || "").startsWith("video/");
  if (isVideo && Number(asset.fileSize || 0) > 15_000_000) throw new Error("Choose a video smaller than 15 MB.");
  if (Platform.OS === "web") {
    const webFile = (asset as typeof asset & { file?: Blob }).file;
    return {
      uri: asset.uri,
      blob: webFile,
      name: asset.fileName || `fchat-${Date.now()}.jpg`,
      mimeType: asset.mimeType || webFile?.type || "image/jpeg",
      size: Number(asset.fileSize || webFile?.size || 0),
      kind: isVideo ? "VIDEO" as const : "IMAGE" as const
    };
  }
  if (isVideo) {
    const info = await FileSystem.getInfoAsync(asset.uri);
    return {
      uri: asset.uri,
      name: asset.fileName || `fchat-${Date.now()}.mp4`,
      mimeType: asset.mimeType || "video/mp4",
      size: info.exists && "size" in info ? Number(info.size || 0) : Number(asset.fileSize || 0),
      kind: "VIDEO" as const
    };
  }
  const actions = asset.width && asset.width > maxWidth ? [{ resize: { width: maxWidth } }] : [];
  const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    base64: false,
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG
  });
  const info = await FileSystem.getInfoAsync(compressed.uri);
  return {
    uri: compressed.uri,
    name: `fchat-${Date.now()}.jpg`,
    mimeType: "image/jpeg",
    size: info.exists && "size" in info ? Number(info.size || 0) : 0,
    kind: "IMAGE" as const
  };
}

export async function takeChatPhoto(maxWidth = 1600, quality = 0.82) {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error("Allow camera access to take a photo.");
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    base64: false,
    quality
  });
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  if (Platform.OS === "web") {
    const webFile = (asset as typeof asset & { file?: Blob }).file;
    return {
      uri: asset.uri,
      blob: webFile,
      name: asset.fileName || `fchat-camera-${Date.now()}.jpg`,
      mimeType: asset.mimeType || webFile?.type || "image/jpeg",
      size: Number(asset.fileSize || webFile?.size || 0),
      kind: "IMAGE" as const
    };
  }
  const actions = asset.width && asset.width > maxWidth ? [{ resize: { width: maxWidth } }] : [];
  const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    base64: false,
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG
  });
  const info = await FileSystem.getInfoAsync(compressed.uri);
  return {
    uri: compressed.uri,
    name: `fchat-camera-${Date.now()}.jpg`,
    mimeType: "image/jpeg",
    size: info.exists && "size" in info ? Number(info.size || 0) : 0,
    kind: "IMAGE" as const
  };
}

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
    mediaTypes: ["images"],
    quality,
    selectionLimit: 1
  });
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  if (Platform.OS === "web") {
    const webFile = (asset as typeof asset & { file?: Blob }).file;
    return {
      uri: asset.uri,
      blob: webFile,
      name: asset.fileName || `fchat-${Date.now()}.jpg`,
      mimeType: asset.mimeType || webFile?.type || "image/jpeg",
      size: Number(asset.fileSize || webFile?.size || 0)
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
    size: info.exists && "size" in info ? Number(info.size || 0) : 0
  };
}

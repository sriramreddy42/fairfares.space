import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

function preferredImageEncoding() {
  const webp = Platform.OS !== "ios";
  return {
    format: webp ? ImageManipulator.SaveFormat.WEBP : ImageManipulator.SaveFormat.JPEG,
    extension: webp ? "webp" : "jpg",
    mimeType: webp ? "image/webp" : "image/jpeg"
  };
}

async function compressedUpload(asset: ImagePicker.ImagePickerAsset, index: number, prefix: string, maxWidth: number, quality: number) {
  const encoding = preferredImageEncoding();
  const actions = asset.width && asset.width > maxWidth ? [{ resize: { width: maxWidth } }] : [];
  const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    base64: false,
    compress: quality,
    format: encoding.format
  });
  if (Platform.OS === "web") {
    const blob = await fetch(compressed.uri).then((response) => response.blob());
    return {
      uri: compressed.uri,
      blob,
      name: `${prefix}-${Date.now()}-${index + 1}.${encoding.extension}`,
      mimeType: encoding.mimeType,
      size: blob.size,
      kind: "IMAGE" as const
    };
  }
  const info = await FileSystem.getInfoAsync(compressed.uri);
  return {
    uri: compressed.uri,
    name: `${prefix}-${Date.now()}-${index + 1}.${encoding.extension}`,
    mimeType: encoding.mimeType,
    size: info.exists && "size" in info ? Number(info.size || 0) : 0,
    kind: "IMAGE" as const
  };
}

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
    const encoding = preferredImageEncoding();
    const actions =
      asset.width && asset.width > maxWidth
        ? [{ resize: { width: maxWidth } }]
        : [];
    const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      base64: true,
      compress: quality,
      format: encoding.format
    });
    if (compressed.base64) {
      images.push(`data:${encoding.mimeType};base64,${compressed.base64}`);
    }
  }
  return images;
}

export async function pickChatImages(limit = 4, maxWidth = 1600, quality = 0.76) {
  const selectionLimit = Math.max(1, Math.min(limit, 4));
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow photo access to upload pictures.");
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: selectionLimit > 1,
    base64: false,
    mediaTypes: ["images"],
    quality,
    selectionLimit
  });
  if (result.canceled || !result.assets.length) return [];
  return await Promise.all(result.assets.slice(0, selectionLimit).map((asset, index) =>
    compressedUpload(asset, index, "fchat", maxWidth, quality)
  ));
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
  return compressedUpload(asset, 0, "fchat-camera", maxWidth, quality);
}

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { createVideoPlayer } from "expo-video";
import { Platform } from "react-native";

// Large enough to remain recognizable in a chat bubble, while keeping the
// complete per-device encrypted descriptor below the backend's 12 KB envelope
// ceiling even after JSON, NaCl and base64 overhead.
const CHAT_THUMBNAIL_MAX_BYTES = 5_000;

function decodedBase64Size(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

export async function createLightweightChatThumbnail(uri: string) {
  let width = 240;
  let quality = 0.52;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const thumbnail = await ImageManipulator.manipulateAsync(uri, [{ resize: { width } }], {
      base64: true,
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG
    });
    try {
      const base64 = thumbnail.base64 || "";
      if (base64 && decodedBase64Size(base64) <= CHAT_THUMBNAIL_MAX_BYTES) return base64;
    } finally {
      if (Platform.OS !== "web" && thumbnail.uri && thumbnail.uri !== uri) {
        await FileSystem.deleteAsync(thumbnail.uri, { idempotent: true }).catch(() => undefined);
      }
    }
    width = Math.max(72, Math.round(width * 0.78));
    quality = Math.max(0.18, quality - 0.07);
  }
  // A thumbnail is an optimization, never a reason to block the attachment.
  return "";
}

export async function createLightweightVideoThumbnail(uri: string) {
  if (Platform.OS === "web") return "";
  const player = createVideoPlayer(uri);
  let frames: Awaited<ReturnType<typeof player.generateThumbnailsAsync>> = [];
  try {
    // The native player decodes only a small frame near the start. Passing the
    // resulting SharedRef straight to ImageManipulator avoids a full video read
    // or a JS pixel-buffer copy.
    frames = await player.generateThumbnailsAsync(0.1, { maxWidth: 240, maxHeight: 240 });
    const frame = frames[0];
    if (!frame) return "";
    let width = 240;
    let quality = 0.52;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const context = ImageManipulator.ImageManipulator.manipulate(frame);
      let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      let savedUri = "";
      try {
        rendered = await context.resize({ width }).renderAsync();
        const saved = await rendered.saveAsync({
          base64: true,
          compress: quality,
          format: ImageManipulator.SaveFormat.JPEG
        });
        savedUri = saved.uri;
        const base64 = saved.base64 || "";
        if (base64 && decodedBase64Size(base64) <= CHAT_THUMBNAIL_MAX_BYTES) return base64;
      } finally {
        rendered?.release();
        context.release();
        if (savedUri) await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => undefined);
      }
      width = Math.max(72, Math.round(width * 0.78));
      quality = Math.max(0.18, quality - 0.07);
    }
    return "";
  } finally {
    frames.forEach((frame) => frame.release());
    player.release();
  }
}

function preferredImageEncoding() {
  const webp = Platform.OS !== "ios";
  return {
    format: webp ? ImageManipulator.SaveFormat.WEBP : ImageManipulator.SaveFormat.JPEG,
    extension: webp ? "webp" : "jpg",
    mimeType: webp ? "image/webp" : "image/jpeg"
  };
}

async function compressedUpload(asset: ImagePicker.ImagePickerAsset, index: number, prefix: string, maxWidth: number, quality: number, maxBytes = 0) {
  const encoding = preferredImageEncoding();
  let currentWidth = maxWidth;
  let currentQuality = quality;
  let best = {
    uri: asset.uri,
    blob: undefined as Blob | undefined,
    size: Number(asset.fileSize || 0)
  };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actions = asset.width && asset.width > currentWidth ? [{ resize: { width: currentWidth } }] : [];
    const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      base64: false,
      compress: currentQuality,
      format: encoding.format
    });
    const blob = Platform.OS === "web" ? await fetch(compressed.uri).then((response) => response.blob()) : undefined;
    const info = Platform.OS === "web" ? null : await FileSystem.getInfoAsync(compressed.uri);
    const previousGeneratedUri = best.uri !== asset.uri ? best.uri : "";
    best = {
      uri: compressed.uri,
      blob,
      size: blob?.size || (info?.exists && "size" in info ? Number(info.size || 0) : 0)
    };
    if (Platform.OS !== "web" && previousGeneratedUri && previousGeneratedUri !== best.uri) {
      await FileSystem.deleteAsync(previousGeneratedUri, { idempotent: true }).catch(() => undefined);
    }
    if (!maxBytes || best.size <= maxBytes || currentWidth <= 720) break;
    currentWidth = Math.max(720, Math.round(currentWidth * 0.82));
    currentQuality = Math.max(0.42, currentQuality - 0.1);
  }
  const thumbnailBase64 = await createLightweightChatThumbnail(best.uri).catch(() => "");
  return {
    uri: best.uri,
    blob: best.blob,
    name: `${prefix}-${Date.now()}-${index + 1}.${encoding.extension}`,
    mimeType: encoding.mimeType,
    size: best.size,
    thumbnailBase64,
    ownedCacheFile: Platform.OS !== "web",
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

export async function pickChatImages(limit = 4, maxWidth = 1280, quality = 0.62, maxBytes = 350_000) {
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
    compressedUpload(asset, index, "chitthi", maxWidth, quality, maxBytes)
  ));
}

export async function pickChatMedia(limit = 4, maxWidth = 1280, quality = 0.62, maxBytes = 350_000, maxVideoBytes = 100_000_000) {
  const selectionLimit = Math.max(1, Math.min(limit, 4));
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow photo access to upload pictures or videos.");
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: selectionLimit > 1,
    base64: false,
    mediaTypes: ["images", "videos"],
    quality,
    selectionLimit,
    videoMaxDuration: 120,
    // iOS exports the selected video as messaging-friendly H.264/AAC before
    // Chitthi reads and encrypts it. Android ignores these iOS-only options and
    // is still protected by the measured post-picker byte limit below.
    videoExportPreset: ImagePicker.VideoExportPreset.H264_960x540,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame960x540
  });
  if (result.canceled || !result.assets.length) return [];
  const selectedVideo = result.assets.find((asset) => asset.type === "video");
  if (selectedVideo) {
    const blob = Platform.OS === "web" ? await fetch(selectedVideo.uri).then((response) => response.blob()) : undefined;
    const info = Platform.OS === "web" ? null : await FileSystem.getInfoAsync(selectedVideo.uri);
    const size = blob?.size || (info?.exists && "size" in info ? Number(info.size || 0) : Number(selectedVideo.fileSize || 0));
    if (!size) throw new Error("Could not determine the selected video size.");
    const videoLimit = Math.max(1_000_000, Math.min(100_000_000, maxVideoBytes));
    if (size > videoLimit) {
      if (Platform.OS !== "web") await FileSystem.deleteAsync(selectedVideo.uri, { idempotent: true }).catch(() => undefined);
      throw new Error(`This video is larger than the ${Math.round(videoLimit / 1_000_000)} MB encrypted-transfer limit currently enabled for your account.`);
    }
    const mimeType = selectedVideo.mimeType || "video/mp4";
    const thumbnailBase64 = await createLightweightVideoThumbnail(selectedVideo.uri).catch(() => "");
    return [{
      uri: selectedVideo.uri,
      blob,
      name: selectedVideo.fileName || `chitthi-video-${Date.now()}${mimeType === "video/quicktime" ? ".mov" : ".mp4"}`,
      mimeType,
      size,
      thumbnailBase64,
      ownedCacheFile: Platform.OS !== "web",
      kind: "VIDEO" as const
    }];
  }
  return await Promise.all(result.assets.slice(0, selectionLimit).map((asset, index) =>
    compressedUpload(asset, index, "chitthi", maxWidth, quality, maxBytes)
  ));
}

export async function takeChatPhoto(maxWidth = 1280, quality = 0.64, maxBytes = 400_000) {
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
  return compressedUpload(asset, 0, "chitthi-camera", maxWidth, quality, maxBytes);
}

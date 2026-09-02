import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import Constants from "expo-constants";
import { createVideoPlayer } from "expo-video";
import { Platform } from "react-native";
import { FairFaresCrypto } from "../../modules/fairfares-crypto/src";

// The thumbnail stays inside the per-device end-to-end encrypted descriptor;
// it is never stored as a public image. Start at a useful chat-bubble
// resolution and progressively reduce it only when a detailed frame would
// exceed the encrypted-envelope allowance. Fine text in screenshots needs a
// larger preview than ordinary photos, so use the native-safe 32 KB ceiling.
const CHAT_THUMBNAIL_MAX_BYTES = 32_000;
const IS_EXPO_GO = Constants.appOwnership === "expo";
let mediaLibraryPickerActive = false;

function isDetachedAndroidPicker(error: unknown): boolean {
  if (Platform.OS !== "android") return false;
  const candidates: unknown[] = [error];
  const visited = new Set<unknown>();
  while (candidates.length) {
    const candidate = candidates.shift();
    if (candidate == null || visited.has(candidate)) continue;
    visited.add(candidate);
    if (/unregistered\s+ActivityResultLauncher/i.test(String(candidate))) return true;
    if (typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      candidates.push(record.message, record.stack, record.cause, record.nativeStackAndroid, record.userInfo);
      try {
        if (/unregistered\s+ActivityResultLauncher/i.test(JSON.stringify(record))) return true;
      } catch {
        // Native error objects can be cyclic; the explicit fields above still
        // cover Expo's Error and CodedError shapes.
      }
    }
  }
  return false;
}

async function launchPrivateMediaPicker(options: ImagePicker.ImagePickerOptions): Promise<ImagePicker.ImagePickerResult> {
  // A fast double tap can otherwise attempt to present two PHPicker/activity
  // controllers at once. Treat the duplicate tap like a cancellation instead
  // of leaking a native presentation error into the upload UI.
  if (mediaLibraryPickerActive) return { canceled: true, assets: null };
  mediaLibraryPickerActive = true;
  try {
    try {
      return await ImagePicker.launchImageLibraryAsync(options);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // PHPicker normally needs no broad library permission. A few iOS
      // versions/devices can nevertheless route through the legacy picker
      // after permission state or an app upgrade changes. Recover once by
      // requesting access instead of surfacing a dead-end native error.
      if (isDetachedAndroidPicker(error)) {
        // Some Android activity recreation paths can leave expo-image-picker's
        // launcher detached. The Storage Access Framework is independently
        // registered and gives the same user-controlled, per-file access.
        const requestedMedia = Array.isArray(options.mediaTypes) ? options.mediaTypes : [options.mediaTypes];
        const acceptsVideo = requestedMedia.includes("videos");
        const fallback = await DocumentPicker.getDocumentAsync({
          type: acceptsVideo ? ["image/*", "video/*"] : "image/*",
          multiple: Boolean(options.allowsMultipleSelection),
          copyToCacheDirectory: true
        });
        if (fallback.canceled) return { canceled: true, assets: null };
        return {
          canceled: false,
          assets: fallback.assets.map((asset) => {
            const videoByName = /\.(?:mp4|mov|m4v|webm|3gp|mkv)$/i.test(asset.name || "");
            const isVideo = asset.mimeType?.startsWith("video/") || (!asset.mimeType && videoByName);
            return {
              uri: asset.uri,
              width: 0,
              height: 0,
              type: isVideo ? "video" as const : "image" as const,
              fileName: asset.name,
              fileSize: asset.size,
              mimeType: asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg")
            };
          })
        };
      }
      if (Platform.OS !== "ios" || !/permission|photo(?: library)? access|rejected/i.test(reason)) throw error;
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
      if (permission.granted || permission.accessPrivileges === "limited") {
        return await ImagePicker.launchImageLibraryAsync(options);
      }
      throw new Error("PHOTO_LIBRARY_SETTINGS_REQUIRED");
    }
  } finally {
    mediaLibraryPickerActive = false;
  }
}

function decodedBase64Size(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

export async function createLightweightChatThumbnail(uri: string) {
  let width = 720;
  let quality = 0.88;
  for (let attempt = 0; attempt < 7; attempt += 1) {
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
    width = Math.max(192, Math.round(width * 0.88));
    quality = Math.max(0.48, quality - 0.055);
  }
  // A thumbnail is an optimization, never a reason to block the attachment.
  return "";
}

export async function createLightweightVideoThumbnail(uri: string) {
  // Expo Go is a generic native host and does not provide a stable lifecycle
  // for expo-video SharedRef thumbnail extraction on every iOS runtime. Keep
  // video selection usable there; embedded thumbnails are generated by the
  // linked native module in FairFares development and production builds.
  if (Platform.OS === "web" || IS_EXPO_GO) return "";
  const nativeThumbnail = await FairFaresCrypto.generateVideoThumbnail(uri, CHAT_THUMBNAIL_MAX_BYTES).catch(() => "");
  if (nativeThumbnail) return nativeThumbnail;
  if (Platform.OS === "ios") {
    // Thumbnail extraction is optional. Never fall through to an expo-video
    // player on iOS: creating a SharedRef player while the picker-owned asset
    // is being handed across JSI can abort the process (rather than throw),
    // especially for larger files or codecs without an early decodable frame.
    // The composer and message bubble already provide a safe placeholder.
    return nativeThumbnail;
  }
  const player = createVideoPlayer(uri);
  let frames: Awaited<ReturnType<typeof player.generateThumbnailsAsync>> = [];
  try {
    // The native player decodes only a small frame near the start. Passing the
    // resulting SharedRef straight to ImageManipulator avoids a full video read
    // or a JS pixel-buffer copy.
    // Some encoders have no decodable sample at 100 ms. Try the first frame,
    // then two nearby timestamps instead of treating that codec detail as a
    // thumbnail failure.
    for (const time of [0, 0.1, 1]) {
      try {
        frames = await player.generateThumbnailsAsync(time, { maxWidth: 640, maxHeight: 640 });
        if (frames[0]) break;
      } catch {
        frames.forEach((candidate) => candidate.release());
        frames = [];
      }
    }
    const frame = frames[0];
    if (!frame) return "";
    let width = 720;
    let quality = 0.88;
    for (let attempt = 0; attempt < 7; attempt += 1) {
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
      width = Math.max(192, Math.round(width * 0.88));
      quality = Math.max(0.48, quality - 0.055);
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
    // Android's Storage Access Framework does not always report dimensions.
    // Unknown dimensions must be treated as potentially full-resolution;
    // otherwise fallback-selected camera photos bypass resizing entirely.
    const actions = !asset.width || asset.width > currentWidth ? [{ resize: { width: currentWidth } }] : [];
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
    imageWidth: Number(asset.width || 0),
    imageHeight: Number(asset.height || 0),
    thumbnailBase64,
    ownedCacheFile: Platform.OS !== "web",
    kind: "IMAGE" as const
  };
}

export async function pickCompressedImages(limit = 4, maxWidth = 1280, quality = 0.72) {
  const remaining = Math.max(1, Math.min(limit, 4));
  // The system photo picker grants access only to the items the user selects.
  // It does not require broad Photo Library permission on supported iOS and
  // Android versions. Requesting that permission first incorrectly locked out
  // people who had denied full-library access even though the private picker
  // remained available.
  const result = await launchPrivateMediaPicker({
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
    let currentWidth = maxWidth;
    let currentQuality = quality;
    let accepted = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const actions = !asset.width || asset.width > currentWidth ? [{ resize: { width: currentWidth } }] : [];
      const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        base64: true,
        compress: currentQuality,
        format: encoding.format
      });
      try {
        const candidate = compressed.base64 ? `data:${encoding.mimeType};base64,${compressed.base64}` : "";
        // Stay below the server's 2.5M-character ceiling with room for form
        // encoding and request metadata. This makes group/profile uploads
        // deterministic even for high-detail photos from the SAF fallback.
        if (candidate && candidate.length <= 2_300_000) {
          accepted = candidate;
          break;
        }
      } finally {
        if (Platform.OS !== "web" && compressed.uri && compressed.uri !== asset.uri) {
          await FileSystem.deleteAsync(compressed.uri, { idempotent: true }).catch(() => undefined);
        }
      }
      currentWidth = Math.max(360, Math.round(currentWidth * 0.78));
      currentQuality = Math.max(0.36, currentQuality - 0.1);
    }
    if (!accepted) throw new Error("This image could not be reduced to a safe upload size. Choose a smaller photo.");
    images.push(accepted);
  }
  return images;
}

export async function pickChatImages(limit = 4, maxWidth = 1280, quality = 0.62, maxBytes = 350_000) {
  const selectionLimit = Math.max(1, Math.min(limit, 4));
  const result = await launchPrivateMediaPicker({
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
  const result = await launchPrivateMediaPicker({
    allowsMultipleSelection: selectionLimit > 1,
    base64: false,
    mediaTypes: ["images", "videos"],
    quality,
    selectionLimit,
    videoMaxDuration: 120,
    // Keep selection lightweight and preserve the user's Original choice.
    // Data Saver performs one explicit, observable native export later; forcing
    // an export here caused a hidden double transcode and iOS cancellations.
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.High
  });
  if (result.canceled || !result.assets.length) return [];
  const selectedAssets = result.assets.slice(0, selectionLimit);
  if (selectedAssets.filter((asset) => asset.type === "video").length > 1) {
    if (Platform.OS !== "web") {
      await Promise.all(selectedAssets.filter((asset) => asset.type === "video").map((asset) =>
        FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => undefined)
      ));
    }
    throw new Error("Choose one video at a time. You can include photos with that video.");
  }
  const videoLimit = Math.max(1_000_000, Math.min(100_000_000, maxVideoBytes));
  const results = await Promise.allSettled(selectedAssets.map(async (asset, index) => {
    if (asset.type !== "video") {
      return compressedUpload(asset, index, "chitthi", maxWidth, quality, maxBytes);
    }
    const blob = Platform.OS === "web" ? await fetch(asset.uri).then((response) => response.blob()) : undefined;
    const info = Platform.OS === "web" ? null : await FileSystem.getInfoAsync(asset.uri);
    const size = blob?.size || (info?.exists && "size" in info ? Number(info.size || 0) : Number(asset.fileSize || 0));
    if (!size) throw new Error("Could not determine the selected video size.");
    if (size > videoLimit) {
      if (Platform.OS !== "web") await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => undefined);
      throw new Error(`This video is larger than the ${Math.round(videoLimit / 1_000_000)} MB encrypted-transfer limit currently enabled for your account.`);
    }
    const mimeType = asset.mimeType || "video/mp4";
    return {
      uri: asset.uri,
      blob,
      name: asset.fileName || `chitthi-video-${Date.now()}${mimeType === "video/quicktime" ? ".mov" : ".mp4"}`,
      mimeType,
      size,
      thumbnailBase64: "",
      pickerAssetId: asset.assetId || undefined,
      ownedCacheFile: Platform.OS !== "web",
      kind: "VIDEO" as const
    };
  }));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    if (Platform.OS !== "web") {
      await Promise.all(results.flatMap((result) => result.status === "fulfilled" && result.value.ownedCacheFile
        ? [FileSystem.deleteAsync(result.value.uri, { idempotent: true }).catch(() => undefined)]
        : []));
    }
    throw failed.reason;
  }
  const prepared = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  // Photos are small and complete quickly. Send them before the encrypted
  // video so a long native transcode/upload cannot make the rest look lost.
  return prepared.sort((left, right) => Number(left.kind === "VIDEO") - Number(right.kind === "VIDEO"));
}

export async function takeChatPhoto(maxWidth = 1280, quality = 0.64, maxBytes = 400_000) {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error(permission.canAskAgain ? "Allow camera access to take a photo." : "CAMERA_SETTINGS_REQUIRED");
  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      base64: false,
      quality
    });
  } catch (error) {
    if (!isDetachedAndroidPicker(error)) throw error;
    result = await launchPrivateMediaPicker({
      allowsMultipleSelection: false,
      base64: false,
      mediaTypes: ["images"],
      quality,
      selectionLimit: 1
    });
  }
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  return compressedUpload(asset, 0, "chitthi-camera", maxWidth, quality, maxBytes);
}

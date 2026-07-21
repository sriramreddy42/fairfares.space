import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

export async function pickCompressedImages(limit = 4, maxWidth = 1280, quality = 0.72) {
  const remaining = Math.max(1, Math.min(limit, 4));
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Allow photo access to upload pictures.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: remaining > 1,
    base64: false,
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

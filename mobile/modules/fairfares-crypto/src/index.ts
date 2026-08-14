import { EventEmitter, requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export type NativeCryptoResult = { outputSize: number; sha256Base64: string };

type FairFaresCryptoNativeModule = {
  prepare(operationId: string): void;
  release(operationId: string): void;
  encryptFile(operationId: string, sourceUri: string, destinationUri: string, keyBase64: string, noncePrefixBase64: string, chunkSize: number): Promise<NativeCryptoResult>;
  decryptFile(operationId: string, sourceUri: string, destinationUri: string, keyBase64: string, noncePrefixBase64: string, chunkSize: number, plaintextSize: number, chunkCount: number): Promise<NativeCryptoResult>;
  protectFile(fileUri: string): Promise<void>;
  commitProtectedFile(sourceUri: string, destinationUri: string): Promise<void>;
  deriveRecoveryKey(passphraseBase64: string, saltBase64: string, iterations: number, outputBytes: number): Promise<string>;
  uploadMultipartPart(uploadId: string, partNumber: number, uploadUrl: string, headers: Record<string, string>, fileUri: string, expectedSize: number): Promise<{ status: number; etag: string }>;
  activeMultipartPartNumbers?(uploadId: string): Promise<number[]>;
  cancelMultipartUpload?(uploadId: string): Promise<void>;
  generateVideoThumbnail?(fileUri: string, maximumBytes: number): Promise<string>;
  generatePhotoLibraryVideoThumbnail?(assetIdentifier: string, maximumBytes: number): Promise<string>;
  stageMultipartPart?(sourceUri: string, destinationUri: string, offset: number, size: number): Promise<{ size: number; md5Base64: string }>;
  appendFile?(sourceUri: string, destinationUri: string, expectedOffset: number, expectedSize: number): Promise<{ outputSize: number }>;
  sha256File?(fileUri: string, expectedSize: number): Promise<{ size: number; sha256Base64: string }>;
  optimizeVideo?(operationId: string, sourceUri: string, destinationUri: string): Promise<{ outputSize: number; mimeType: string }>;
  prepareVideo?(operationId: string, sourceUri: string, destinationUri: string, profile: "hd" | "data-saver"): Promise<{ outputSize: number; mimeType: string }>;
  cancel(operationId: string): Promise<void>;
};

const nativeModule = Platform.OS === "ios" || Platform.OS === "android"
  ? requireOptionalNativeModule<FairFaresCryptoNativeModule>("FairFaresCrypto")
  : null;
const emitter: any = nativeModule ? new EventEmitter(nativeModule as any) : null;

function operationId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function runWithProgress<Result>(
  run: (id: string) => Promise<Result>,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<Result> {
  const id = operationId();
  let lastProgressAt = 0;
  let lastProgress = -1;
  if (signal?.aborted) throw new Error("Attachment processing was cancelled.");
  nativeModule?.prepare(id);
  const abort = () => { void nativeModule?.cancel(id); };
  signal?.addEventListener("abort", abort, { once: true });
  const subscription = emitter?.addListener("onCryptoProgress", (event: { operationId?: string; progress?: number }) => {
    if (event.operationId !== id || !onProgress) return;
    const progress = Math.max(0, Math.min(1, Number(event.progress || 0)));
    const now = Date.now();
    // Updating progress rerenders the messenger screen. Coalesce native chunk
    // events to at most 10 fps, but always deliver the initial/final state.
    if (progress === 0 || progress === 1 || now - lastProgressAt >= 100) {
      if (progress !== lastProgress) onProgress(progress);
      lastProgress = progress;
      lastProgressAt = now;
    }
  });
  try {
    const result = await run(id);
    if (onProgress && lastProgress !== 1) onProgress(1);
    return result;
  } finally {
    subscription?.remove();
    signal?.removeEventListener("abort", abort);
    nativeModule?.release(id);
  }
}

export const FairFaresCrypto = {
  available: Boolean(nativeModule),
  multipartStagingAvailable: Boolean(nativeModule?.stageMultipartPart),
  nativeFileAssemblyAvailable: Boolean(nativeModule?.appendFile && nativeModule?.sha256File),
  backgroundTaskInspectionAvailable: Boolean(nativeModule?.activeMultipartPartNumbers),
  videoOptimizationAvailable: Boolean(nativeModule?.optimizeVideo),
  videoPreparationAvailable: Boolean(nativeModule?.prepareVideo),
  encryptFile: (sourceUri: string, destinationUri: string, keyBase64: string, noncePrefixBase64: string, chunkSize: number, onProgress?: (progress: number) => void, signal?: AbortSignal) => {
    if (!nativeModule) throw new Error("Native attachment cryptography is unavailable.");
    return runWithProgress((id) => nativeModule.encryptFile(id, sourceUri, destinationUri, keyBase64, noncePrefixBase64, chunkSize), onProgress, signal);
  },
  decryptFile: (sourceUri: string, destinationUri: string, keyBase64: string, noncePrefixBase64: string, chunkSize: number, plaintextSize: number, chunkCount: number, onProgress?: (progress: number) => void, signal?: AbortSignal) => {
    if (!nativeModule) throw new Error("Native attachment cryptography is unavailable.");
    return runWithProgress((id) => nativeModule.decryptFile(id, sourceUri, destinationUri, keyBase64, noncePrefixBase64, chunkSize, plaintextSize, chunkCount), onProgress, signal);
  },
  protectFile: (fileUri: string) => nativeModule?.protectFile(fileUri) || Promise.resolve(),
  commitProtectedFile: (sourceUri: string, destinationUri: string) => nativeModule?.commitProtectedFile(sourceUri, destinationUri) || Promise.reject(new Error("Native protected commit is unavailable.")),
  deriveRecoveryKey: (passphraseBase64: string, saltBase64: string, iterations: number, outputBytes: number) => {
    if (!nativeModule) return Promise.reject(new Error("Native recovery derivation is unavailable."));
    return nativeModule.deriveRecoveryKey(passphraseBase64, saltBase64, iterations, outputBytes);
  },
  uploadMultipartPart: (uploadId: string, partNumber: number, uploadUrl: string, headers: Record<string, string>, fileUri: string, expectedSize: number) => {
    if (!nativeModule || Platform.OS !== "ios") return Promise.reject(new Error("Native background upload is unavailable."));
    return nativeModule.uploadMultipartPart(uploadId, partNumber, uploadUrl, headers, fileUri, expectedSize);
  },
  activeMultipartPartNumbers: (uploadId: string) => {
    if (!nativeModule?.activeMultipartPartNumbers || Platform.OS !== "ios") return Promise.resolve([]);
    return nativeModule.activeMultipartPartNumbers(uploadId);
  },
  cancelMultipartUpload: (uploadId: string) => {
    if (!nativeModule?.cancelMultipartUpload || Platform.OS !== "ios") return Promise.resolve();
    return nativeModule.cancelMultipartUpload(uploadId);
  },
  generateVideoThumbnail: (fileUri: string, maximumBytes = 5_000) => {
    if (!nativeModule?.generateVideoThumbnail || Platform.OS !== "ios") return Promise.reject(new Error("Native video thumbnail generation is unavailable."));
    return nativeModule.generateVideoThumbnail(fileUri, maximumBytes);
  },
  generatePhotoLibraryVideoThumbnail: (assetIdentifier: string, maximumBytes = 5_000) => {
    if (!nativeModule?.generatePhotoLibraryVideoThumbnail || Platform.OS !== "ios") return Promise.reject(new Error("Native photo-library video thumbnail generation is unavailable."));
    return nativeModule.generatePhotoLibraryVideoThumbnail(assetIdentifier, maximumBytes);
  },
  stageMultipartPart: (sourceUri: string, destinationUri: string, offset: number, size: number) => {
    if (!nativeModule?.stageMultipartPart || Platform.OS !== "ios") return Promise.reject(new Error("Native multipart staging is unavailable."));
    return nativeModule.stageMultipartPart(sourceUri, destinationUri, offset, size);
  },
  appendFile: (sourceUri: string, destinationUri: string, expectedOffset: number, expectedSize: number) => {
    if (!nativeModule?.appendFile) return Promise.reject(new Error("Native file assembly is unavailable."));
    return nativeModule.appendFile(sourceUri, destinationUri, expectedOffset, expectedSize);
  },
  sha256File: (fileUri: string, expectedSize: number) => {
    if (!nativeModule?.sha256File) return Promise.reject(new Error("Native file hashing is unavailable."));
    return nativeModule.sha256File(fileUri, expectedSize);
  },
  optimizeVideo: (sourceUri: string, destinationUri: string, onProgress?: (progress: number) => void, signal?: AbortSignal) => {
    if (!nativeModule?.optimizeVideo || Platform.OS !== "ios") return Promise.reject(new Error("Native video optimization is unavailable."));
    return runWithProgress((id) => nativeModule.optimizeVideo!(id, sourceUri, destinationUri), onProgress, signal);
  },
  prepareVideo: (sourceUri: string, destinationUri: string, profile: "hd" | "data-saver", onProgress?: (progress: number) => void, signal?: AbortSignal) => {
    if (!nativeModule?.prepareVideo || Platform.OS !== "ios") return Promise.reject(new Error("Native compatible video preparation is unavailable."));
    return runWithProgress((id) => nativeModule.prepareVideo!(id, sourceUri, destinationUri, profile), onProgress, signal);
  },
  cancel: (id: string) => nativeModule?.cancel(id) || Promise.resolve()
};

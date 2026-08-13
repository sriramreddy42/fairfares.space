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
  cancel(operationId: string): Promise<void>;
};

const nativeModule = Platform.OS === "ios" || Platform.OS === "android"
  ? requireOptionalNativeModule<FairFaresCryptoNativeModule>("FairFaresCrypto")
  : null;
const emitter: any = nativeModule ? new EventEmitter(nativeModule as any) : null;

function operationId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function runWithProgress(
  run: (id: string) => Promise<NativeCryptoResult>,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
) {
  const id = operationId();
  if (signal?.aborted) throw new Error("Attachment processing was cancelled.");
  nativeModule?.prepare(id);
  const abort = () => { void nativeModule?.cancel(id); };
  signal?.addEventListener("abort", abort, { once: true });
  const subscription = emitter?.addListener("onCryptoProgress", (event: { operationId?: string; progress?: number }) => {
    if (event.operationId === id) onProgress?.(Math.max(0, Math.min(1, Number(event.progress || 0))));
  });
  try {
    return await run(id);
  } finally {
    subscription?.remove();
    signal?.removeEventListener("abort", abort);
    nativeModule?.release(id);
  }
}

export const FairFaresCrypto = {
  available: Boolean(nativeModule),
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
  cancel: (id: string) => nativeModule?.cancel(id) || Promise.resolve()
};

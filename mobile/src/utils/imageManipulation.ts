import * as ImageManipulator from "expo-image-manipulator";
import type { SaveOptions as ImageSaveOptions } from "expo-image-manipulator";

let imageManipulationQueue: Promise<void> = Promise.resolve();

function isLostImageContext(error: unknown) {
  return /image context has been lost|shared object.*(?:released|lost)|native shared object/i.test(
    error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error)
  );
}

export async function manipulateImageSafely(uri: string, width: number | null, options: ImageSaveOptions) {
  const operation = async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = ImageManipulator.ImageManipulator.manipulate(uri);
      let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      try {
        if (width) context.resize({ width });
        rendered = await context.renderAsync();
        return await rendered.saveAsync(options);
      } catch (error) {
        lastError = error;
        if (attempt > 0 || !isLostImageContext(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 80));
      } finally {
        try { rendered?.release(); } catch { /* The native image may already have been reclaimed. */ }
        try { context.release(); } catch { /* A lost context is already released natively. */ }
      }
    }
    throw lastError;
  };
  // Retain only one native image context at a time. Large iPhone photos and
  // parallel chat thumbnails can otherwise pressure Expo shared objects into
  // being released before their background render completes.
  const queued = imageManipulationQueue.then(operation, operation);
  imageManipulationQueue = queued.then(() => undefined, () => undefined);
  return await queued;
}

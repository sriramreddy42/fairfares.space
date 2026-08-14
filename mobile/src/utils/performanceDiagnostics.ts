import { AppState } from "react-native";

type DiagnosticFields = Record<string, string | number | boolean | null | undefined>;

type PerformanceOperation = {
  id: string;
  progress: (progress: number, fields?: DiagnosticFields) => void;
  complete: (fields?: DiagnosticFields) => void;
  fail: (error: unknown, fields?: DiagnosticFields) => void;
};

let currentContext = "startup";

export function setPerformanceContext(context: string) {
  currentContext = context || "unknown";
}

export function logDevelopmentPerformance(stage: string, fields: DiagnosticFields = {}, warning = false) {
  if (!__DEV__) return;
  const entry = { stage, context: currentContext, at: new Date().toISOString(), ...fields };
  if (warning) console.warn("[FairFares performance]", entry);
  else console.info("[FairFares performance]", entry);
}

function safeErrorType(error: unknown) {
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}

/** Development-only operation timing without private content, URLs, keys, or filenames. */
export function startDevelopmentPerformanceOperation(
  operation: string,
  fields: DiagnosticFields = {},
  progressStepPercent = 25
): PerformanceOperation {
  if (!__DEV__) {
    return { id: "", progress: () => undefined, complete: () => undefined, fail: () => undefined };
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();
  let lastProgressBucket = -1;
  let settled = false;
  let backgrounded = AppState.currentState !== "active";
  const appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state !== "active") backgrounded = true;
  });
  logDevelopmentPerformance(`${operation}-start`, { operationId: id, appState: AppState.currentState, ...fields });
  return {
    id,
    progress(progress, progressFields = {}) {
      if (settled || !Number.isFinite(progress)) return;
      const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
      const bucket = percent === 100 ? 100 : Math.floor(percent / progressStepPercent) * progressStepPercent;
      if (bucket <= lastProgressBucket) return;
      lastProgressBucket = bucket;
      logDevelopmentPerformance(`${operation}-progress`, {
        operationId: id, elapsedMs: Date.now() - startedAt, percent: bucket, ...progressFields,
      });
    },
    complete(completeFields = {}) {
      if (settled) return;
      settled = true;
      appStateSubscription.remove();
      logDevelopmentPerformance(`${operation}-complete`, {
        operationId: id, durationMs: Date.now() - startedAt, backgrounded, ...completeFields,
      });
    },
    fail(error, failureFields = {}) {
      if (settled) return;
      settled = true;
      appStateSubscription.remove();
      logDevelopmentPerformance(`${operation}-failed`, {
        operationId: id, durationMs: Date.now() - startedAt, backgrounded, errorType: safeErrorType(error), ...failureFields,
      }, true);
    },
  };
}

export function startJavaScriptResponsivenessMonitor() {
  if (!__DEV__) return () => undefined;
  const intervalMs = 500;
  let expectedAt = Date.now() + intervalMs;
  let lastReportedAt = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    const lagMs = Math.max(0, now - expectedAt);
    expectedAt = now + intervalMs;
    if (AppState.currentState !== "active" || lagMs < 250 || now - lastReportedAt < 1000) return;
    lastReportedAt = now;
    logDevelopmentPerformance("js-thread-stall", { lagMs }, true);
  }, intervalMs);
  return () => clearInterval(timer);
}

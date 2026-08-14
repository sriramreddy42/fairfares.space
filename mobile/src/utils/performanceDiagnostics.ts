import { AppState } from "react-native";

type DiagnosticFields = Record<string, string | number | boolean | null | undefined>;

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

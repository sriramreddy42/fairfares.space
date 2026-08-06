import Constants from "expo-constants";
import { Platform } from "react-native";
import { API_URL } from "../api/client";

export type DiagnosticKind = "render_crash" | "api_5xx" | "network_failure" | "manual";

function referenceId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitize(value: unknown, maximum = 500) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, "[phone]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, maximum);
}

export async function reportDiagnostic(input: {
  kind: DiagnosticKind;
  error?: unknown;
  message?: string;
  stack?: string;
  screen?: string;
  requestId?: string;
  referenceId?: string;
}) {
  const id = input.referenceId || referenceId();
  const error = input.error instanceof Error ? input.error : null;
  const payload = {
    reference_id: id,
    kind: input.kind,
    message: sanitize(input.message || error?.message || input.error),
    stack: sanitize(input.stack || error?.stack, 3000),
    screen: sanitize(input.screen, 80),
    request_id: sanitize(input.requestId, 40),
    platform: Platform.OS,
    app_version: String(Constants.expoConfig?.version || "unknown"),
    build_version: String(
      Platform.OS === "ios"
        ? Constants.expoConfig?.ios?.buildNumber || "unknown"
        : Constants.expoConfig?.android?.versionCode || "unknown"
    )
  };
  try {
    await fetch(`${API_URL}/api/mobile/diagnostics`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    // Monitoring must never interrupt the user flow or trigger another report.
  }
  return id;
}

export function createDiagnosticReference() {
  return referenceId();
}

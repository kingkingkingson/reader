import { setDiagnosticReporter } from "@reader/api";
import {
  diagnosticError,
  redact,
  type DiagnosticEvent,
} from "../../../packages/reader-core/src/diagnostics";
import { version } from "../../desktop/package.json";

let pending = Promise.resolve();
let token = "";
export function reportDiagnostic(event: DiagnosticEvent) {
  const safe = redact(event, [token]) as DiagnosticEvent;
  if (window.readerDesktop?.recordDiagnostic) {
    window.readerDesktop.recordDiagnostic(safe);
  } else if (token) {
    pending = pending.then(async () => {
      try {
        await fetch("/api/diagnostics/events", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(safe),
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        /* Reporting cannot throw or recursively report a failure. */
      }
    });
  }
}

export function installDiagnostics(sessionToken: string) {
  token = sessionToken;
  setDiagnosticReporter(reportDiagnostic);
  const error = (event: ErrorEvent) =>
    reportDiagnostic({
      level: "error",
      event: "window.error",
      ...diagnosticError(event.error),
    });
  const rejection = (event: PromiseRejectionEvent) =>
    reportDiagnostic({
      level: "error",
      event: "window.rejection",
      ...diagnosticError(event.reason),
    });
  window.addEventListener("error", error);
  window.addEventListener("unhandledrejection", rejection);
  reportDiagnostic({
    level: "info",
    event: "renderer.start",
    detail: `Reader ${version}`,
  });
  return () => {
    window.removeEventListener("error", error);
    window.removeEventListener("unhandledrejection", rejection);
    setDiagnosticReporter(undefined);
  };
}

export async function exportDiagnostics(): Promise<boolean> {
  reportDiagnostic({ level: "info", event: "diagnostics.export_requested" });
  if (window.readerDesktop?.exportDiagnostics)
    return window.readerDesktop.exportDiagnostics();
  await pending;
  const response = await fetch("/api/diagnostics/export", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("无法导出日志，请确认本地服务仍在运行。");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `Reader-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

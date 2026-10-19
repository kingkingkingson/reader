import {
  diagnosticError,
  diagnosticRoute,
  type DiagnosticEvent,
} from "../../reader-core/src/diagnostics";

let reporter: ((event: DiagnosticEvent) => void) | undefined;
export function setDiagnosticReporter(next?: (event: DiagnosticEvent) => void) {
  reporter = next;
}
export function reportDiagnostic(event: DiagnosticEvent) {
  try {
    reporter?.(event);
  } catch {
    /* Logging cannot change API behavior. */
  }
}
export async function diagnosticFetch(path: string, init: RequestInit = {}) {
  const started = performance.now();
  const route = diagnosticRoute(path);
  const method = init.method || "GET";
  reportDiagnostic({ level: "info", event: "api.start", route, method });
  try {
    const response = await fetch(path, init);
    reportDiagnostic({
      level: response.ok ? "info" : "error",
      event: "api.finish",
      route,
      method,
      status: response.status,
      requestId: response.headers.get("X-Reader-Request-ID") || undefined,
      durationMs: Math.round(performance.now() - started),
    });
    return response;
  } catch (error) {
    reportDiagnostic({
      level: init.signal?.aborted ? "info" : "error",
      event: init.signal?.aborted ? "api.cancelled" : "api.failed",
      route,
      method,
      durationMs: Math.round(performance.now() - started),
      ...diagnosticError(error),
    });
    throw error;
  }
}

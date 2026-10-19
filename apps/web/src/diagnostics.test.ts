// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { exportDiagnostics, installDiagnostics } from "./diagnostics";
import { DiagnosticExport } from "./DiagnosticExport";
import { AppCrash, ErrorBoundary } from "./ErrorBoundary";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.readerDesktop;
});
it("exports through the desktop bridge even when all network requests fail", async () => {
  const exportBundle = vi.fn().mockResolvedValue(true),
    record = vi.fn();
  Object.defineProperty(window, "readerDesktop", {
    configurable: true,
    value: { exportDiagnostics: exportBundle, recordDiagnostic: record },
  });
  const fetch = vi.fn().mockRejectedValue(new Error("sidecar down"));
  vi.stubGlobal("fetch", fetch);
  const remove = installDiagnostics("private-token");
  try {
    expect(await exportDiagnostics()).toBe(true);
    expect(exportBundle).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    const error = new Error("PRIVATE DOCUMENT");
    window.dispatchEvent(new ErrorEvent("error", { error }));
    expect(JSON.stringify(record.mock.calls)).not.toContain("private-token");
    expect(JSON.stringify(record.mock.calls)).not.toContain("PRIVATE DOCUMENT");
    expect(JSON.stringify(record.mock.calls)).toContain("window.error");
  } finally {
    remove();
  }
});

it("keeps the export action inside the React crash fallback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const exportBundle = vi.fn().mockResolvedValue(true),
    record = vi.fn();
  Object.defineProperty(window, "readerDesktop", {
    configurable: true,
    value: { exportDiagnostics: exportBundle, recordDiagnostic: record },
  });
  const rootElement = document.createElement("div");
  const root = createRoot(rootElement);
  function Broken() {
    throw new Error("PRIVATE QUESTION");
    return createElement(DiagnosticExport);
  }
  try {
    await act(async () =>
      root.render(
        createElement(
          ErrorBoundary,
          { fallback: createElement(AppCrash) },
          createElement(Broken),
        ),
      ),
    );
    expect(rootElement.textContent).toContain("界面出现错误");
    const exportButton = Array.from(
      rootElement.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("导出全部日志"))!;
    await act(async () => exportButton.click());
    expect(exportBundle).toHaveBeenCalledOnce();
    expect(JSON.stringify(record.mock.calls)).toContain("react.render_failed");
    expect(JSON.stringify(record.mock.calls)).not.toContain("PRIVATE QUESTION");
  } finally {
    await act(async () => root.unmount());
  }
});

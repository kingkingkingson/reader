// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexHandoffButton } from "./CodexHandoffButton";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@reader/api", () => ({ api: { codexHandoff: mocks.prepare } }));
vi.mock("sonner", () => ({
  toast: { error: mocks.error, success: mocks.success },
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({
    threadId: "01900000-0000-7000-8000-000000000002",
  });
  mocks.open.mockResolvedValue(undefined);
  Object.defineProperty(window, "readerDesktop", {
    configurable: true,
    value: { openCodexThread: mocks.open },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.readerDesktop;
  vi.unstubAllGlobals();
});
async function render(disabled = false) {
  await act(async () =>
    root.render(<CodexHandoffButton documentId="paper" disabled={disabled} />),
  );
  return host.querySelector("button")!;
}
it("opens only after the server has safely created the copy", async () => {
  const button = await render();
  await act(async () => button.click());
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith("paper");
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
    "01900000-0000-7000-8000-000000000002",
  );
});
it("does not hand off an active or unavailable conversation", async () => {
  const button = await render(true);
  await act(async () => button.click());
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("does not open Codex on failed preparation or a malformed thread id", async () => {
  mocks.prepare.mockRejectedValueOnce(new Error("请先完成阅读对话"));
  const button = await render();
  await act(async () => button.click());
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith("请先完成阅读对话");
  mocks.prepare.mockResolvedValueOnce({ threadId: "new?prompt=run" });
  await act(async () => button.click());
  expect(mocks.open).not.toHaveBeenCalled();
});
it("allows reopening the saved copy after an OS launch failure", async () => {
  mocks.open.mockRejectedValueOnce(new Error("not installed"));
  const button = await render();
  await act(async () => button.click());
  expect(mocks.error).toHaveBeenCalledWith(
    expect.stringContaining("接续对话已保存"),
  );
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(mocks.open).toHaveBeenCalledTimes(2);
});

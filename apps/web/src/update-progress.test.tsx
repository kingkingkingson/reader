// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { UpdateProgress } from "@reader/core";
import { useUpdateProgress } from "./update-progress";
vi.mock("sonner", () => ({ toast: { loading: vi.fn(), dismiss: vi.fn() } }));
function Host() {
  useUpdateProgress();
  return null;
}
afterEach(() => {
  delete window.readerDesktop;
  vi.clearAllMocks();
});
it("shows download progress in one toast and dismisses it when cleared", async () => {
  let emit: (progress: UpdateProgress | null) => void = () => {};
  const unsubscribe = vi.fn();
  window.readerDesktop = {
    onUpdateProgress: (callback: typeof emit) => {
      emit = callback;
      return unsubscribe;
    },
  } as unknown as typeof window.readerDesktop;
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Host />));
  const mb = 1024 * 1024;
  emit({
    version: "0.6.2",
    phase: "download",
    received: 50 * mb,
    total: 200 * mb,
  });
  expect(toast.loading).toHaveBeenLastCalledWith(
    "正在下载 Reader 0.6.2",
    expect.objectContaining({ id: "reader-update" }),
  );
  const description = renderToStaticMarkup(
    vi.mocked(toast.loading).mock.lastCall![1]!.description as ReactElement,
  );
  expect(description).toContain("50 / 200 MB");
  expect(description).toContain("开启代理");
  emit({ version: "0.6.2", phase: "prepare", received: 0 });
  expect(toast.loading).toHaveBeenLastCalledWith(
    "正在准备安装 Reader 0.6.2",
    expect.objectContaining({ id: "reader-update" }),
  );
  emit(null);
  expect(toast.dismiss).toHaveBeenCalledWith("reader-update");
  await act(async () => root.unmount());
  expect(unsubscribe).toHaveBeenCalled();
});

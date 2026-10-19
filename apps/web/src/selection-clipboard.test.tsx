// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultTheme,
  type Annotation,
  type ReaderSelection,
} from "@reader/core";
import { copyText } from "./chat/clipboard";
import { useSelectionClipboard } from "./useSelectionClipboard";
vi.mock("./chat/clipboard", () => ({ copyText: vi.fn(async () => true) }));
let root: Root;
let host: HTMLDivElement;
let clipboard: ReturnType<typeof useSelectionClipboard>;
function Harness({ enabled }: { enabled?: boolean }) {
  clipboard = useSelectionClipboard(enabled);
  return null;
}
const selection: ReaderSelection = {
  text: "选中文字",
  location: { type: "pdf", page: 1 },
};
const mark = (kind: Annotation["kind"]) =>
  ({ kind, quote: "批注原文" }) as Annotation;
const render = async (enabled?: boolean) =>
  act(async () => {
    root.render(<Harness enabled={enabled} />);
  });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it.each([undefined, false])(
  "does not copy selections or marks when disabled (%s)",
  async (enabled) => {
    expect(defaultTheme.autoCopySelection).toBe(false);
    await render(enabled);
    clipboard.selection(selection);
    clipboard.annotation(mark("highlight"));
    clipboard.annotation(mark("underline"));
    expect(copyText).not.toHaveBeenCalled();
  },
);
it("copies opted-in events, deduplicates selection events and permits reselection", async () => {
  await render(true);
  clipboard.selection(selection);
  clipboard.selection(selection);
  expect(copyText).toHaveBeenCalledTimes(1);
  clipboard.selection(null);
  clipboard.selection(selection);
  expect(copyText).toHaveBeenCalledTimes(2);
  clipboard.annotation(mark("highlight"));
  clipboard.annotation(mark("underline"));
  expect(copyText).toHaveBeenCalledTimes(4);
  expect(copyText).toHaveBeenCalledWith("选中文字", "已复制");
  expect(copyText).toHaveBeenCalledWith("批注原文", "已复制");
});
it("applies setting changes without copying the existing selection on enable", async () => {
  await render(true);
  clipboard.selection(selection);
  await render(false);
  clipboard.selection(selection);
  clipboard.annotation(mark("highlight"));
  expect(copyText).toHaveBeenCalledTimes(1);
  await render(true);
  expect(copyText).toHaveBeenCalledTimes(1);
  clipboard.selection(selection);
  expect(copyText).toHaveBeenCalledTimes(2);
});

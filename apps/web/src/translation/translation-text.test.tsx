// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationText } from "./TranslationText";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each([
  "Algorithm 1: Read phase\n1     Function read(txn, record)\n2         latch(record)",
  "Algorithm 2: use ``` and `x` inside",
])("renders algorithm text as a code block: %s", async (text) => {
  await act(async () =>
    root.render(
      <TranslationText
        block={{ id: "p7-b9", label: "algorithm", text }}
        documentId="doc"
        retry={() => {}}
      />,
    ),
  );
  await vi.waitFor(() =>
    expect(host.querySelector(".translation-algorithm pre code")).toBeTruthy(),
  );
  expect(
    host.querySelector(".translation-algorithm pre code")?.textContent,
  ).toBe(`${text}\n`);
});

it("retranslates a finished paragraph and saves a double-clicked sentence", async () => {
  const retranslate = vi.fn();
  const onSave = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <TranslationText
        block={{ id: "p1-b1", label: "text", text: "First sentence." }}
        documentId="doc"
        retry={() => {}}
        retranslate={retranslate}
        onSave={onSave}
        translation={{
          blockId: "p1-b1",
          sourceHash: "h",
          status: "complete",
          sentences: [{ source: "First sentence.", target: "第一句。" }],
        }}
      />,
    ),
  );
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "重新翻译",
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  expect(retranslate).toHaveBeenCalledOnce();
  await act(async () =>
    host
      .querySelector(".translation-sentence")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  const editor = host.querySelector("textarea");
  expect(editor?.getAttribute("aria-label")).toBe("编辑译文");
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setValue.call(editor, "改过。");
    editor!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => editor!.blur());
  expect(onSave).toHaveBeenCalledWith(0, "改过。");
});

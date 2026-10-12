// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import { DocumentNotePage } from "./DocumentNotePage";
import { clearDocumentNotes } from "./document-note";

vi.mock("@reader/api", () => ({
  api: {
    documentNote: vi.fn(async () => ({ body: "" })),
    saveDocumentNote: vi.fn(async (_id: string, body: string) => ({ body })),
    saveNoteImage: vi.fn(async () => ({ id: `${"a".repeat(32)}.png` })),
    noteImage: vi.fn(
      async () => new Blob([Uint8Array.from([1])], { type: "image/png" }),
    ),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  clearDocumentNotes();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearDocumentNotes();
  vi.useRealTimers();
});

const type = (el: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

it("saves one markdown note and renders the preview", async () => {
  await act(async () => root.render(<DocumentNotePage documentId="paper-1" />));
  const field = document.body.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="论文笔记"]',
  )!;
  await act(async () => type(field, "这是 **术语**"));
  expect(api.saveDocumentNote).not.toHaveBeenCalled();
  const preview = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "预览",
  )!;
  await act(async () => preview.click());
  await act(async () => {
    await vi.dynamicImportSettled?.();
  });
  expect(
    document.body.querySelector(".message-markdown strong")?.textContent,
  ).toBe("术语");
  await act(async () => vi.advanceTimersByTime(900));
  expect(api.saveDocumentNote).toHaveBeenCalledExactlyOnceWith(
    "paper-1",
    "这是 **术语**",
  );
});

it("pastes a clipboard image into the note and previews it", async () => {
  if (typeof URL.createObjectURL !== "function") {
    Object.assign(URL, {
      createObjectURL: () => "",
      revokeObjectURL: () => {},
    });
  }
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:note-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  await act(async () => root.render(<DocumentNotePage documentId="paper-1" />));
  const field = document.body.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="论文笔记"]',
  )!;
  const file = new File([Uint8Array.from([1, 2, 3])], "shot.png", {
    type: "image/png",
  });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      getData: () => "",
    },
  });
  await act(async () => {
    field.dispatchEvent(event);
  });
  const image = `![](note-image:${"a".repeat(32)}.png)`;
  expect(field.value).toBe(image);
  expect(api.saveNoteImage).toHaveBeenCalledOnce();
  const preview = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "预览",
  )!;
  await act(async () => preview.click());
  await act(async () => {
    await vi.dynamicImportSettled?.();
  });
  expect(
    document.body.querySelector("img.note-image")?.getAttribute("src"),
  ).toBe("blob:note-image");
  expect(document.body.innerHTML).not.toContain("<script");
});

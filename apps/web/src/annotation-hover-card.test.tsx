// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Annotation, ReaderAnnotationTarget } from "@reader/core";
import { AnnotationHoverCard } from "./AnnotationHoverCard";
const target: ReaderAnnotationTarget = {
  ids: ["a", "b"],
  anchor: { x: 100, top: 80, bottom: 100 },
};
const annotations = [
  { id: "a", note: "具体批注内容" },
  { id: "b", note: "第二条批注" },
] as Annotation[];
const edit = vi.fn();
let root: Root, host: HTMLDivElement;
const render = async (
  value: ReaderAnnotationTarget | null,
  notes = annotations,
) => {
  await act(async () =>
    root.render(
      <AnnotationHoverCard target={value} annotations={notes} onEdit={edit} />,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(160);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  edit.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("shows all notes without stealing focus and edits the chosen note", async () => {
  const input = document.createElement("input");
  host.append(input);
  input.focus();
  await render(target);
  expect(document.body.textContent).toContain("具体批注内容");
  expect(document.body.textContent).toContain("第二条批注");
  expect(document.activeElement).not.toBe(
    document.querySelector('[aria-label="编辑批注"]'),
  );
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    '[aria-label="编辑批注"]',
  );
  await act(async () => buttons[1].click());
  expect(edit).toHaveBeenCalledExactlyOnceWith(annotations[1]);
});
it("allows crossing into the card and closes after leaving", async () => {
  await render(target);
  await render(null);
  const card = document.querySelector("[data-annotation-preview]")!;
  await act(async () =>
    card.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(document.body.textContent).toContain("具体批注内容");
  await act(async () =>
    card.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(document.querySelector("[data-annotation-preview]")).toBeNull();
});
it("does not show an empty note and removes deleted notes", async () => {
  await render(
    target,
    annotations.map((a) => ({ ...a, note: " " })),
  );
  expect(document.querySelector("[data-annotation-preview]")).toBeNull();
  await render(target);
  expect(document.body.textContent).toContain("具体批注内容");
  await render(target, []);
  expect(document.querySelector("[data-annotation-preview]")).toBeNull();
});

it("closes when reading scrolls so it cannot remain attached to an old position", async () => {
  await render(target);
  await act(async () => window.dispatchEvent(new Event("scroll")));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(document.querySelector("[data-annotation-preview]")).toBeNull();
});

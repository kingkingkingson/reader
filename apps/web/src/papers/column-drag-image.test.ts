// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setColumnDragImage } from "./column-drag-image";

let paint: FrameRequestCallback;
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    paint = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const rect = (top: number, height: number) => ({
  x: 400,
  y: top,
  left: 400,
  top,
  width: 160,
  height,
  right: 560,
  bottom: top + height,
  toJSON: () => ({}),
});

it("snapshots just the visible column, clips the last row and cleans up the source", () => {
  const pane = document.createElement("div");
  pane.className = "paper-list-pane";
  pane.innerHTML =
    '<table><thead><tr><th data-column="authors">作者</th></tr></thead><tbody></tbody></table>';
  document.body.append(pane);
  vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(rect(100, 100));
  const source = pane.querySelector<HTMLElement>("th")!;
  vi.spyOn(source, "getBoundingClientRect").mockReturnValue(rect(100, 30));
  const tbody = pane.querySelector("tbody")!;
  const measures = [];
  for (let i = 0; i < 1000; i++) {
    const row = document.createElement("tr");
    row.innerHTML = `<td data-column="authors">Author ${i}</td><td data-column="year">2026</td>`;
    tbody.append(row);
    measures.push(
      vi
        .spyOn(row.firstElementChild as HTMLElement, "getBoundingClientRect")
        .mockReturnValue(rect(130 + i * 40, 40)),
    );
  }
  const transfer = { setDragImage: vi.fn() };
  const cleanup = setColumnDragImage(
    source,
    transfer as unknown as DataTransfer,
    407,
    111,
  );
  const [preview, x, y] = transfer.setDragImage.mock.calls[0];
  expect([x, y]).toEqual([7, 11]);
  expect(preview.querySelectorAll("th, td")).toHaveLength(3);
  expect(preview.textContent).toBe("作者Author 0Author 1");
  expect(preview.style.height).toBe("100px");
  expect(preview.querySelectorAll("table")[2].style.top).toBe("70px");
  expect(measures[999]).not.toHaveBeenCalled();
  expect(source.classList.contains("paper-column-source")).toBe(true);
  paint(0);
  expect(preview.isConnected).toBe(false);
  cleanup();
  expect(source.classList.contains("paper-column-source")).toBe(false);
});

it("normalizes a lower menu item and removes cloned label IDs", () => {
  const source = document.createElement("div");
  source.className = "paper-column-option";
  source.innerHTML =
    '<label for="original"><input id="original" />标签</label>';
  document.body.append(source);
  vi.spyOn(source, "getBoundingClientRect").mockReturnValue(rect(540, 32));
  const transfer = { setDragImage: vi.fn() };
  const cleanup = setColumnDragImage(
    source,
    transfer as unknown as DataTransfer,
    411,
    558,
  );
  const [preview, x, y] = transfer.setDragImage.mock.calls[0];
  expect([x, y]).toEqual([11, 18]);
  expect(preview.style.top).toBe("0px");
  expect(preview.style.height).toBe("32px");
  expect(preview.querySelector("[id], [for]")).toBeNull();
  cleanup();
  expect(preview.isConnected).toBe(false);
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
});

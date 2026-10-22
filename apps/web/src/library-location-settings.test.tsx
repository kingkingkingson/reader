// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryLocationSettings } from "./LibraryLocationSettings";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () => {
    root.render(<LibraryLocationSettings open={true} />);
  });
it("hides the desktop-only setting in a browser", async () => {
  await render();
  expect(host.innerHTML).toBe("");
});
it("shows the active location and keeps editing blocked while moving", async () => {
  let finish!: (value: boolean) => void;
  const api = {
    platform: "darwin",
    libraryLocation: vi.fn(async () => "/current/library"),
    moveLibrary: vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  vi.stubGlobal("readerDesktop", api);
  await render();
  expect(host.textContent).toContain("/current/library");
  await act(async () => host.querySelector("button")!.click());
  expect(api.moveLibrary).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("正在更改书库位置");
  expect(host.querySelector("button")!.disabled).toBe(true);
  await act(async () => finish(false));
  expect(host.querySelector("button")!.disabled).toBe(false);
});
it("shows errors and allows retry without changing the displayed location", async () => {
  vi.stubGlobal("readerDesktop", {
    platform: "darwin",
    libraryLocation: async () => "/current/library",
    moveLibrary: async () => {
      throw new Error("目标已存在");
    },
  });
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("目标已存在");
  expect(host.textContent).toContain("/current/library");
  expect(host.querySelector("button")!.disabled).toBe(false);
});

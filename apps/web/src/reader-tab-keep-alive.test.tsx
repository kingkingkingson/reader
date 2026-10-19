// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Document } from "@reader/core";
import { App } from "./App";
import { useReaderStore } from "./store";

vi.mock("@reader/api", async () => {
  const { version } = await import("../../desktop/package.json");
  return {
    RequestError: class RequestError extends Error {
      code = "";
      pages = 0;
    },
    api: new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return undefined;
          return vi.fn(async () => {
            if (prop === "connectorRevision") return { revision: 1 };
            if (prop === "libraryPreferences") return { primaryMode: "books" };
            if (prop === "guidePreferences")
              return { onboarded: true, seenVersion: version };
            if (
              prop === "documents" ||
              prop === "trash" ||
              prop === "processing"
            )
              return [];
            return {};
          });
        },
      },
    ),
  };
});
vi.mock("./Workspace", () => ({
  Workspace: ({
    document,
    active,
  }: {
    document: { id: string };
    active?: boolean;
  }) => (
    <section data-reader={document.id} data-active={String(active === true)} />
  ),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

const doc = (id: string, title: string) =>
  ({ id, title, type: "pdf", library: "books" }) as Document;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  useReaderStore.setState({
    documents: [],
    tabs: [],
    active: null,
    trash: [],
    libraryPreferences: { primaryMode: "books", mode: "books" },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps an opened reader mounted when switching tabs and returning", async () => {
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  const alpha = doc("a", "Alpha");
  const beta = doc("b", "Beta");
  act(() => {
    useReaderStore.getState().open(alpha);
    useReaderStore.getState().open(beta);
  });
  const first = host.querySelector('[data-reader="a"]');
  const second = host.querySelector('[data-reader="b"]');
  expect(first?.getAttribute("data-active")).toBe("false");
  expect(second?.getAttribute("data-active")).toBe("true");
  expect(
    host.querySelector(".library-shell")?.hasAttribute("data-hidden"),
  ).toBe(true);

  act(() => useReaderStore.getState().open(alpha));
  expect(host.querySelector('[data-reader="a"]')).toBe(first);
  expect(host.querySelector('[data-reader="b"]')).toBe(second);
  expect(first?.getAttribute("data-active")).toBe("true");
  expect(second?.getAttribute("data-active")).toBe("false");

  act(() => useReaderStore.getState().open(null));
  expect(host.querySelector('[data-reader="a"]')).toBe(first);
  expect(
    host.querySelector(".library-shell")?.hasAttribute("data-hidden"),
  ).toBe(false);

  act(() => useReaderStore.getState().open(beta));
  expect(host.querySelector('[data-reader="a"]')).toBe(first);
  expect(host.querySelector('[data-reader="b"]')).toBe(second);
  expect(second?.getAttribute("data-active")).toBe("true");

  act(() => useReaderStore.getState().closeTab("a"));
  expect(host.querySelector('[data-reader="a"]')).toBeNull();
  expect(host.querySelector('[data-reader="b"]')).toBe(second);
});

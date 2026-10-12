// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTheme, type Document, type ReaderTheme } from "@reader/core";
import { ReaderView } from "./ReaderView";

const setTheme = vi.fn(async (_theme: ReaderTheme) => {});
const open = vi.fn(async () => {});

vi.mock("./readers/pdf", () => ({
  PDFReaderAdapter: class {
    preferTheme() {}
    open = open;
    setTheme = setTheme;
    highlight = vi.fn(async () => {});
    getTOC = vi.fn(async () => []);
    destroy = vi.fn(async () => {});
    setBlocks() {}
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("fits a PDF to the pane width when it opens, even after a saved zoom", async () => {
  const zoom = vi.fn();
  const paper = { id: "paper", type: "pdf", title: "Paper" } as Document;
  await act(async () => {
    root.render(
      <ReaderView
        document={paper}
        theme={{ ...defaultTheme, zoom: 1.5 }}
        annotations={[]}
        onReady={() => {}}
        events={{
          zoom,
          location: () => {},
          selection: () => {},
        }}
      />,
    );
  });
  expect(setTheme).toHaveBeenCalledWith(
    expect.objectContaining({ zoom: "width" }),
  );
  expect(zoom).toHaveBeenCalledWith("width");
  expect(open).toHaveBeenCalledOnce();
});

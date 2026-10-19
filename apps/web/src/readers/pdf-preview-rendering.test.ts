// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { LinkPreview } from "@reader/core";
import { PDFLinkPreview } from "./pdf-link-preview";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function fixture() {
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
    function (this: HTMLCanvasElement) {
      return `pixels:${this.width}x${this.height}`;
    },
  );
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      convertToPdfPoint: (x: number, y: number) => [x, 800 - y],
      convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
    }),
    render,
  };
  const pdf = { getPage: async () => page } as unknown as PDFDocumentProxy;
  const host = document.createElement("div");
  const anchor = document.createElement("a");
  host.append(anchor);
  document.body.append(host);
  let shown: LinkPreview | null = null;
  const preview = new PDFLinkPreview(
    host,
    () => pdf,
    (next) => {
      shown = next;
    },
    vi.fn(),
  );
  return { preview, anchor, render, shown: () => shown! };
}

it("renders a right-column crop at the displayed width times the screen density", async () => {
  const { preview, anchor, shown } = fixture();
  await preview.previewLocation(
    { type: "pdf", page: 7, x: 0.6, y: 0.3 },
    anchor,
  );
  const width = Number(shown().image.match(/pixels:(\d+)/)![1]);
  expect(width).toBeGreaterThanOrEqual(580 * 2);
  preview.destroy();
});

it("re-renders the pinned crop at the requested density and bounds large canvases", async () => {
  const { preview, anchor, shown, render } = fixture();
  await preview.previewLocation(
    { type: "pdf", page: 7, x: 0.6, y: 0.3 },
    anchor,
  );
  const target = shown();
  expect(target.location).toEqual({ type: "pdf", page: 7, x: 0.6, y: 0.3 });
  expect(await target.renderImage!(2400, new AbortController().signal)).toBe(
    "pixels:2400x1920",
  );
  const large = await target.renderImage!(20000, new AbortController().signal);
  const [, width, height] = large.match(/pixels:(\d+)x(\d+)/)!;
  expect(Number(width) * Number(height)).toBeLessThanOrEqual(8_000_000);
  expect(render).toHaveBeenCalledTimes(3);
  preview.destroy();
  await expect(
    target.renderImage!(2400, new AbortController().signal),
  ).rejects.toThrow("文档已关闭");
});

it("cancels a pinned render on abort and releases its canvas", async () => {
  const { preview, anchor, shown, render } = fixture();
  await preview.previewLocation(
    { type: "pdf", page: 7, x: 0.6, y: 0.3 },
    anchor,
  );
  let finish!: () => void;
  const cancel = vi.fn(() => finish());
  render.mockReturnValueOnce({
    promise: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    cancel,
  });
  const controller = new AbortController();
  const pending = shown().renderImage!(2400, controller.signal);
  await Promise.resolve();
  const rejected = expect(pending).rejects.toThrow();
  controller.abort();
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  preview.destroy();
});

it("cancels in-flight high-resolution work when the reader is destroyed", async () => {
  const { preview, anchor, shown, render } = fixture();
  await preview.previewLocation(
    { type: "pdf", page: 7, x: 0.6, y: 0.3 },
    anchor,
  );
  let finish!: () => void;
  const cancel = vi.fn(() => finish());
  render.mockReturnValueOnce({
    promise: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    cancel,
  });
  const pending = shown().renderImage!(2400, new AbortController().signal);
  await Promise.resolve();
  const rejected = expect(pending).rejects.toThrow("预览渲染已取消");
  preview.destroy();
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
});

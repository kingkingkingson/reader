import { beforeEach, expect, it, vi } from "vitest";
import type { Annotation, Document } from "@reader/core";

const mocks = vi.hoisted(() => ({
  annotations: vi.fn(),
  messages: vi.fn(),
  blocks: vi.fn(),
  annotatedPDF: vi.fn(),
  downloadBlob: vi.fn(),
  toast: { loading: vi.fn(() => "t"), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@reader/api", () => ({
  api: {
    annotations: mocks.annotations,
    messages: mocks.messages,
    blocks: mocks.blocks,
  },
  publicationURL: (id: string, name: string) => `/pub/x/${id}/${name}`,
}));
vi.mock("./readers/pdf-export", () => ({ annotatedPDF: mocks.annotatedPDF }));
vi.mock("./download", async (original) => ({
  ...(await original<typeof import("./download")>()),
  downloadBlob: mocks.downloadBlob,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));

import {
  exportAnnotatedPDF,
  exportAnnotatedPDFWithToast,
} from "./annotated-pdf-export";

const doc = { id: "d1", title: 'A/B: "C"', type: "pdf" } as Document;
const mark = (id: string, value: Partial<Annotation>) =>
  ({
    id,
    kind: "highlight",
    location: { type: "pdf", page: 1 },
    ...value,
  }) as Annotation;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messages.mockResolvedValue([{ id: "m1", content: "回答" }]);
  mocks.annotatedPDF.mockResolvedValue({
    bytes: new Uint8Array([37, 80, 68, 70]),
    exported: 2,
    skipped: 1,
  });
});

it("writes annotations and answers into a downloaded copy", async () => {
  mocks.annotations.mockResolvedValue([
    mark("h", {}),
    mark("q", { kind: "question", answerId: "m1" }),
    mark("b", { kind: "bookmark" }),
  ]);
  await expect(exportAnnotatedPDF(doc)).resolves.toMatchObject({
    exported: 2,
    skipped: 1,
  });
  const [, source, marks, context] = mocks.annotatedPDF.mock.calls[0];
  expect(source.url).toBe("/pub/x/d1/original.pdf");
  expect(marks.map((a: Annotation) => a.id)).toEqual(["h", "q"]);
  expect(context).toEqual({ answers: { m1: "回答" } });
  expect(mocks.blocks).not.toHaveBeenCalled();
});

it("does not fetch source blocks to project translated marks", async () => {
  const bounds = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 };
  mocks.annotations.mockResolvedValue([
    mark("t", {
      location: {
        type: "pdf",
        page: 1,
        translation: {
          blockId: "p1-b1",
          sourceHash: "h",
          sentenceIndexes: [],
          start: 0,
          end: 0,
        },
      },
    }),
  ]);
  mocks.blocks.mockResolvedValue([
    { id: "p2-b3", page: 2, bounds, label: "text", text: "" },
  ]);
  await exportAnnotatedPDF(doc);
  expect(mocks.blocks).not.toHaveBeenCalled();
  const [blob, name] = mocks.downloadBlob.mock.calls[0];
  expect(blob.type).toBe("application/pdf");
  expect(name).toBe("A-B- -C--批注.pdf");
});

it("reports a PDF without annotations instead of saving a copy", async () => {
  mocks.annotations.mockResolvedValue([mark("b", { kind: "bookmark" })]);
  await expect(exportAnnotatedPDF(doc)).rejects.toThrow("还没有可导出的批注");
  expect(mocks.annotatedPDF).not.toHaveBeenCalled();
  expect(mocks.downloadBlob).not.toHaveBeenCalled();
});

it("filters the PDF annotations by the selected content kinds", async () => {
  mocks.annotations.mockResolvedValue([
    mark("h", {}),
    mark("n", { kind: "note" }),
    mark("q", { kind: "question", answerId: "m1" }),
  ]);
  await exportAnnotatedPDF(doc, ["note"]);
  expect(
    mocks.annotatedPDF.mock.calls[0][2].map((a: Annotation) => a.id),
  ).toEqual(["n"]);
  mocks.downloadBlob.mockClear();
  await expect(exportAnnotatedPDF(doc, [])).rejects.toThrow(
    "还没有可导出的批注",
  );
  expect(mocks.downloadBlob).not.toHaveBeenCalled();
});

it("does not save when nothing could be placed", async () => {
  mocks.annotations.mockResolvedValue([mark("h", {})]);
  mocks.annotatedPDF.mockResolvedValue({
    bytes: new Uint8Array(),
    exported: 0,
    skipped: 1,
  });
  await expect(exportAnnotatedPDF(doc)).rejects.toThrow("没有可写入原文的批注");
  expect(mocks.downloadBlob).not.toHaveBeenCalled();
});

it("shows progress, the count and skipped marks in one toast", async () => {
  mocks.annotations.mockResolvedValue([mark("h", {})]);
  await exportAnnotatedPDFWithToast(doc);
  expect(mocks.toast.loading).toHaveBeenCalled();
  expect(mocks.toast.success).toHaveBeenCalledWith("已导出 2 条批注", {
    id: "t",
    description: "1 条为译文批注或无法定位，未写入",
  });

  mocks.annotations.mockRejectedValue(new Error("网络错误"));
  await exportAnnotatedPDFWithToast(doc);
  expect(mocks.toast.error).toHaveBeenCalledWith("网络错误", { id: "t" });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Annotation } from "@reader/core";
import {
  annotatedPDF,
  bottomStrip,
  commentText,
  hexColor,
  lineBoxes,
  type ExportContext,
} from "./pdf-export";

const sample = new URL(
  "../../public/samples/reading-notes.pdf",
  import.meta.url,
);
const mark = (value: Partial<Annotation>): Annotation => ({
  id: "a1",
  documentId: "doc",
  kind: "highlight",
  location: {
    type: "pdf",
    page: 1,
    rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
  },
  quote: "",
  note: "",
  color: "#facc15",
  createdAt: "2026-10-14T08:00:00.000Z",
  ...value,
});

async function exportAndReopen(
  annotations: Annotation[],
  context: ExportContext = {},
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const original = new Uint8Array(await readFile(sample));
  const result = await annotatedPDF(
    pdfjs.getDocument,
    { data: original.slice(), useSystemFonts: true },
    annotations,
    context,
  );
  const task = pdfjs.getDocument({ data: result.bytes.slice() });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++)
    pages.push(await (await pdf.getPage(i)).getAnnotations());
  const text = await (await pdf.getPage(1)).getTextContent();
  await task.destroy();
  return { result, original, pages, text };
}

describe("annotated PDF export", () => {
  it("appends highlights, comments and underline strokes to the original", async () => {
    const { result, original, pages } = await exportAndReopen(
      [
        mark({ id: "h", note: "关键句" }),
        mark({ id: "u", kind: "underline", color: "#3b82f6" }),
        mark({
          id: "q",
          kind: "question",
          note: "为什么？",
          answerId: "m1",
          location: {
            type: "pdf",
            page: 2,
            rects: [{ x: 0.1, y: 0.5, width: 0.2, height: 0.02 }],
          },
        }),
        mark({ id: "b", kind: "bookmark" }),
        mark({
          id: "far",
          location: {
            type: "pdf",
            page: 9,
            rects: [{ x: 0, y: 0, width: 1, height: 1 }],
          },
        }),
        mark({ id: "none", location: { type: "pdf", page: 1 } }),
      ],
      { answers: { m1: "因为证据不足。" } },
    );
    expect(result).toMatchObject({ exported: 3, skipped: 2 });
    // Incremental save: the original bytes are an unchanged prefix.
    expect(result.bytes.length).toBeGreaterThan(original.length);
    expect(
      Buffer.from(result.bytes.subarray(0, original.length)).equals(
        Buffer.from(original),
      ),
    ).toBe(true);

    const first = pages[0].filter((a) => a.subtype !== "Popup");
    const highlight = first.find((a) => a.contentsObj.str === "关键句")!;
    expect(highlight.subtype).toBe("Highlight");
    expect(Array.from(highlight.color)).toEqual([250, 204, 21]);
    expect(highlight.quadPoints).toHaveLength(8);
    // The underline is a 1.5 pt opaque strip at the bottom of the line.
    const underline = first.find(
      (a) => Array.from(a.color).join() === "59,130,246",
    )!;
    expect(underline.subtype).toBe("Highlight");
    expect(underline.opacity).toBe(1);
    expect(underline.rect[3] - underline.rect[1]).toBeCloseTo(1.5);
    expect(underline.rect[1]).toBeCloseTo(highlight.rect[1]);
    expect(pages[0].some((a) => a.subtype === "Popup")).toBe(true);

    const question = pages[1].find((a) => a.subtype === "Highlight")!;
    expect(question.contentsObj.str).toBe(
      "问题：为什么？\n\n回答：因为证据不足。",
    );
  }, 30_000);

  it("skips translated marks even when their source sentence can be found", async () => {
    const { result, pages } = await exportAndReopen([
      mark({
        id: "t",
        quote: "A claim is not the same as evidence.",
        location: {
          type: "pdf",
          page: 1,
          quote: "A claim is not the same as evidence.",
          rects: [{ x: 0, y: 0, width: 1, height: 1 }],
          translation: {
            blockId: "p1-b2",
            sourceHash: "h",
            sentenceIndexes: [0],
            start: 0,
            end: 0,
          },
        },
      }),
    ]);
    expect(result).toMatchObject({ exported: 0, skipped: 1 });
    expect(pages.flat()).toEqual([]);
  }, 30_000);

  const page = { x: 0, y: 0, width: 1, height: 1 };
  const spanning = (second: string): Annotation =>
    mark({
      id: "span",
      note: "跨页的一段",
      location: {
        type: "pdf",
        page: 1,
        rects: [page],
        quote: "",
        translation: {
          blockId: "p1-b8",
          sourceHash: "h1",
          sentenceIndexes: [0],
          start: 0,
          end: 0,
          ranges: [
            {
              blockId: "p1-b8",
              sourceHash: "h1",
              sentenceIndexes: [0],
              start: 0,
              end: 0,
              quote: "",
            },
            {
              blockId: "p2-b3",
              sourceHash: "h2",
              sentenceIndexes: [0],
              start: 0,
              end: 0,
              quote: "",
            },
          ],
        },
        sentenceLink: {
          origin: "translation",
          parts: [
            {
              blockId: "p1-b8",
              sourceHash: "h1",
              sentenceIndex: 0,
              source: "A claim is not the same as evidence.",
              target: "",
            },
            {
              blockId: "p2-b3",
              sourceHash: "h2",
              sentenceIndex: 0,
              source: second,
              target: "",
            },
          ],
        },
      },
    });

  it("skips legacy translated marks spanning paragraphs and pages", async () => {
    const { result, pages } = await exportAndReopen([
      spanning("Separate quotations, interpretations, and open questions."),
    ]);
    expect(result).toMatchObject({ exported: 0, skipped: 1 });
    expect(pages.flat()).toEqual([]);
  }, 30_000);

  it("skips a spanning selection whose second block cannot be placed", async () => {
    const { result, pages } = await exportAndReopen([
      spanning("Not a sentence from this document."),
    ]);
    expect(result).toMatchObject({ exported: 0, skipped: 1 });
    expect(pages.flat()).toEqual([]);
  }, 30_000);

  it("skips translation marks whose sentence is not on the page", async () => {
    const { result } = await exportAndReopen([
      mark({
        quote: "This sentence does not appear anywhere.",
        location: {
          type: "pdf",
          page: 1,
          rects: [{ x: 0, y: 0, width: 1, height: 1 }],
          translation: {
            blockId: "p1-b2",
            sourceHash: "h",
            sentenceIndexes: [0],
            start: 0,
            end: 0,
          },
        },
      }),
    ]);
    expect(result).toMatchObject({ exported: 0, skipped: 1 });
  }, 30_000);
});

describe("page geometry", () => {
  it("maps rects on a rotated page with an offset media box", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // 300 × 400 pt, origin at (100, 200), shown rotated to 400 × 300.
    const data = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[100 200 400 600]/Rotate 90>>endobj\n" +
        "trailer<</Root 1 0 R>>\n%%EOF\n",
    );
    const result = await annotatedPDF(pdfjs.getDocument, { data }, [
      mark({
        location: {
          type: "pdf",
          page: 1,
          rects: [{ x: 0, y: 0, width: 0.5, height: 0.25 }],
        },
      }),
    ]);
    const task = pdfjs.getDocument({ data: result.bytes.slice() });
    const page = await (await task.promise).getPage(1);
    const [highlight] = await page.getAnnotations();
    await task.destroy();
    const [x1, y1, x2, y2] = highlight.rect;
    // Displayed 200 × 75 becomes 75 wide and 200 tall in unrotated space,
    // inside the media box rather than at the page origin.
    expect(x2 - x1).toBeCloseTo(75);
    expect(y2 - y1).toBeCloseTo(200);
    expect(x1).toBeGreaterThanOrEqual(100);
    expect(x2).toBeLessThanOrEqual(400);
    expect(y1).toBeGreaterThanOrEqual(200);
    expect(y2).toBeLessThanOrEqual(600);
  }, 30_000);
});

describe("export helpers", () => {
  it("merges the overlapping boxes of a line", () => {
    expect(
      lineBoxes([
        { x: 0.3, y: 0.1, width: 0.2, height: 0.02 },
        { x: 0.1, y: 0.101, width: 0.25, height: 0.019 },
        { x: 0.1, y: 0.13, width: 0.4, height: 0.02 },
      ]),
    ).toEqual([
      {
        x: 0.1,
        y: 0.1,
        width: expect.closeTo(0.4),
        height: expect.closeTo(0.02),
      },
      { x: 0.1, y: 0.13, width: 0.4, height: 0.02 },
    ]);
  });
  it("cuts the underline strip along the quad's own up direction", () => {
    // Horizontal line, 10 pt tall: keep the bottom 1.5 pt.
    expect(bottomStrip([0, 10, 50, 10, 0, 0, 50, 0])).toEqual([
      0, 1.5, 50, 1.5, 0, 0, 50, 0,
    ]);
    // A line on a page rotated 90°: "up" points along -x.
    expect(bottomStrip([10, 0, 10, 50, 20, 0, 20, 50])).toEqual([
      18.5, 0, 18.5, 50, 20, 0, 20, 50,
    ]);
  });
  it("keeps same-height rects in different columns apart", () => {
    const left = { x: 0.08, y: 0.4, width: 0.38, height: 0.02 };
    const right = { x: 0.54, y: 0.401, width: 0.38, height: 0.02 };
    expect(lineBoxes([left, right])).toEqual([left, right]);
    // Neighbouring words on one line still join.
    expect(
      lineBoxes([left, { ...right, x: left.x + left.width + 0.005 }]),
    ).toHaveLength(1);
  });
  it("writes notes, questions and answers as comments", () => {
    expect(commentText(mark({ note: " 备注 " }))).toBe("备注");
    expect(commentText(mark({ kind: "question", note: "为什么" }))).toBe(
      "问题：为什么",
    );
    expect(
      commentText(mark({ kind: "question", note: "为什么" }), "因为"),
    ).toBe("问题：为什么\n\n回答：因为");
  });
  it("reads hex colours and falls back to yellow", () => {
    expect(hexColor("#3B82F6")).toEqual([59, 130, 246]);
    expect(hexColor("red")).toEqual([250, 204, 21]);
  });
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { Annotation } from "@reader/core";
import { annotationsInRects, sentenceRectsAtPoint } from "./annotation-hover";
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it("previews a partial EPUB mark throughout its sentence, without leaking into the next sentence", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<p data-epub-block="b">First sentence. Second sentence.</p>';
  document.body.append(host);
  const paragraph = host.firstElementChild!;
  const text = paragraph.firstChild!;
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: function (this: Range) {
      return [
        new DOMRect(
          this.startOffset * 10,
          0,
          (this.endOffset - this.startOffset) * 10,
          20,
        ),
      ];
    },
  });
  const range = document.createRange();
  range.setStart(text, 1);
  range.setEnd(text, 5);
  const annotation = {
    id: "a",
    kind: "note",
    note: "note",
    location: { type: "epub", href: "a.xhtml" },
  } as Annotation;
  const marks = [{ annotation, range }];
  expect(
    annotationsInRects(
      host,
      [annotation],
      marks,
      sentenceRectsAtPoint(paragraph, 100, 10),
    ),
  ).toEqual([annotation]);
  expect(
    annotationsInRects(
      host,
      [annotation],
      marks,
      sentenceRectsAtPoint(paragraph, 220, 10),
    ),
  ).toEqual([]);
  expect(sentenceRectsAtPoint(paragraph, 400, 10)).toEqual([]);
});
it("handles empty sentences and excludes bookmarks from PDF suppression", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<p data-sentence="0"></p><div class="page" data-page-number="1"></div>';
  expect(sentenceRectsAtPoint(host.firstElementChild!, 0, 0)).toEqual([]);
  vi.spyOn(host.lastElementChild!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 100),
  );
  const bookmark = {
    id: "a",
    kind: "bookmark",
    location: {
      type: "pdf",
      page: 1,
      rects: [{ x: 0, y: 0, width: 1, height: 1 }],
    },
  } as Annotation;
  expect(
    annotationsInRects(host, [bookmark], [], [new DOMRect(10, 10, 20, 20)]),
  ).toEqual([]);
});

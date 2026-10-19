import { expect, it } from "vitest";
import type { PDFBlock, TOCItem } from "@reader/core";
import { chapterRange, headingPages } from "./chapters";

const entry = (
  id: string,
  page: number,
  children: TOCItem[] = [],
): TOCItem => ({
  id,
  label: id,
  location: { type: "pdf", page },
  children,
});

it("spans from the chapter start to the page before the next chapter", () => {
  const toc = [entry("1", 5), entry("2", 20), entry("3", 41)];
  expect(chapterRange(toc, 25, 100)).toEqual({ fromPage: 20, toPage: 40 });
  expect(chapterRange(toc, 41, 100)).toEqual({ fromPage: 41, toPage: 100 });
  expect(chapterRange(toc, 2, 100)).toEqual({ fromPage: 1, toPage: 4 });
});

it("uses the children of a single title entry and ignores sections", () => {
  const toc = [
    entry("book", 1, [
      entry("0", 3, [entry("0-0", 4)]),
      entry("1", 30, [entry("1-0", 35)]),
    ]),
  ];
  expect(chapterRange(toc, 36, 80)).toEqual({ fromPage: 30, toPage: 80 });
});

it("keeps a chapter sharing its start page with the next one", () => {
  const toc = [entry("1", 10), entry("2", 10), entry("3", 12)];
  expect(chapterRange(toc, 10, 20)).toEqual({ fromPage: 10, toPage: 11 });
});

it("uses the page and its neighbours for a PDF without an outline", () => {
  const pages = [1, 2, 3].map((page) => entry(`page-${page}`, page));
  expect(chapterRange(pages, 2, 3)).toEqual({ fromPage: 1, toPage: 3 });
  expect(chapterRange([], 25, 90)).toEqual({ fromPage: 24, toPage: 26 });
  expect(chapterRange([], 90, 90)).toEqual({ fromPage: 89, toPage: 90 });
});

it("parsed headings mark sections when the PDF has no outline", () => {
  const heading = (page: number, text: string): PDFBlock => ({
    id: `${page}-${text}`,
    page,
    label: "paragraph_title",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    text,
  });
  const body = (pages: number) =>
    Array.from({ length: pages }, (_, i) => ({
      ...heading(i + 1, "正文"),
      label: "text",
    }));
  const blocks = [
    ...body(20),
    heading(1, "Abstract"),
    heading(2, "1 Introduction"),
    heading(4, "2 Method"),
    heading(6, "2.1 Data"),
    heading(9, "3 Results"),
    { ...heading(5, "Figure 1"), label: "figure_title" },
  ];
  expect(headingPages(blocks).starts).toEqual([1, 2, 4, 9]);
  // Translation keeps the whole chapter.
  expect(chapterRange([], 7, 20, headingPages(blocks))).toEqual({
    fromPage: 4,
    toPage: 8,
  });
  // A fully parsed last chapter runs to the end of the document.
  expect(chapterRange([], 15, 20, headingPages(blocks))).toEqual({
    fromPage: 9,
    toPage: 20,
  });
  // An outline takes precedence over parsed headings.
  expect(
    chapterRange([entry("1", 3), entry("2", 12)], 7, 20, {
      starts: [5],
      parsed: [5, 6, 7],
    }),
  ).toEqual({ fromPage: 3, toPage: 11 });
});

it("parsed headings never reach past the parsed pages of a long book", () => {
  // Pages 1-12 of a 300-page book are parsed; chapter 2 starts on page 9.
  const parsed = {
    starts: [1, 9],
    parsed: [...Array(12).keys()].map((i) => i + 1),
  };
  expect(chapterRange([], 10, 300, parsed)).toEqual({
    fromPage: 9,
    toPage: 12,
  });
  // Unparsed pages fall back to their neighbours.
  expect(chapterRange([], 50, 300, parsed)).toEqual({
    fromPage: 49,
    toPage: 51,
  });
  // A parsed run without headings does not grow beyond the neighbours.
  expect(
    chapterRange([], 30, 300, {
      starts: [],
      parsed: [28, 29, 30, 31, 32],
    }),
  ).toEqual({ fromPage: 29, toPage: 31 });
});

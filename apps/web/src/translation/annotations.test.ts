// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { Annotation, TranslationBlock } from "@reader/core";
import { textRange, translatedAnnotationRanges } from "./annotations";

it("restores a translated mark across formatted text nodes without changing text", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<section data-translation-block="p1-b1">这是<strong>重要</strong>的一句。下一句。</section>';
  const node = host.firstElementChild as HTMLElement;
  expect(textRange(node, 2, 6)?.toString()).toBe("重要的一");
  const translation: TranslationBlock = {
    blockId: "p1-b1",
    sourceHash: "same-source",
    status: "complete",
    sentences: [
      { source: "An important sentence.", target: "这是重要的一句。" },
    ],
  };
  const annotation: Annotation = {
    id: "a",
    documentId: "doc",
    kind: "highlight",
    quote: "重要的一",
    note: "",
    color: "#e6b94c",
    createdAt: "",
    location: {
      type: "pdf",
      page: 1,
      translation: {
        blockId: "p1-b1",
        sourceHash: "same-source",
        sentenceIndexes: [0],
        start: 2,
        end: 6,
      },
    },
  };
  expect(
    translatedAnnotationRanges(
      host,
      [annotation],
      [translation],
    )[0].range.toString(),
  ).toBe("重要的一");
  expect(host.textContent).toBe("这是重要的一句。下一句。");
  expect(
    translatedAnnotationRanges(
      host,
      [annotation],
      [{ ...translation, sourceHash: "changed" }],
    ),
  ).toEqual([]);
  node.textContent = "内容已经变动。";
  expect(translatedAnnotationRanges(host, [annotation], [translation])).toEqual(
    [],
  );
});

it("draws recovered phrases at the first occurrence across formatted nodes", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<section data-translation-block="b"><div data-sentence="0">这是一项<strong>重要</strong>的结论，重要。</div></section>';
  const annotation: Annotation = {
    id: "a",
    documentId: "d",
    kind: "highlight",
    quote: "重要",
    note: "",
    color: "#e6b94c",
    createdAt: "",
    location: {
      type: "pdf",
      page: 1,
      translation: {
        blockId: "b",
        sourceHash: "h",
        sentenceIndexes: [0],
        start: 2,
        end: 4,
        recovered: true,
        matchedQuote: "重要",
      },
    },
  };
  const translations: TranslationBlock[] = [
    {
      blockId: "b",
      sourceHash: "h",
      status: "complete",
      sentences: [{ source: "source", target: "changed" }],
    },
  ];
  const ranges = translatedAnnotationRanges(host, [annotation], translations);
  expect(ranges).toHaveLength(1);
  expect(ranges[0].range.toString()).toBe("重要");
  expect(ranges[0].range.startContainer.parentElement?.tagName).toBe("STRONG");
  expect(host.querySelectorAll("strong")).toHaveLength(1);
});

it("falls back to whole source-aligned sentences without highlighting neighboring sentences", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<section data-translation-block="b"><div data-sentence="0">第一句。</div><div data-sentence="1">第二<strong>句</strong>。</div><div data-sentence="2">无关句。</div></section>';
  const annotation: Annotation = {
    id: "a",
    documentId: "d",
    kind: "highlight",
    quote: "旧词",
    note: "",
    color: "#e6b94c",
    createdAt: "",
    location: {
      type: "pdf",
      page: 1,
      translation: {
        blockId: "b",
        sourceHash: "h",
        sentenceIndexes: [0, 1],
        start: 0,
        end: 2,
        recovered: true,
        wholeSentence: true,
      },
    },
  };
  const translations: TranslationBlock[] = [
    { blockId: "b", sourceHash: "h", status: "complete", sentences: [] },
  ];
  expect(
    translatedAnnotationRanges(
      host,
      [annotation],
      translations,
    )[0].range.toString(),
  ).toBe("第一句。第二句。");
  annotation.location.translation!.wholeSentence = false;
  annotation.location.translation!.matchedQuote = "**第二句**";
  expect(
    translatedAnnotationRanges(
      host,
      [annotation],
      translations,
    )[0].range.toString(),
  ).toBe("第一句。第二句。");
  annotation.location.translation!.sourceHash = "old";
  expect(translatedAnnotationRanges(host, [annotation], translations)).toEqual(
    [],
  );
});
